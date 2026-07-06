"""복지 Q&A 챗봇 WebSocket — RAG + Mock 폴백"""
import asyncio
import json
import re
from fastapi import WebSocket, WebSocketDisconnect
from rag.sample_data import WELFARE_POLICIES
from agents.mock_responses import is_mock_mode


# ── 정책 검색 유틸 ──────────────────────────────────────────────────────────

def _related_policies(policies: list[dict], k: int = 3) -> list[dict]:
    """답변에 함께 보낼 관련 정책 요약(상위 k). 검색백엔드(BM25 등) 결과에 일부 키가
    없어도 .get()으로 안전 — 직접 인덱싱하면 KeyError가 이미 생성한 답변까지 버리게 된다."""
    return [
        {"id": p.get("id"), "name": p.get("name"), "category": p.get("category")}
        for p in (policies or [])[:k]
    ]


def _search_policies_for_chat(query: str, n: int = 5) -> list[dict]:
    """키워드 기반 정책 검색 (ChromaDB 없이도 동작)"""
    try:
        from rag.search import search_policies
        return search_policies(query, n_results=n)
    except Exception:
        pass

    query_lower = query.lower()
    scored = []
    keywords = re.findall(r"[가-힣a-zA-Z]+", query_lower)
    for p in WELFARE_POLICIES:
        text = (p["name"] + p["category"] + p["target"] +
                p["eligibility"] + p.get("benefit", "")).lower()
        score = sum(2 if kw in p["name"].lower() else 1
                    for kw in keywords if kw in text)
        if score > 0:
            scored.append((score, p))
    scored.sort(key=lambda x: -x[0])
    return [p for _, p in scored[:n]]


# ── Mock Q&A 응답 생성 ──────────────────────────────────────────────────────

def _mock_answer(question: str, policies: list[dict]) -> str:
    q = question
    if not policies:
        return (
            f"'{q}'에 대한 관련 복지 정책을 찾지 못했습니다. "
            "더 구체적인 조건(나이, 소득, 상황)을 말씀해 주시면 더 잘 찾아드릴 수 있습니다. "
            "또는 복지로(www.bokjiro.go.kr) 또는 129로 전화하시면 전문 상담을 받으실 수 있습니다."
        )

    top = policies[:3]
    names = ", ".join(p["name"] for p in top)
    answer_parts = [f"관련 복지 정책을 {len(policies)}건 찾았습니다. 주요 정책은 **{names}** 입니다.\n"]

    for p in top:
        answer_parts.append(
            f"**{p['name']}** ({p['category']})\n"
            f"- 대상: {p['target']}\n"
            f"- 혜택: {p.get('benefit', '상세 내용 확인 필요')}\n"
            f"- 신청: {p.get('application', '주민센터 방문')}\n"
        )

    answer_parts.append(
        "\n더 자세한 내용은 복지로(www.bokjiro.go.kr) 또는 "
        "주민센터·129 무료상담 전화를 이용해 주세요."
    )
    return "\n".join(answer_parts)


# ── AI 기반 Q&A (Production 모드) ──────────────────────────────────────────

async def _ai_answer(question: str, policies: list[dict]) -> str:
    from langchain_core.messages import SystemMessage, HumanMessage
    from agents.utils import safe_json_dumps
    from agents.llm import get_chat_llm

    # 검색 백엔드(BM25/ChromaDB)마다 필드 구성이 달라 KeyError로 폴백되던 문제 방지 — 전부 .get().
    policy_context = safe_json_dumps(
        [{"name": p.get("name", ""), "target": p.get("target", ""), "benefit": p.get("benefit", ""),
          "eligibility": p.get("eligibility", ""), "application": p.get("application", "")}
         for p in policies[:5]],
        indent=2,
    )

    system = """당신은 대한민국 복지 서비스 전문 상담사입니다.
사용자의 복지 관련 질문에 친절하고 정확하게 답변하세요.

규칙:
- 마크다운 **굵게** 사용 가능 (정책명, 중요 정보)
- 구체적인 금액·기간·신청 방법 포함
- 확실하지 않은 정보는 "주민센터 또는 129 상담을 통해 확인하세요"로 안내
- 3~5문단 이내로 간결하게 답변
- 마지막에 신청 방법 안내 포함"""

    llm = get_chat_llm(temperature=0.3, max_tokens=1024)
    if llm is None:
        raise RuntimeError("no AI provider — 규칙기반 폴백")
    response = await llm.ainvoke([
        SystemMessage(content=system),
        HumanMessage(content=f"관련 정책 정보:\n{policy_context}\n\n질문: {question}"),
    ])
    return str(response.content)


# ── WebSocket 엔드포인트 ────────────────────────────────────────────────────

async def chat_websocket_endpoint(ws: WebSocket):
    from api.ws_security import reject_bad_origin
    if await reject_bad_origin(ws):
        return
    await ws.accept()
    # 남용 방지: IP별 연결 개설 레이트리밋(무제한 LLM 호출 방지).
    from api.ws_rate_limit import allow_connection, allow_message
    if not allow_connection(ws):
        await ws.send_text(json.dumps(
            {"type": "error", "message": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."}, ensure_ascii=False))
        await ws.close(code=1013)
        return
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # 프레임 하나가 깨져도 세션은 유지(재연결 불필요) — 안내 후 다음 메시지 대기.
                await ws.send_text(json.dumps(
                    {"type": "error", "message": "잘못된 JSON 형식"}, ensure_ascii=False))
                continue

            if data.get("type") != "question":
                await ws.send_text(json.dumps(
                    {"type": "error", "message": "type: question 필요"},
                    ensure_ascii=False,
                ))
                continue

            question = str(data.get("question", "")).strip()
            if not question:
                continue

            # 남용 방지: IP별 메시지(LLM 호출) 레이트리밋 — 초과 시 처리 없이 안내 후 다음 대기.
            if not allow_message(ws):
                await ws.send_text(json.dumps(
                    {"type": "error", "message": "질문이 너무 많아요. 잠시 후 다시 시도해 주세요."}, ensure_ascii=False))
                continue

            # 검색 중 표시
            await ws.send_text(json.dumps(
                {"type": "searching", "message": "관련 정책 검색 중..."},
                ensure_ascii=False,
            ))

            policies = _search_policies_for_chat(question)

            # 답변 생성
            await ws.send_text(json.dumps(
                {"type": "thinking", "message": "답변 생성 중..."},
                ensure_ascii=False,
            ))

            if is_mock_mode():
                answer = _mock_answer(question, policies)
            else:
                try:
                    answer = await _ai_answer(question, policies)
                except Exception as e:
                    answer = _mock_answer(question, policies)

            await ws.send_text(json.dumps(
                {
                    "type": "answer",
                    "answer": answer,
                    "related_policies": _related_policies(policies),
                },
                ensure_ascii=False,
            ))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        from logging_config import get_logger
        get_logger("ws.chat").error("챗 처리 오류: %s", e)  # 상세는 서버 로그에만(클라이언트엔 일반 메시지)
        try:
            await ws.send_text(json.dumps(
                {"type": "error", "message": "답변 생성 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요."}, ensure_ascii=False,
            ))
        except Exception:
            pass
