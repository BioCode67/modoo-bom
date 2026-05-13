"""FastAPI WebSocket — LangGraph 노드 실행 상태 실시간 스트리밍"""
import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect
from agents.graph import get_graph
from agents.state import AgentState, UserProfile


async def _send(ws: WebSocket, msg_type: str, data: dict):
    await ws.send_text(json.dumps({"type": msg_type, **data}, ensure_ascii=False))


async def run_agent_with_streaming(ws: WebSocket, profile_data: dict):
    """
    LangGraph astream(stream_mode="values")로 전체 상태를 매 노드마다 받아
    새로 추가된 이벤트만 WebSocket으로 스트리밍.
    """
    graph = get_graph()

    try:
        profile = UserProfile(**profile_data)
    except Exception as e:
        await _send(ws, "error", {"message": f"프로필 파싱 오류: {e}"})
        return

    initial_state = AgentState(
        user_profile=profile,
        query=f"{profile.name} 복지 정책 검색",
    )

    await _send(ws, "start", {"message": "모두봄 AI 에이전트 시작", "total_nodes": 10})

    prev_event_count = 0
    full_state: dict = {}

    try:
        # stream_mode="values" → 각 노드 실행 후 전체 누적 상태를 yield
        async for full_state in graph.astream(
            initial_state.model_dump(),
            stream_mode="values",
        ):
            events: list = full_state.get("events", [])
            new_events = events[prev_event_count:]
            prev_event_count = len(events)

            for event in new_events:
                if isinstance(event, dict):
                    node = event.get("node", "")
                    status = event.get("status", "")
                    message = event.get("message", "")
                    data = event.get("data")
                else:
                    node = event.node
                    status = event.status
                    message = event.message
                    data = event.data

                await _send(ws, "node_event", {
                    "node": node,
                    "status": status,
                    "message": message,
                    "data": data,
                })
                await asyncio.sleep(0.03)

    except Exception as e:
        import traceback
        err_detail = traceback.format_exc()
        print(f"[WebSocket] 에이전트 오류:\n{err_detail}")
        await _send(ws, "error", {"message": f"에이전트 실행 오류: {e}"})
        return

    # 최종 완성 상태에서 결과 추출
    if full_state:
        eligible = full_state.get("eligible_policies", [])

        # 수혜 정책에 혜택·신청정보 보강 (sample_data 매핑)
        try:
            from rag.sample_data import WELFARE_POLICIES
            _pol_map = {p["id"]: p for p in WELFARE_POLICIES}
            enriched = []
            for p in eligible:
                extra = _pol_map.get(p.get("id", ""), {})
                enriched.append({
                    **p,
                    "benefit": extra.get("benefit", ""),
                    "application": extra.get("application", ""),
                    "department": extra.get("department", ""),
                    "category": extra.get("category", ""),
                })
            eligible = enriched
        except Exception:
            pass

        result_payload = {
            "eligible_policies": eligible,
            "application_guides": full_state.get("application_guides", []),
            "retrieved_docs": full_state.get("retrieved_docs", []),
            "portfolio_summary": full_state.get("portfolio_summary", {}),
            "notifications": full_state.get("notifications", []),
            "tracked_applications": full_state.get("tracked_applications", []),
            "final_response": full_state.get("final_response", ""),
            "profile_summary": full_state.get("profile_summary", ""),
        }
        await _send(ws, "complete", {"result": result_payload})
    else:
        await _send(ws, "error", {"message": "에이전트가 결과를 반환하지 않았습니다."})


async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        raw = await ws.receive_text()
        data = json.loads(raw)

        if data.get("type") != "start_analysis":
            await _send(ws, "error", {"message": "잘못된 메시지 형식 — type: start_analysis 필요"})
            return

        profile_data = data.get("profile", {})
        await run_agent_with_streaming(ws, profile_data)

    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        try:
            await _send(ws, "error", {"message": "잘못된 JSON 형식"})
        except Exception:
            pass
    except Exception as e:
        try:
            await _send(ws, "error", {"message": str(e)})
        except Exception:
            pass
