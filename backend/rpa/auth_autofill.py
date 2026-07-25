"""간편인증(anyid/oacx) 폼 공용 자동입력 — 고정 ID 1순위 + 의미 인식(ai_fill 결정론) 폴백.

배경(2026-07-20, '최고의 RPA' 런): 본인인증 폼 자동입력이 사이트마다 제각각이었다 —
정부24·복지로는 자동, 건보(nhis)는 고정 ID(#oacx_*) 방식뿐(위젯 개편 시 수동 전락),
고용24(work24)는 아예 없음(어르신이 이름·생년월일·전화를 전부 타이핑). 이 모듈이 그 갭을 메워
4개 사이트 전부 '폰에서 [인증 허용]만' 수준으로 통일한다.

전략(순서가 계약):
  ① 검증된 고정 ID(#oacx_name/#oacx_birth/#oacx_phone2) 우선 — 기존 동작 100% 보존, 가장 빠름
  ② 실패한 칸만 ai_fill '결정론 의미매칭'(접근성 이름: 성명↔이름·휴대폰↔핸드폰, LLM 키 불필요·
     오프라인)으로 보강 — 위젯 개편·다른 마크업에도 견고. RPA_AI_FILL=0 밸브는 이 폴백만 끈다
     (ID 경로는 AI가 아니므로 밸브와 무관하게 항상 동작).
  ③ '전체동의'는 모든 입력 뒤 가장 마지막에 체크(필드 재렌더가 동의를 지우는 실측 순서 보존)
  ④ 전 단계는 형제 프레임·창 순회(base._sibling_contexts) — 위젯이 자식 프레임이어도 동작
     (프레임 분리 3대 갭과 동일 원인 대응).

프라이버시·HITL(불변): 값은 이 PC의 브라우저에만 입력되고 어떤 메시지에도 담지 않는다.
'인증 요청' 클릭은 사용자 폰으로 푸시를 보낼 뿐 — 실제 본인인증 승인(폰)과 최종 제출은 항상 사람.
"""
import asyncio
import os
import re


def _norm_info(user_info: dict) -> dict:
    """user_info를 {name, birth, prefix, tail}로 정규화 — nhis._normalize와 동일 방어(None 관용)."""
    info = user_info or {}
    name = str(info.get("user_name") or info.get("name") or "").strip()
    birth = re.sub(r"[^0-9]", "", str(info.get("birth_date") or ""))
    phone = re.sub(r"[^0-9]", "", str(info.get("phone") or ""))
    prefix = phone[:3] if len(phone) >= 3 else "010"
    tail = phone[3:] if len(phone) > 3 else ""
    return {"name": name, "birth": birth, "prefix": prefix, "tail": tail}


async def _fill_verified(ctx, sel: str, val: str) -> bool:
    """존재 확인 → fill → '값 일치' 재검증(숫자는 포맷 관용). 없는 셀렉터는 즉시 False(대기 없음)."""
    try:
        if await ctx.locator(sel).count() == 0:
            return False
        await ctx.fill(sel, val, timeout=3000)
        ok = await ctx.evaluate(
            """(a) => { const e = document.querySelector(a.s); if (!e || !e.value) return false;
                const t = e.value.trim(), v = String(a.v).trim();
                if (/^[0-9]+$/.test(v)) return t.replace(/[^0-9]/g, '') === v;
                return t === v; }""", {"s": sel, "v": val})
        return bool(ok)
    except Exception:
        return False


async def _id_pass(ctx, vals: dict, got: dict) -> None:
    """①단계: 검증된 고정 ID로 채운다 — 성공한 키만 got에 기록(이미 성공한 키는 건너뜀)."""
    if vals["name"] and not got.get("name"):
        got["name"] = await _fill_verified(ctx, "#oacx_name", vals["name"])
    if vals["birth"] and not got.get("birth"):
        got["birth"] = await _fill_verified(ctx, "#oacx_birth", vals["birth"])
    if vals["tail"] and not got.get("phone"):
        for sel in ("#oacx_phone2", "#oku_phone2", "input.phone"):
            if await _fill_verified(ctx, sel, vals["tail"]):
                got["phone"] = True
                break


