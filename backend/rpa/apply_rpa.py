"""
복지로 복지 서비스 실제 신청 RPA (Playwright)

흐름:
  ① 복지로 로그인 (카카오톡 간편인증)
  ② 대상 서비스 검색 또는 직접 URL 이동
  ③ 신청하기 버튼 클릭
  ④ 신청 양식 자동 작성
  ⑤ 제출 전 사용자 최종 확인 대기

지원 서비스:
  - 기초연금
  - 아동수당
  - 부모급여
  - 청년 내일저축계좌
  - 청년월세지원
"""
import asyncio
import os
import re
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_provider_in_anyid, provider_display, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, launch_browser,
    click_eform_button, get_frame_by_url,
    check_cancel, CancelledByUser, NO_PRINT_SCRIPT, wait_any_visible,
)

# 복지로 로그인 — 2026 개편으로 옛 moveTWAT52012M.do 는 빈 셸(깨짐).
# 신규 loginView.do 는 tx 토큰을 자동 발급하므로 tx 없이 직접 접근해도 로그인 화면이 뜬다.
# 복지로는 Clipsoft eForm SPA라 로그인/간편인증이 .cl-button 컴포넌트이고,
# 간편인증 위젯은 외부 iframe(4user.yeskey.or.kr/fincert)로 로드된다.
BOKJIRO_LOGIN_URL = "https://www.bokjiro.go.kr/ssis-tbu/loginView.do"
FINCERT_FRAME_KEYWORD = "fincert"
BOKJIRO_SEARCH_URL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"

# 서비스별 신청 URL (복지로 직접 링크)
# wlfareInfoId는 라이브 복지로 실측 검증(페이지 wlfareInfoNm 대조, 2026-07). 구 ID들은 타 서비스로 재배정됨.
SERVICE_APPLY_URLS = {
    "기초연금": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001164",
    "아동수당": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001171",
    "부모급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004657",
    "청년 내일저축계좌": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000060",
    "첫만남이용권": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004656",
    "기초생활 생계급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001132",
    # 시드 정책 표기(프론트 quickApply와 동일 ID) — 여정 다중 서비스에서 생계급여가 이름 차이로 탈락하지 않게
    "국민기초생활보장 생계급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001132",
    # 데모 핵심 서비스 — 온라인 신청 확실, 필요서류(등본·가족관계·소득금액증명) 대부분 자동발급 가능.
    #   프론트 quickApply.KNOWN_APPLY_URLS(WLF00004661)와 동일. 표기변형 2종 모두 고정(프로필 apply_url 의존 제거).
    "청년월세지원": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004661",
    "청년 월세 한시 특별지원": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004661",
}

APPLY_BUTTON_SELECTORS = [
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('온라인신청')",
    "a:has-text('모바일신청')",
    ".btn-apply", "#btnApply",
    "input[value='신청하기']",
    # 복지로 신청 화면은 eForm(clipsoft) 위젯 — 표준 a/button 이 아니라 .cl-button/.cl-text 라
    #   위 셀렉터로는 안 잡혀 '클릭 실패'인데도 양식 열림으로 오보되던 결함(감사 :251) 보강.
    ".cl-button:has-text('신청')",
    "[class*='cl-button']:has-text('신청')",
    "span.cl-text:has-text('신청하기')",
    "div[role='button']:has-text('신청하기')",
]

# ⚠️ 의도적 미사용 — 최종 제출은 비가역·법적 행위라 에이전트가 누르지 않는다(본인 몫, human-in-the-loop).
#    셀렉터는 향후 '제출 버튼 위치 하이라이트' 안내용으로만 보존.
SUBMIT_BUTTON_SELECTORS = [
    "button:has-text('신청')",
    "button:has-text('제출')",
    "input[type='submit']",
    "button[type='submit']",
    "a:has-text('신청 완료')",
]