async def _semantic_pass(ctx, page, vals: dict, got: dict) -> None:
    """②단계: 실패한 칸만 ai_fill 결정론 의미매칭(키 불필요)으로 보강.
    birth6 키는 '생년월일/주민등록번호 라벨 칸' 라우팅 의도 — 값은 위젯이 요구하는 전체 자리수를 그대로 넣는다
    (값 일치 검증이 자리수를 강제하지 않으므로 안전, 위젯별 6/8자리 차이 관용)."""
    want = {}
    if vals["name"] and not got.get("name"):
        want["name"] = vals["name"]
    if vals["birth"] and not got.get("birth"):
        want["birth6"] = vals["birth"]
    if vals["tail"] and not got.get("phone"):
        want["phone_tail"] = vals["tail"]
        want["phone_head"] = vals["prefix"]  # 앞자리 select가 있으면 함께(없으면 무해 실패)
    if not want:
        return
    try:
        from rpa.ai_fill import ai_fill
        res = await ai_fill(ctx, page, want, page_hint="간편인증 본인확인 폼(이름·생년월일·휴대폰)")
    except Exception:
        return
    if res.get("name"):
        got["name"] = True
    if res.get("birth6"):
        got["birth"] = True
    if res.get("phone_tail"):
        got["phone"] = True


async def _check_agree(ctx) -> bool:
    """'전체동의' 체크 — gov24._check_agree_all과 동일 셀렉터(단일 소스는 gov24, 여기선 지연 임포트)."""
    try:
        from rpa.gov24_rpa import _check_agree_all
        return await _check_agree_all(ctx)
    except Exception:
        return False


async def autofill_easy_auth(page, user_info: dict) -> dict:
    """간편인증 폼 자동입력의 공용 진입점 — 반환 {"name","birth","phone","agree": bool}.

    호출부(nhis 폴백·work24 신설)는 name·birth·phone 3키 전부 True일 때만 '자동입력 완료'로
    안내한다(부분 성공을 완료로 과장 금지). 실패해도 예외 없이 정직한 부분 결과를 돌려준다."""
    got = {"name": False, "birth": False, "phone": False, "agree": False}
    vals = _norm_info(user_info)
    if not (vals["name"] or vals["birth"] or vals["tail"]):
        return got

    from rpa.base import _sibling_contexts
    ctxs = _sibling_contexts(page)

    # ① 고정 ID 경로 — 전 프레임에서 소진(가장 빠르고 검증된 경로)
    for ctx in ctxs:
        await _id_pass(ctx, vals, got)
        if got["name"] and got["birth"] and got["phone"]:
            break

    # ② 의미 인식 폴백 — 실패 칸만, RPA_AI_FILL=0 밸브 존중(현장 안전밸브)
    if os.environ.get("RPA_AI_FILL", "1") != "0" and not (got["name"] and got["birth"] and got["phone"]):
        for ctx in ctxs:
            await _semantic_pass(ctx, page, vals, got)
            if got["name"] and got["birth"] and got["phone"]:
                break

    # ③ 전체동의 — 무엇이든 채웠으면 마지막에 체크(재렌더가 동의를 지우는 순서 실측 보존)
    if got["name"] or got["birth"] or got["phone"]:
        for ctx in ctxs:
            if await _check_agree(ctx):
                got["agree"] = True
                break
    return got


async def request_easy_auth(page) -> bool:
    """'인증 요청' 자동 클릭 — 형제 프레임까지 순회(gov24._request_auth 재사용, 지연 임포트).
    ⚠️ 이 클릭은 사용자 폰으로 인증 푸시를 보낼 뿐, 본인인증 승인은 항상 사용자가 폰에서 한다(HITL).
    호출부는 gov24와 동일하게 '제공자 클릭이 trusted + 생년월일 존재'일 때만 부른다
    (미선택 상태 요청 시 '인증서비스를 선택하여 주십시오' 오류 — 실사용 확정 게이트)."""
    try:
        from rpa.base import _sibling_contexts
        from rpa.gov24_rpa import _request_auth
        for ctx in _sibling_contexts(page):
            if await _request_auth(ctx):
                await asyncio.sleep(0.8)
                return True
    except Exception:
        pass
    return False