async def _pass_service_select_page(page, task, service_name: str, wait_sec: int = 10) -> bool:
    """(추가형 브리지) 로그인 후 '복지급여 신청 — 서비스 선택' 화면(selectServChs, 실측 2026-07-20) 자동 통과.

    실측 흐름: 신청하기 → 서비스 선택 그리드(카드별 '신청하기' 체크박스) → [저장 후 다음단계] →
    확인 다이얼로그('선택한 서비스명: … 진행하시겠습니까?') → [확인] → 신청 양식.
    ⚠️ 화면 시그니처('저장 후 다음단계')가 없으면 **아무것도 하지 않는다**(기존 골든패스 무영향 계약).
    체크·다음단계·확인까지 자동 — 최종 제출은 여전히 본인(기존 '제출 직전 정지' 원칙 불변)."""
    key = re.sub(r"\s+", "", service_name or "")
    attempts = max(1, wait_sec // 2)
    for _ in range(attempts):
        try:
            body = await page.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            body = ""
        if "저장 후 다음단계" not in (body or ""):
            return False  # 선택 화면 아님 — 관여하지 않음
        checked = False
        try:
            checked = await page.evaluate(
                """(key) => {
                    const norm = (s) => (s || '').replace(/\\s+/g, '');
                    const cards = [...document.querySelectorAll('div, li, td')]
                        .filter(c => { const t = norm(c.innerText); return t.length < 300 && t.includes(key) && t.includes('신청하기'); });
                    cards.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length); // 가장 안쪽 카드 우선
                    for (const card of cards) {
                        const cb = card.querySelector('input[type=checkbox]');
                        if (cb) { if (!cb.checked) cb.click(); return true; }
                        const lab = [...card.querySelectorAll('label, span')].find(e => norm(e.innerText).includes('신청하기'));
                        if (lab) { lab.click(); return true; }
                    }
                    return false;
                }""",
                key,
            )
        except Exception:
            checked = False
        if checked:
            task.update("running", f"📋 서비스 선택 화면 — '{service_name}' 체크 후 [저장 후 다음단계]로 진행해요...",
                        await take_screenshot(page))
            await asyncio.sleep(0.6)
            if not await click_by_text(page, ["저장 후 다음단계"]):
                await click_eform_button(page, "저장 후 다음단계")
            # 확인 다이얼로그('진행하시겠습니까?') — [확인]으로 신청 양식 진입(작성은 자동, 제출은 본인)
            await asyncio.sleep(1.2)
            try:
                t2 = await page.evaluate("() => document.body ? document.body.innerText : ''")
                if ("진행하시겠습니까" in t2) or ("선택한 서비스명" in t2):
                    await click_by_text(page, ["확인"])
            except Exception:
                pass
            await asyncio.sleep(2)
            return True
        # 선택 화면인데 카드를 못 찾음 — 사람이 체크하면 다음 루프가 [저장 후 다음단계]부터 이어받는다
        task.update("waiting_login",
                    f"📋 서비스 선택 화면이에요 — 목록에서 '{service_name}'의 '신청하기'를 체크해 주세요.\n"
                    "체크만 하시면 [저장 후 다음단계]와 확인창은 자동으로 진행해 드려요.",
                    await take_screenshot(page))
        await asyncio.sleep(2)
    return False


async def _autofill_bokjiro_auth(contexts, page, user_info) -> dict:
    """복지로 간편인증 창 자동입력(이름·생년월일·휴대폰) — 정부24와 동일 레이아웃(실측 스크린샷
    2026-07-20). 오늘 gov24에서 검증한 방식 이식: 라벨 행 매칭 + 한글 IME 삽입(영타 방지) +
    숫자 실키 + '값 일치' 지연 검증. 주민번호 뒷자리는 rrn_back 있을 때만(민감정보 무보관 원칙).
    본인인증 최종 승인(폰)은 사람 — RPA는 입력·전체동의·제공자 선택까지만.
    반환 {name/birth/phone: 성공여부} — 실패는 무해(사용자 직접 입력 폴백)."""
    ui = user_info or {}
    name = str(ui.get("name") or ui.get("user_name") or "").strip()
    from rpa.gov24_rpa import _birth6
    birth = _birth6(ui.get("birth_date"))  # 주민번호 앞 6자리(YYMMDD) — '20010601'→'010601'
    phone = re.sub(r"[^0-9]", "", str(ui.get("phone", "")))
    rrn7 = re.sub(r"[^0-9]", "", str(ui.get("rrn_back", "")))
    rrn7 = rrn7 if len(rrn7) == 7 else ""
    phone_tail = phone[3:] if phone.startswith("01") and len(phone) >= 10 else phone
    out = {"name": not name, "birth": not birth, "phone": not phone_tail}

    # 행 라벨로 대상 입력칸을 찾아 data-modoobom-b 마킹(보이는 활성 칸만)
    _mark_js = """(kind) => {
        const rowOf = (e) => { let n = e.parentElement;
            for (let i=0;i<5&&n;i++){ const t=(n.innerText||'').trim(); if(t&&t.length<=60) return t; n=n.parentElement; } return ''; };
        const pat = kind==='name' ? /이름|성명/ : kind==='birth' ? /주민등록번호|생년월일/ : /휴대폰|핸드폰/;
        const cands = [...document.querySelectorAll("input[type=text],input[type=tel],input[type=number],input:not([type])")]
            .filter(e => e.offsetParent!==null && !e.disabled && !e.readOnly && pat.test(rowOf(e)));
        if(!cands.length) return 0;
        // 이름은 첫 칸, 생년월일은 첫 칸(앞자리), 휴대폰은 마지막 칸(뒷부분)
        const el = kind==='phone' ? cands[cands.length-1] : cands[0];
        el.setAttribute('data-modoobom-b', kind); return 1;
    }"""

    async def _fill(ctx, kind, value, numeric):
        try:
            if not await ctx.evaluate(_mark_js, kind):
                return False
        except Exception:
            return False
        sel = f"[data-modoobom-b='{kind}']"
        loc = ctx.locator(sel)
        chk = ("(a)=>{const e=document.querySelector(a.s);if(!e||!e.value)return false;"
               "const t=e.value.trim(),v=String(a.v).trim();"
               "return /^[0-9]+$/.test(v)? t.replace(/[^0-9]/g,'')===v : t===v;}")
        for method in ("focus_key", "click_key", "fill"):
            try:
                if method == "focus_key":
                    if not await ctx.evaluate(
                        "(s)=>{const e=document.querySelector(s);if(!e)return false;e.focus();try{e.select()}catch(x){}return document.activeElement===e;}", sel):
                        continue
                    if numeric or value.isascii():
                        await page.keyboard.type(value, delay=40)
                    else:
                        await page.keyboard.insert_text(value)  # 한글은 IME 삽입(영타 방지)
                elif method == "click_key":
                    await loc.click(timeout=3000)
                    await page.keyboard.press("Control+a")
                    await page.keyboard.press("Delete")
                    if numeric or value.isascii():
                        await page.keyboard.type(value, delay=40)
                    else:
                        await page.keyboard.insert_text(value)
                else:
                    await loc.fill(value, timeout=3000)
                await asyncio.sleep(0.4)
                if await ctx.evaluate(chk, {"s": sel, "v": value}):
                    return True
            except Exception:
                continue
        return False

    phone_head = phone[:3] if phone.startswith("01") and len(phone) >= 10 else ""
    for ctx_ in contexts:
        if name and not out["name"]:
            out["name"] = await _fill(ctx_, "name", name, numeric=False)
        if birth and not out["birth"]:
            out["birth"] = await _fill(ctx_, "birth", birth, numeric=True)
        if phone_tail and not out["phone"]:
            # 휴대폰 앞자리(010 등) 셀렉트 지정 — 기본이 010이 아닐 때 대비(011/016 등)
            if phone_head:
                try:
                    await ctx_.evaluate(
                        """(h) => { for(const s of document.querySelectorAll('select')){
                            const o=[...s.options].find(o=>(o.text||'').trim()===h);
                            if(o){ if(s.value!==o.value){ s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); } return true; } } return false; }""", phone_head)
                except Exception:
                    pass
            out["phone"] = await _fill(ctx_, "phone", phone_tail, numeric=True)
        if rrn7:  # 뒷자리는 있을 때만(민감정보) — 검증은 생략(마스킹 입력이라 값 확인 어려움)
            try:
                _need = await ctx_.evaluate(
                    """() => { const rowOf=(e)=>{let n=e.parentElement;for(let i=0;i<5&&n;i++){const t=(n.innerText||'').trim();if(t&&t.length<=60)return t;n=n.parentElement;}return '';};
                        const cs=[...document.querySelectorAll("input[type=text],input[type=password],input[type=tel],input[type=number],input:not([type])")]
                            .filter(e=>e.offsetParent!==null&&!e.disabled&&!e.readOnly&&/주민등록번호/.test(rowOf(e)));
                        const el=cs[cs.length-1]; if(!el||el.value)return false; el.setAttribute('data-modoobom-b','rrn'); return true; }"""
                )
                if _need:
                    _rl = ctx_.locator("[data-modoobom-b='rrn']")
                    await _rl.click(timeout=3000)
                    await page.keyboard.type(rrn7, delay=40)
            except Exception:
                pass
    # 전체동의는 '제공자 선택 뒤 마지막에'(정부24와 동일 — 제공자 선택이 동의를 리셋).
    #   ⚠️ 문서순 첫 매칭은 섹션 전체를 감싼 바깥 div('서비스 이용에 대한 동의 … 전체동의')를 잡아
    #   무효 클릭이 된다(gov24 제공자 클릭과 동일 교훈) → ① '전체동의' 행의 실제 체크박스/라디오 우선
    #   ② 없으면 '전체동의' 텍스트를 가진 '가장 작은' 요소(라벨/스팬)를 클릭.
    _agree_js = """() => {
        const rowOf=(e)=>{let n=e; for(let i=0;i<4&&n;i++){ const t=(n.innerText||'').replace(/\\s+/g,''); if(t.includes('전체동의')&&t.length<=40) return true; n=n.parentElement;} return false;};
        for(const cb of document.querySelectorAll("input[type=checkbox],input[type=radio]")){
            if(cb.offsetParent!==null && rowOf(cb)){ if(!cb.checked) cb.click(); return true; }
        }
        const cands=[...document.querySelectorAll("label,span,a,button")]
            .filter(e=>e.offsetParent!==null && (e.innerText||'').replace(/\\s+/g,'').includes('전체동의'))
            .sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
        if(cands.length){ cands[0].click(); return true; }
        return false;
    }"""
    for ctx_ in contexts:
        try:
            if await ctx_.evaluate(_agree_js):
                break
        except Exception:
            pass
    return out


async def _login_bokjiro(page, task, provider: str = "kakao", user_info: dict = None) -> bool:
    """복지로 로그인 (eForm 간편인증 → yeskey fincert → 카카오톡).

    복지로는 Clipsoft eForm SPA라 간편인증 버튼이 .cl-button 컴포넌트이고, 인증 위젯은
    외부 iframe(fincert)로 로드된다. user_info(이름·생년월일·휴대폰)가 오면 제공자 선택 후
    인증 정보를 자동입력한다(정부24와 동일 — 실사용 제보로 추가). 카카오 최종 승인(폰)은
    사용자가 직접 수행한다(비가역 본인인증 원칙). RPA는 위젯 도달+입력+전체동의까지.
    """
    login_url = page.url
    pv = provider_display(provider)
    ss = await take_screenshot(page)
    task.update("running", "복지로 로그인 페이지 — 간편인증 선택 중...", ss)

    await asyncio.sleep(1)

    # 간편인증: eForm 컴포넌트(cl-button) 우선 → 표준 셀렉터/텍스트 폴백
    clicked_simple = await click_eform_button(page, "간편인증")
    if not clicked_simple:
        clicked_simple = await click_first_matching(page, [
            "button:has-text('간편인증')", "a:has-text('간편인증')", "li:has-text('간편인증')",
        ])
    if not clicked_simple:
        clicked_simple = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    # fincert iframe 로드는 아래 get_frame_by_url 이 폴링으로 대기 — 고정 3초는 잉여라 제거(버벅임)
    await asyncio.sleep(0.5)

    # 간편인증 위젯은 메인 페이지 오버레이 또는 fincert iframe 중 하나에 렌더된다 → 양쪽에서 시도
    frame = await get_frame_by_url(page, FINCERT_FRAME_KEYWORD, timeout_sec=8)
    contexts = [page] + ([frame] if frame else [])
    ss = await take_screenshot(page)
    task.update("running", f"간편인증 위젯 로드됨 — '{pv}' 선택 중...", ss)

    # 인증수단 선택(뱅크류 오클릭 제외). 위젯이 있는 컨텍스트를 찾아 클릭.
    kakaotalk_clicked = False
    for ctx_ in contexts:
        if await click_provider_in_anyid(ctx_, provider):
            kakaotalk_clicked = True
            break
    await asyncio.sleep(1)

    # 🆕 제공자 선택 후 본인인증 정보 자동입력(이름·생년월일·휴대폰 + 전체동의) — 실사용 제보로 추가.
    #    user_info 없으면 기존처럼 사용자 직접 입력(무해 폴백). 폰 최종 승인은 항상 본인.
    filled = {"name": True, "birth": True, "phone": True}
    if user_info:
        await asyncio.sleep(0.6)  # 제공자 선택 후 폼 렌더 안정 대기(동의 리셋 방지)
        filled = await _autofill_bokjiro_auth(contexts, page, user_info)
        # 🤖 규칙 자동입력이 일부 실패하면 AI 채움(β)이 화면 구조를 보고 이어받는다(gov24와 파리티).
        #    값은 로컬에서만 입력(프롬프트엔 구조만) — 키 없으면 조용히 무동작.
        if not all(filled.values()):
            try:
                from rpa.ai_fill import ai_fill
                from rpa.gov24_rpa import _birth6
                _vals = {}
                if not filled.get("name"):
                    _vals["name"] = str((user_info or {}).get("name") or (user_info or {}).get("user_name") or "")
                if not filled.get("birth"):
                    _vals["birth6"] = _birth6((user_info or {}).get("birth_date"))
                if not filled.get("phone"):
                    _ph = re.sub(r"[^0-9]", "", str((user_info or {}).get("phone", "")))
                    _vals["phone_tail"] = _ph[3:] if _ph.startswith("01") and len(_ph) >= 10 else _ph
                _fill_ctx = contexts[-1] if len(contexts) > 1 else page  # 폼이 프레임이면 그 프레임
                _ai = await ai_fill(_fill_ctx, page, {k: v for k, v in _vals.items() if v},
                                    page_hint="복지로 간편인증 본인인증 정보 입력 창", task=task)
                for _k, _dst in (("name", "name"), ("birth6", "birth"), ("phone_tail", "phone")):
                    if _ai.get(_k):
                        filled[_dst] = True
            except Exception:
                pass
    ss = await take_screenshot(page)

    form_detected = any([await detect_auth_form(ctx_) for ctx_ in contexts])
    _all_filled = all(filled.values())
    if kakaotalk_clicked and _all_filled and user_info:
        task.update("waiting_login",
            f"📱 복지로 간편인증 정보를 채우고 {pv}를 선택했어요.\n"
            f"화면의 [인증 요청]을 누른 뒤, 스마트폰 {pv} 알림에서 [인증 허용]만 눌러 주세요.\n"
            "이후 자동으로 신청 화면까지 진행됩니다.", ss)
    elif kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update("waiting_login",
            f"📱 {pv} 간편인증 화면이 열렸습니다.\n"
            f"스마트폰 {pv} 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 진행됩니다.", ss)
    else:
        task.update("waiting_login",
            f"브라우저에서 '간편인증' → '{pv}' 선택 후\n"
            f"본인인증을 완료해주세요. 📱 {pv} 알림 허용 후 자동 진행됩니다.", ss)

    login_ok = await wait_for_login(page, task, timeout_sec=300, login_url=login_url)
    if not login_ok:
        # 🔬 로그인 미감지 실화면 구조를 남긴다(팀원 확인 요망) — 복지로 간편인증은 됐는데 감지만 놓친
        #    경우를 실측 구분해 wait_for_login 을 보정. 개발 환경에서 못 보는 그 화면을 이 파일로.
        _saved = ""
        try:
            from rpa import diagnostics as _dg
            _saved = await _dg.dump(page, "복지로신청-로그인미감지",
                                    tried=["wait_for_login: URL·로그아웃 링크"], note="5분 내 로그인 미감지")
        except Exception:
            pass
        task.update("error", f"로그인 대기 시간 초과 (5분). 다시 시도해주세요.\n{_saved}".rstrip())
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ 복지로 로그인 완료!\n현재: {page.url}", ss)
    return True


# 발급·등록물 이름 ↔ 신청 폼 라벨의 표기 차이 보정 — '같은 서류를 가리키는 확신 표현'만 등재.
# 라벨이 발급명보다 짧거나('자격득실확인서' ⊄ '건강보험 자격득실확인서' 라 기존 대조 실패) 동의어일 때
# ('소득 증빙' ↔ 소득금액증명) 첨부가 성립하게 한다. 어차피 제출은 본인 확인 후(제출 직전 정지 +
# '맞게 붙었는지 확인' 안내)라 과신 위험은 사람이 걸러낸다. 키·값 모두 공백 제거 표기.
_ATTACH_ALIASES = {
    "주민등록등본": ["주민등록표등본"],
    "주민등록초본": ["주민등록표초본"],
    "소득금액증명": ["소득금액증명원", "소득증빙", "소득확인"],
    "건강보험자격득실확인서": ["자격득실확인서", "자격득실"],
    "건강보험료납부확인서": ["보험료납부확인서", "건보료납부"],
    "임대차계약서": ["전월세계약서"],
    "기초생활수급자증명서": ["수급자증명서", "수급자확인"],
    "한부모가족증명서": ["한부모증명서", "한부모확인"],
    "고용보험피보험자격이력내역서": ["피보험자격이력", "고용보험이력"],
    "통장사본": ["입금계좌", "계좌사본"],
}


_AUTH_CONTEXT_URL_KEYWORDS = ("fincert", "yeskey", "simplecert", "anyid", "kakao")

_PROFILE_FIELDS = (
    ("name", "이름", [
        "input[name='aplcntNm']", "#aplcntNm", "input[id*='aplcntNm']",
        "input[placeholder*='이름']", "input[placeholder*='성명']",
        "input[aria-label*='이름']", "input[aria-label*='성명']",
    ], ["신청인 이름", "신청인 성명", "이름", "성명"]),
    ("birth_date", "생년월일", [
        "input[placeholder*='생년월일']", "input[name*='brthdy']", "input[name*='birth']",
        "input[id*='brthdy']", "input[id*='birth']", "input[aria-label*='생년월일']",
    ], ["생년월일", "신청인 생년월일"]),
    ("phone", "휴대폰", [
        "input[placeholder*='휴대폰']", "input[placeholder*='연락처']",
        "input[name*='telno']", "input[name*='phone']", "input[id*='telno']",
        "input[id*='phone']", "input[aria-label*='휴대폰']", "input[aria-label*='연락처']",
    ], ["휴대폰 번호", "휴대전화", "연락처", "휴대폰"]),
)

_FORM_MARKERS = (
    "신청인 정보", "신청서 작성", "신청정보 입력", "가구원 정보", "첨부서류",
)


def _as_contexts(target) -> list:
    """Page/Frame 하나 또는 목록을 중복 없이 정규화한다."""
    raw = list(target) if isinstance(target, (list, tuple)) else [target]
    contexts = []
    seen = set()
    for ctx in raw:
        if ctx is None or id(ctx) in seen:
            continue
        seen.add(id(ctx))
        contexts.append(ctx)
    return contexts


def _is_auth_context(ctx) -> bool:
    try:
        url = str(ctx.url or "").lower()
    except Exception:
        return False
    return any(keyword in url for keyword in _AUTH_CONTEXT_URL_KEYWORDS)


def _apply_contexts(browser_context, preferred_page=None) -> list:
    """신청 양식 후보인 모든 열린 Page와 자식 Frame을 반환한다.

    간편인증 iframe은 이름/전화 입력칸이 있어 신청 양식으로 오인하기 쉬우므로 제외한다.
    """
    try:
        pages = [p for p in browser_context.pages if not p.is_closed()]
    except Exception:
        pages = []
    if preferred_page in pages:
        pages.remove(preferred_page)
        pages.insert(0, preferred_page)

    candidates = []
    for page in pages:
        if _is_auth_context(page):
            continue
        candidates.append(page)
        try:
            main_frame = page.main_frame
            frames = page.frames
        except Exception:
            frames = []
            main_frame = None
        for frame in frames:
            if frame == main_frame or _is_auth_context(frame):
                continue
            candidates.append(frame)
    return _as_contexts(candidates)


async def _locator_count(ctx, selector: str) -> int:
    try:
        return int(await ctx.locator(selector).count())
    except Exception:
        return 0


async def _scan_apply_state(contexts) -> dict:
    """양식 도달 여부 판정에 필요한 DOM 신호를 스냅샷으로 만든다."""
    profile_controls = 0
    file_inputs = 0
    generic_controls = 0
    urls = []
    markers = set()
    normalized = _as_contexts(contexts)
    for ctx in normalized:
        try:
            urls.append(str(ctx.url or ""))
        except Exception:
            pass
        for _key, _label, selectors, _labels in _PROFILE_FIELDS:
            for selector in selectors:
                profile_controls += await _locator_count(ctx, selector)
        file_inputs += await _locator_count(ctx, "input[type='file']")
        generic_controls += await _locator_count(
            ctx, "input:not([type='hidden']), select, textarea, [contenteditable='true']"
        )
        try:
            found = await ctx.evaluate(
                """(needles) => {
                    const text = (document.body && document.body.innerText) || '';
                    return needles.filter((needle) => text.includes(needle));
                }""",
                list(_FORM_MARKERS),
            )
            markers.update(found or [])
        except Exception:
            pass
    return {
        "context_count": len(normalized),
        "urls": tuple(sorted(set(urls))),
        "profile_controls": profile_controls,
        "file_inputs": file_inputs,
        "generic_controls": generic_controls,
        "markers": tuple(sorted(markers)),
    }


def _is_apply_form_ready(before: dict, after: dict) -> bool:
    """클릭·팝업 생성만으로 성공 처리하지 않고 실제 양식 신호의 출현을 요구한다."""
    new_profile = after.get("profile_controls", 0) > before.get("profile_controls", 0)
    new_files = after.get("file_inputs", 0) > before.get("file_inputs", 0)
    new_markers = set(after.get("markers", ())) - set(before.get("markers", ()))
    if new_profile or new_files or new_markers:
        return True

    navigated = (
        after.get("urls") != before.get("urls")
        or after.get("context_count", 0) > before.get("context_count", 0)
    )
    # 사이트 개편으로 필드명이 바뀐 경우에도, 화면 전환 뒤 일반 입력 컨트롤이 2개 이상 늘면
    # 양식 후보로 인정한다. 새 창만 뜨거나 URL만 바뀐 경우는 성공으로 보지 않는다.
    return bool(
        navigated
        and after.get("generic_controls", 0) >= 2
        and after.get("generic_controls", 0) >= before.get("generic_controls", 0) + 2
    )


async def _wait_for_apply_form(task, browser_context, preferred_page, before: dict, timeout_sec: int):
    end = asyncio.get_event_loop().time() + max(0, timeout_sec)
    latest_contexts = _apply_contexts(browser_context, preferred_page)
    latest_state = await _scan_apply_state(latest_contexts)
    while not _is_apply_form_ready(before, latest_state):
        if asyncio.get_event_loop().time() >= end:
            return False, latest_contexts, latest_state
        check_cancel(task, browser_context)
        await asyncio.sleep(0.5)
        latest_contexts = _apply_contexts(browser_context, preferred_page)
        latest_state = await _scan_apply_state(latest_contexts)
    return True, latest_contexts, latest_state


async def _fill_first(contexts, selectors: list, labels: list, value: str) -> bool:
    if not value:
        return False
    for ctx in _as_contexts(contexts):
        for selector in selectors:
            try:
                el = ctx.locator(selector).first
                if await el.count() > 0:
                    try:
                        if not await el.is_visible():
                            continue
                    except Exception:
                        pass
                    await el.fill(value)
                    return True
            except Exception:
                continue
        for label in labels:
            try:
                el = ctx.get_by_label(label, exact=False).first
                if await el.count() > 0:
                    await el.fill(value)
                    return True
            except Exception:
                continue
    return False


async def _fill_profile_fields(contexts, profile: dict) -> list:
    values = {
        "name": str((profile or {}).get("name", "") or "").strip(),
        "birth_date": re.sub(r"[^0-9]", "", str((profile or {}).get("birth_date", ""))),
        "phone": re.sub(r"[^0-9]", "", str((profile or {}).get("phone", ""))),
    }
    filled = []
    for key, display, selectors, labels in _PROFILE_FIELDS:
        if await _fill_first(contexts, selectors, labels, values[key]):
            filled.append(display)
    return filled


async def _auto_attach(target_page, issued, applicant_name: str = "") -> list:
    """파일 첨부칸의 주변 문맥(가장 가까운 행/라벨 텍스트)과 발급 서류명을 대조해 '확신 매칭'만 자동 첨부.

    - 첨부칸 문맥에 서류명이 그대로 등장할 때만 그 칸에 set_input_files (오첨부 방지)
    - 첨부칸 1개 + 발급 서류 1종이면 모호성이 없으므로 문맥 없이도 첨부
    - 실패는 조용히 건너뛰고(안내 폴백), 무엇을 어디에 붙였는지 목록으로 반환

    저장 파일명이 '{서류명}_{신청인이름}_{날짜}'라 표시명에 이름이 붙는다 →
    폼 라벨('임대차계약서')엔 이름이 없으므로, 신청인 이름 접미를 떼고 순수 서류명으로 대조한다
    (안 떼면 '임대차계약서_홍길동' ∉ '임대차계약서'라 다건 자동첨부가 전부 실패).
    """
    attached: list = []
    slots = []
    for ctx in _as_contexts(target_page):
        try:
            inputs = ctx.locator("input[type='file']")
            n = await inputs.count()
            slots.extend(inputs.nth(i) for i in range(n))
        except Exception:
            continue
    if not slots:
        return attached
    used_docs: set = set()
    who = (applicant_name or "").replace(" ", "")
    for i, el in enumerate(slots):
        try:
            ctx_text = await el.evaluate(
                "e => ((e.closest('tr,li,dl,.row,.form-group') || e.parentElement)?.innerText || '').slice(0, 300)"
            )
        except Exception:
            ctx_text = ""
        compact = (ctx_text or "").replace(" ", "")
        for doc_name, path in issued:
            raw = str(doc_name).replace(" ", "")
            # 표시명 끝의 '_신청인이름'을 떼어 순수 서류명으로 대조(폼 라벨엔 이름이 없음)
            key = raw[: -(len(who) + 1)] if (who and raw.endswith("_" + who)) else raw
            # 정확명 + 확신 별칭(라벨이 더 짧거나 동의어인 실측 표기) 중 하나라도 문맥에 있으면 매칭
            keys = [key] + _ATTACH_ALIASES.get(key, []) if key else []
            if key and doc_name not in used_docs and any(k in compact for k in keys):
                try:
                    await el.set_input_files(path)
                    used_docs.add(doc_name)
                    label = (ctx_text or "").strip().splitlines()[0][:30] if ctx_text else f"{i + 1}번째 칸"
                    # 상태 API에 신청인 이름이 섞인 파일 표시명을 노출하지 않는다.
                    attached.append(f"{key} → '{label}'")
                except Exception:
                    pass
                break
    if not attached and len(slots) == 1 and len(issued) == 1:
        try:
            await slots[0].set_input_files(issued[0][1])
            raw = str(issued[0][0]).replace(" ", "")
            key = raw[: -(len(who) + 1)] if (who and raw.endswith("_" + who)) else raw
            attached.append(f"{key} → 첨부칸")
        except Exception:
            pass
    return attached


def _valid_bokjiro_url(url: str) -> bool:
    """신청 URL은 반드시 복지로(www.bokjiro.go.kr) 것만 — 임의 URL 자동이동 방지(보안)."""
    try:
        from urllib.parse import urlparse
        u = urlparse(str(url or ""))
        return u.scheme == "https" and u.hostname in ("www.bokjiro.go.kr", "bokjiro.go.kr")
    except Exception:
        return False


def _landed_matches(body_text: str, service_name: str) -> bool:
    """(추가형) 착지 페이지가 요청 서비스의 상세인지 이름 대조 — 공백 무시 + 접두 60% 관용.
    복지로 wlfareInfoId 는 과거 타 서비스로 재배정된 전례가 있어(상단 주석), 다른 서비스
    상세에 자동 신청을 진행하는 오신청을 막는다. 표기 변형('청년월세지원' ↔ 복지로 표기
    '청년월세 한시 특별지원')은 접두 매칭으로 흡수. 빈 본문·빈 이름은 True(과차단 금지)."""
    key = re.sub(r"\s+", "", service_name or "")
    body = re.sub(r"\s+", "", body_text or "")
    if not key or not body:
        return True
    if key in body:
        return True
    head = key[: max(3, round(len(key) * 0.6))]
    return head in body


def resolve_apply_url(service_name: str, profile: dict) -> str:
    """신청 URL 결정 — ① 알려진 6종은 실측검증 하드코딩 URL 우선(딥링크가 서비스와 불일치하거나
    journey에서 여러 신청에 같은 프로필 apply_url이 잘못 재사용되는 것 방지) ② 그 밖은 프로필의
    복지로 딥링크(정책 wlfareInfoId, 호스트 검증) ③ 없으면 검색 페이지."""
    if service_name in SERVICE_APPLY_URLS:
        return SERVICE_APPLY_URLS[service_name]
    cand = (profile or {}).get("apply_url") or (profile or {}).get("applyUrl")
    if cand and _valid_bokjiro_url(cand):
        return str(cand)
    return BOKJIRO_SEARCH_URL


async def run_apply_rpa(task, service_name: str, profile: dict) -> None:
    """복지로에서 복지 서비스 신청 자동화. profile.apply_url(복지로 딥링크)이 있으면 임의 정책도 신청(일반화)."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    service_url = resolve_apply_url(service_name, profile)
    provider = str((profile or {}).get("auth_provider", "kakao") or "kakao")

    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw)
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            await context.add_init_script(NO_PRINT_SCRIPT)  # 네이티브 인쇄창 렌더러 블록 방지(감사 CRITICAL)
            page = await context.new_page()

            # ① 복지로 로그인 페이지
            task.update("running", "복지로 로그인 페이지 접속 중...")
            try:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            # ② 로그인 — profile(이름·생년월일·휴대폰)을 넘겨 간편인증 정보 자동입력
            login_ok = await _login_bokjiro(page, task, provider, user_info=profile)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 서비스 페이지 이동
            task.update("running", f"'{service_name}' 서비스 페이지로 이동 중...")
            await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
            # '신청하기' 요소가 뜨면 즉시 진행(상한 3초 = 기존 고정 sleep) — 못 찾아도 기존 흐름 그대로(eForm 폴백)
            await wait_any_visible(page, APPLY_BUTTON_SELECTORS, 3)
            ss = await take_screenshot(page)
            task.update("running", f"'{service_name}' 서비스 정보 페이지 접속 완료", ss)

            # 로그인 재요구 처리
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                login_ok = await _login_bokjiro(page, task, provider, user_info=profile)
                if not login_ok:
                    await browser.close()
                    return
                await asyncio.sleep(2)
                await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
                await wait_any_visible(page, APPLY_BUTTON_SELECTORS, 3)

            # ③.5 (추가형) 착지 대조 — 열린 상세가 요청 서비스와 다르면(복지로 ID 재배정 등)
            #     자동 클릭을 멈추고 사람이 화면을 확인하게 한다(다른 복지에 오신청 방지).
            landed_ok = True
            try:
                _body0 = await page.evaluate("() => document.body ? document.body.innerText : ''")
                landed_ok = _landed_matches(_body0, service_name)
            except Exception:
                landed_ok = True  # 판독 실패는 기존 흐름 유지(과차단 금지)
            if not landed_ok:
                task.update(
                    "waiting_login",
                    f"⚠️ 열린 페이지에서 '{service_name}' 이름을 확인하지 못했어요(복지로 페이지 변경 가능성).\n"
                    "화면을 확인해 주세요 — 맞는 서비스라면 [신청하기]를 직접 눌러 주세요. 이어서 자동 작성합니다.",
                    await take_screenshot(page),
                )

            # ④ 신청하기 버튼 클릭
            ss = await take_screenshot(page)
            # 팀원 확인 요망(감사 확정): 착지 불일치면 위 '다른 복지일 수 있다' 경고를 덮어쓰지 않는다 —
            #   기존엔 이 '탐색 중' 문구가 경고를 0초 만에 지워, 사용자가 오신청 위험을 못 보고 진행했다.
            if landed_ok:
                task.update("running", "신청하기 버튼 탐색 중...", ss)

            # 클릭 전 DOM을 기준점으로 저장한다. 팝업이 하나 늘거나 click()이 예외 없이 끝났다는 사실은
            # 실제 신청 양식 도달 증거가 아니므로 이후의 입력칸/첨부칸/양식 문구 출현과 비교한다.
            before_contexts = _apply_contexts(context, page)
            before_state = await _scan_apply_state(before_contexts)

            apply_clicked = False
            if landed_ok:  # 착지 불일치 시 자동 클릭 생략 — 사람이 확인·클릭하면 아래 감지 루프가 이어받는다
                for candidate in before_contexts:
                    if await click_first_matching(candidate, APPLY_BUTTON_SELECTORS):
                        apply_clicked = True
                        break
                if not apply_clicked:
                    # 복지로 '신청하기'는 eForm(clipsoft) 위젯 — 합성 클릭에 무반응이라 좌표 기반 신뢰 클릭으로 폴백
                    for candidate in before_contexts:
                        if (await click_eform_button(candidate, "신청하기")
                                or await click_eform_button(candidate, "신청")):
                            apply_clicked = True
                            break

            form_detected = False
            form_contexts = before_contexts
            form_state = before_state
            if apply_clicked:
                # ④.5 (추가형) '서비스 선택' 화면이 끼면 체크→[저장 후 다음단계]→확인창까지 통과(실측 브리지).
                #     시그니처 없으면 no-op — 기존 흐름 무영향.
                try:
                    await _pass_service_select_page(page, task, service_name)
                except Exception:
                    pass
                task.update("running", "신청 양식이 실제로 열렸는지 확인 중...")
                form_detected, form_contexts, form_state = await _wait_for_apply_form(
                    task, context, page, before_state, 12
                )

            if not form_detected:
                ss = await take_screenshot(page)
                # 팀원 확인 요망(감사 확정): 착지 불일치면 '직접 눌러주세요' 안내에 오신청 경고를 함께 실어
                #   사용자가 서비스명을 확인하고 누르게 한다(경고 없이 클릭 유도 → 다른 복지 오신청 방지).
                _mismatch = "" if landed_ok else (
                    f"⚠️ 열린 페이지가 요청하신 '{service_name}'와 다를 수 있어요 — 화면의 서비스명을 꼭 확인하세요.\n")
                task.update("running",
                    _mismatch +
                    f"'{service_name}' 신청 양식 자동 열기를 확인하지 못했어요.\n"
                    "브라우저에서 '신청하기' 버튼을 직접 눌러주세요.\n"
                    "입력 양식이 나타나면 에이전트가 감지해 이어서 작성합니다.", ss)
                form_detected, form_contexts, form_state = await _wait_for_apply_form(
                    task, context, page, before_state, 30
                )
                if not form_detected:
                    # (추가형) 수동 클릭·늦은 렌더로 '서비스 선택' 화면이 지금 떠 있을 수 있음 —
                    # 브리지 재시도(시그니처 없으면 즉시 no-op) 후 통과 시에만 양식을 다시 기다린다.
                    try:
                        if await _pass_service_select_page(page, task, service_name, wait_sec=4):
                            form_detected, form_contexts, form_state = await _wait_for_apply_form(
                                task, context, page, before_state, 12
                            )
                    except Exception:
                        pass

            ss = await take_screenshot(page)
            task.update("running", "신청 화면 분석 중...", ss)

            # ⑤ 팝업 확인
            target_page = page
            open_pages = [p for p in context.pages if not p.is_closed()]
            if len(open_pages) > 1:
                target_page = open_pages[-1]
                await target_page.bring_to_front()
                ss = await take_screenshot(target_page)
                task.update("running", "신청 팝업 창 감지 — 입력 가능한 양식 확인 중...", ss)

            # ⑥ 기본 양식 자동 작성 (이름·생년월일·연락처)
            name = str((profile or {}).get("name", "") or "")
            filled_fields = await _fill_profile_fields(form_contexts, profile) if form_detected else []
            # 🧠 의미 계층 보강 — 하드코딩 셀렉터가 못 잡은 신청인 칸을 접근성 이름으로 채운다(멱등·빈 칸만).
            #    이름·휴대폰만(명확) 라우팅해 오입력 위험 없이 자동신청 폼 완성도를 높인다.
            if form_detected:
                try:
                    from rpa.ai_fill import ai_fill
                    _ph = re.sub(r"[^0-9]", "", str((profile or {}).get("phone", "")))
                    _av = {}
                    if name:
                        _av["name"] = name
                    if _ph:
                        _av["phone_tail"] = _ph[3:] if _ph.startswith("01") and len(_ph) >= 10 else _ph
                    if _av:
                        _fc = form_contexts[-1] if len(form_contexts) > 1 else page
                        _got = await ai_fill(_fc, page, _av, page_hint="복지로 복지서비스 신청 양식(신청인 정보)")
                        if _got.get("name") and "이름" not in filled_fields:
                            filled_fields.append("이름")
                except Exception:
                    pass

            # ⑦ 발급 서류 '자동 첨부' — 첨부칸 주변 문맥(라벨·행 텍스트)과 발급 서류명이 일치하는
            #    '확신 매칭'만 자동으로 붙인다(오첨부 방지). 단일 첨부칸+단일 발급서류처럼 모호성이
            #    없는 경우도 첨부. 애매하면 기존처럼 정확 안내로 폴백. 제출은 여전히 본인 확인 후.
            #    (정부24 담당 확인: 정상적 발급·신청 목적의 자동화 접근은 허용 — 2026-07 사용자 확인)
            from rpa.base import recent_issued_docs, DOCS_DIR
            has_file_input = bool(form_detected and form_state.get("file_inputs", 0) > 0)
            # ⚠️ 자동 첨부 후보는 '최근 발급물'만 — 공용 PC에서 직전 사용자의 오래된 서류(주민번호 포함)가
            #    다음 사용자 신청서에 붙는 교차사용자 PII 유출 방지(감사 확정). '다음 분 상담'은 폴더를 비우고,
            #    이 시간창은 리셋을 깜빡한 경우의 2차 방어선. (안내 목록에는 전체 issued 사용)
            _attach_age = int(os.getenv("RPA_ATTACH_MAX_AGE", "1200"))  # 기본 20분
            issued = recent_issued_docs()
            attach_candidates = recent_issued_docs(within_seconds=_attach_age)
            attached = await _auto_attach(form_contexts, attach_candidates, name) if (has_file_input and attach_candidates) else []
            attach_guide = ""
            if attached:
                lst = "\n".join(f"   ✓ {a}" for a in attached)
                attach_guide = (f"\n\n📎 발급해둔 서류를 자동으로 첨부했어요:\n{lst}\n"
                                f"   제출 전 첨부칸에서 맞게 붙었는지 한 번만 확인해주세요.")
            elif has_file_input:
                for candidate in form_contexts:
                    try:
                        inputs = candidate.locator("input[type='file']")
                        if await inputs.count() > 0:
                            await inputs.first.scroll_into_view_if_needed(timeout=3000)
                            break
                    except Exception:
                        continue
                if issued:
                    lst = "\n".join(f"   • {n}" for n, _ in issued[:6])
                    attach_guide = (f"\n\n📎 서류 첨부: 아래 발급 서류를 첨부칸에 올려주세요\n{lst}\n"
                                    f"   (저장 위치: {DOCS_DIR})\n"
                                    f"   ※ '전자문서지갑' 선택이 있으면 종이·첨부 없이 바로 전자제출돼요(권장).")
                else:
                    attach_guide = ("\n\n📎 서류 첨부칸이 있어요. 서류 도우미에서 먼저 발급한 뒤 첨부하거나,\n"
                                    "   '전자문서지갑' 선택으로 종이 없이 전자제출하세요(권장).")
            elif issued:
                attach_guide = "\n\n📎 첨부칸이 안 보이면 '전자문서지갑' 방식일 수 있어요 — 발급한 전자증명서가 자동 연동됩니다."

            await asyncio.sleep(1)
            ss = await take_screenshot(target_page)
            import os as _os
            if form_detected:
                filled_summary = " · ".join(filled_fields) if filled_fields else "자동 입력 가능한 기본정보 없음"
                attached_summary = f"{len(attached)}건" if attached else "0건"
                task.update("running",
                    f"✅ '{service_name}' 신청 양식이 열렸어요!\n\n"
                    f"🖊 자동 입력: {filled_summary}\n"
                    f"📎 자동 첨부: {attached_summary}\n\n"
                    f"📋 남은 작업:\n"
                    f"1. 신청 양식의 내용을 확인해주세요\n"
                    f"2. 추가 정보가 필요하면 직접 입력해주세요"
                    + attach_guide +
                    f"\n3. 모든 내용 확인 후 '신청' 버튼을 클릭해주세요\n\n"
                    f"⚠️ 제출은 반드시 직접 확인 후 진행해주세요.", ss)
                task.result = {
                    "success": True,
                    "service_name": service_name,
                    "status": "form_ready",
                    "form_detected": True,
                    "apply_clicked": bool(apply_clicked),
                    "filled_fields": filled_fields,
                    "attached_docs": attached,
                    "file_input_count": int(form_state.get("file_inputs", 0)),
                }
            else:
                # 서비스 페이지까진 왔지만 '신청하기'를 자동으로 열지 못함 — 가짜 '양식 열림' 대신 정직 안내.
                task.update("running",
                    f"📄 '{service_name}' 신청 페이지까지 왔어요.\n\n"
                    "신청 양식이 열린 것은 확인하지 못했습니다.\n"
                    "화면에서 '신청하기' 버튼을 눌러 직접 진행해주세요.\n"
                    "(사이트 구조나 신청 기간에 따라 자동 입력을 이어가지 못할 수 있어요.)"
                    + attach_guide +
                    "\n\n⚠️ 제출은 반드시 직접 확인 후 진행해주세요.", ss)
                task.result = {
                    "success": False,
                    "service_name": service_name,
                    "status": "manual_required",
                    "manual_apply": True,
                    "form_detected": False,
                    "apply_clicked": bool(apply_clicked),
                    "filled_fields": [],
                    "attached_docs": [],
                }

            # 사용자 검토·제출 동안 브라우저 유지 — 기본 10분(RPA_REVIEW_WINDOW 초).
            # ⚠️ 과거 60초는 어르신·현장에서 검토 중에 창이 사라지는 문제 → 대폭 확장.
            #    사용자가 창을 직접 닫으면 조기 종료(불필요한 대기 없음).
            review_sec = max(60, int(_os.getenv("RPA_REVIEW_WINDOW", "600")))
            for _rw in range(review_sec // 5):
                # 명시적 [중단]만 취소로 처리한다. 검토·제출 후 브라우저를 닫는 것은 정상 종료 신호다.
                check_cancel(task)
                await asyncio.sleep(5)
                try:
                    if not context.pages or all(p.is_closed() for p in context.pages):
                        break
                except Exception:
                    break
                # 하트비트(30초마다) — 검토 창 최대 10분이 무갱신이라 '멈췄다'로 오인(실사용 피드백).
                # 살아있음 + 지금 할 일 + 종료 방법을 계속 알려준다.
                if _rw and _rw % 6 == 0:
                    try:
                        _open = [pg for pg in context.pages if not pg.is_closed()]
                        _ss = await take_screenshot(_open[-1]) if _open else None
                        _el = _rw * 5
                        if form_detected:
                            heartbeat = (
                                f"🕐 신청서 검토를 기다리는 중이에요 ({_el // 60}분 {_el % 60:02d}초 경과)\n"
                                "열린 브라우저 창에서 내용을 확인하고 [신청] 버튼으로 제출해 주세요.\n"
                                "제출을 마쳤거나 그만두려면 그 창을 닫으면 돼요(자동으로 정리됩니다)."
                            )
                        else:
                            heartbeat = (
                                f"🕐 직접 신청을 기다리는 중이에요 ({_el // 60}분 {_el % 60:02d}초 경과)\n"
                                "열린 복지로 화면에서 [신청하기]를 눌러 직접 진행해 주세요.\n"
                                "마쳤거나 그만두려면 그 창을 닫으면 돼요(자동으로 정리됩니다)."
                            )
                        task.update("running", heartbeat, _ss)
                    except Exception:
                        pass

            # 최종 스크린샷(창이 남아있을 때만)
            ss = None
            try:
                open_pages = [p for p in context.pages if not p.is_closed()]
                if open_pages:
                    ss = await take_screenshot(open_pages[-1])
            except Exception:
                pass

            if form_detected:
                task.update("done",
                    f"✅ '{service_name}' 신청 양식 준비를 마쳤어요.\n"
                    "열린 브라우저에서 내용을 확인하고 최종 제출해 주세요.\n"
                    "문의: ☎ 129 (복지로 콜센터)", ss)
            else:
                task.update("done",
                    f"⚠️ '{service_name}' 신청 페이지 안내를 마쳤어요.\n"
                    "자동 양식 준비는 완료하지 못했습니다. 열린 브라우저에서 직접 신청해 주세요.\n"
                    "문의: ☎ 129 (복지로 콜센터)", ss)

            await browser.close()

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        # 🔬 예기치 못한 실패 — 그 순간의 실화면 구조를 자동 저장(값 없음, 팀원 확인 요망: 진단만 추가·로직 무변경).
        #    복지로 로그인/신청 폼이 안 잡힐 때 개발자가 스샷 없이 실화면을 정확히 파악하게(작업방식 전환).
        _saved = ""
        try:
            _pg = locals().get("page")
            if _pg is not None:
                from rpa.gov24_rpa import _dump_diag
                _saved = await _dump_diag(_pg, f"복지로신청-예외", tried=["apply flow"], note=str(e)[:120])
        except Exception:
            pass
        task.update("error", f"자동화 오류: {str(e)[:300]}\n{_saved}".rstrip(), None)
