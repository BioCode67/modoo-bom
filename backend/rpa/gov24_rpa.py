"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)

흐름 (2026 plus.gov.kr 이전 반영):
  ① plus.gov.kr/login 접속 (옛 www.gov.kr/portal/login/memberLogin 은 soft-404)
  ② '간편인증'(button.login-type) 클릭 → simpleCert.html iframe 로드
  ③ iframe 안에서 카카오톡 선택 → 본인인증 폼(이름·생년월일·전화) → 사용자 완료 대기
  ④ 로그인 완료 → 서비스 안내 페이지(www.gov.kr/mw/AA020InfoCappView.do) 이동
  ⑤ '발급하기'(AA040OfferMainFrm) → 신청 폼 처리 → 출력/PDF

메모:
  로그인은 plus.gov.kr로 통합됐고(www.gov.kr/nlogin → plus.gov.kr/login 리다이렉트),
  서비스 안내 페이지(AA020InfoCappView.do)는 여전히 www.gov.kr에서 동작한다.
  간편인증 제공자 선택·정보입력은 페이지가 아니라 iframe(simpleCert.html) 내부에 있다.
"""
import asyncio
import os
import re
from pathlib import Path as _Path
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_provider_in_anyid, provider_display, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, launch_browser, save_document,
    check_cancel, cancellable_sleep, CancelledByUser, NO_PRINT_SCRIPT, wait_any_visible,
)

# 정부24 로그인 페이지 — 2026년 plus.gov.kr로 이전(옛 www.gov.kr/portal/login/memberLogin 은 soft-404).
WWW_GOV_LOGIN_URL = "https://plus.gov.kr/login"
# 간편인증 위젯이 로드되는 iframe URL 키워드
SIMPLECERT_FRAME_KEYWORD = "simpleCert"

# ── 서류 → 정부24 CappBizCD (단일 소스) ──
# 서류 추가는 여기 한 줄만. 코드는 CDP local_agent(selftest_agent 8종 검증)·확장(background.js)과 동일.
# ⚠️ 정직성: 여기 있는 서류는 정부24 온라인 발급(AA040/applyMinwonForm)이 실제로 되는 것만.
#   가족관계는 유형선택, 국민연금 가입자증명은 AA040 발급폼이 없어(별도 흐름) 제외 유지.
DOC_CAPP = {
    "주민등록등본": "13100000015",
    "주민등록초본": "13100000015",
    "가족관계증명서": "97400000004",
    "장애인증명서": "14600000273",
    # ↓ CDP local_agent(selftest)로 검증된 소득심사·복지신청 핵심 증명 5종 — 데스크탑앱에도 확장
    "소득금액증명": "12100000021",
    "지방세 납세증명서": "13100000056",
    "지방세 세목별 과세증명서": "13100000084",
    "기초생활수급자 증명서": "14600000280",
    "한부모가족 증명서": "10601000001",
    # ↓ 2026-07-11 AA020 실측 검증 4종(페이지 타이틀·'발급하기' 앵커 확인) — 즉시발급형·본인·무료.
    #   건보 납부확인서는 영숫자 코드(URL 빌더는 문자열 연결이라 무관). 차상위·국민연금은 발급폼
    #   미확인/별도흐름이라 보류(조사 기록: 온라인신청-정리.md).
    "국세 납세증명서": "12100000011",
    "출입국에 관한 사실증명": "12700000024",
    "병적증명서": "13000000016",
    "건강보험료 납부확인서": "SG4CADM2017",
}

# ── 동적 커버리지(사용자 PC 실측 확장) ─────────────────────────────────────
# tools/probe_gov24_docs.py --register 가 만드는 로컬 파일(docs_extra.json)을 병합한다.
# 정직 게이트(날조 금지):
#   1) 파일에 기록되는 항목은 프로브가 '정부24 실측'(검색→코드 발굴→AA020 제목·발급버튼 확인)을
#      통과한 것만이다 — 코드 추측 등재 불가.
#   2) 병합돼도 '첫 실발급 완주'가 최종 검증 — 지원목록 API가 beta 로 표기해 UI가
#      'β 첫 발급으로 최종 확인' 배지를 붙인다(실패 시 정직한 오류 + --remove 안내).
#   3) 내장(검증 완료) 서류가 항상 우선 — 같은 이름은 덮어쓰지 않는다.
#   4) 이 파일은 개인 PC 로컬 확장이며 저장소에 커밋하지 않는다(.gitignore).
_EXTRA_DOCS_PATH = _Path(os.getenv("MODOOBOM_EXTRA_DOCS", "") or (_Path(__file__).resolve().parent / "docs_extra.json"))
EXTRA_DOC_NAMES: list = []


def _load_extra_docs() -> dict:
    """docs_extra.json → {서류명: CappBizCD}. 손상·비정형 파일은 조용히 무시(부팅 불가침)."""
    try:
        if not _EXTRA_DOCS_PATH.exists():
            return {}
        import json as _json
        raw = _json.loads(_EXTRA_DOCS_PATH.read_text(encoding="utf-8"))
        out = {}
        for e in raw if isinstance(raw, list) else []:
            if not isinstance(e, dict) or not e.get("enabled", False):
                continue
            name = str(e.get("name", "")).strip()
            code = str(e.get("code", "")).strip()
            # 코드 형식 검증(정부24 CappBizCD: 영숫자 6~20자) — 이상값이 URL에 실려나가지 않게
            if not name or not re.fullmatch(r"[0-9A-Za-z]{6,20}", code):
                continue
            if name in DOC_CAPP:  # 내장 우선(검증 완료분 보호)
                continue
            out[name] = code
        return out
    except Exception:
        return {}


_extra = _load_extra_docs()
if _extra:
    DOC_CAPP.update(_extra)
    EXTRA_DOC_NAMES = list(_extra.keys())


def reload_extra_docs() -> list:
    """docs_extra.json 재적재 — **재시작 없이** 동적 서류를 반영(앱 내 [🔎 실측 확인] 직후 호출).

    · 내장(검증 완료) 서류는 불변 — 이전 동적 항목만 걷어내고 파일 현재 상태로 다시 병합
      (등록 해제(--remove/API)도 즉시 반영).
    · URL 3맵(DOC_URLS/ISSUE_URLS/APPLY_FORM_URLS)을 함께 갱신 — 발급 흐름은 호출 시점에
      이 모듈 딕셔너리를 조회하므로 in-place 갱신만으로 새 서류가 바로 발급 가능해진다.
    """
    global EXTRA_DOC_NAMES
    for n in EXTRA_DOC_NAMES:  # 이전 동적 항목 제거(내장은 EXTRA_DOC_NAMES에 없음)
        DOC_CAPP.pop(n, None)
        DOC_URLS.pop(n, None)
        ISSUE_URLS.pop(n, None)
        APPLY_FORM_URLS.pop(n, None)
    EXTRA_DOC_NAMES = []
    extra = _load_extra_docs()
    if extra:
        DOC_CAPP.update(extra)
        EXTRA_DOC_NAMES = list(extra.keys())
        for d, c in extra.items():
            DOC_URLS[d] = _info_url(c)
            ISSUE_URLS[d] = _issue_url(c)
            APPLY_FORM_URLS[d] = _apply_form_url(c)
    return EXTRA_DOC_NAMES


# 서비스 안내 페이지(AA020) — 로그인 후 접속. 발급폼(applyMinwonForm)이 안 뜰 때의 폴백 진입점.
def _info_url(capp_biz_cd: str) -> str:
    return (f"https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD={capp_biz_cd}"
            "&HighCtgCD=A01010001&tp_seq=01&Mcode=10200")


# 발급 신청 폼(AA040, 로그인 필요) — 안내 없이 바로 발급 양식.
def _issue_url(capp_biz_cd: str) -> str:
    return (f"https://www.gov.kr/mw/AA040OfferMainFrm.do?capp_biz_cd={capp_biz_cd}"
            "&HighCtgCD=A01010001&FAX_TYPE=N&img=02&selectedSeq=01")


# 새 발급 폼(plus.gov.kr) — 로그인과 같은 호스트라 세션 유지(옛 www.gov.kr/AA040 은 크로스호스트로 세션 끊김).
def _apply_form_url(capp_biz_cd: str) -> str:
    return f"https://plus.gov.kr/minwon/apply/applyMinwonForm/?cappBizCd={capp_biz_cd}&tpSeq=01"


# 세 URL 맵을 CappBizCD 단일 소스에서 생성(중복·드리프트 제거).
DOC_URLS = {d: _info_url(c) for d, c in DOC_CAPP.items()}
ISSUE_URLS = {d: _issue_url(c) for d, c in DOC_CAPP.items()}
APPLY_FORM_URLS = {d: _apply_form_url(c) for d, c in DOC_CAPP.items()}

# plus.gov.kr 간편인증 선택자 (신 UI: button.login-type)
SIMPLE_AUTH_SELECTORS = [
    "button.login-type:has-text('간편인증')",
    "button:has-text('간편인증')",
    # (구) www.gov.kr 로그인 탭 폴백
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "button:has-text('간편인증')",
    ".tab-btn:has-text('간편인증')",
    ".login-tab:has-text('간편인증')",
    # JavaScript onclick 기반 탭 전환
    "[onclick*='tab'][onclick*='easy']",
    "[onclick*='tab'][onclick*='simple']",
    # data 속성 기반
    "[data-tab='easy']",
    "[data-type='easy']",
]

# 발급/신청 버튼 선택자 (plus.gov.kr 서비스 페이지는 '발급하기' → AA040OfferMainFrm)
APPLY_SELECTORS = [
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('발급신청')",
    "button:has-text('발급신청')",
    "a:has-text('온라인신청')",
    "a:has-text('인터넷발급')",
    "a:has-text('온라인발급')",
    "a.btn_bg01",
    "input[value='신청하기']",
    ".btn-apply",
    "#btnApply",
    "#btn_apply",
]

# 발급 폼 '준비 완료' 신호 — 아래 폼 처리 코드가 이미 쓰는 셀렉터만 재사용(새 DOM 가정 금지).
# 고정 sleep(4초)을 '준비되면 즉시 진행'으로 바꾸는 조기 탈출 폴링에 사용(상한은 동일).
FORM_READY_SELECTORS = [
    "button:has-text('신청하기')",
    "#btnMinwonApply",
    "a:has-text('발급하기')",
    "select",
]

PRINT_SELECTORS = [
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "a:has-text('출력')",
    "button:has-text('저장')",
    "button:has-text('다운로드')",
    "#btnPrint",
    ".btn-print",
]


async def _get_simplecert_frame(page, timeout_sec: int = 12):
    """간편인증 위젯 iframe(plus.gov.kr/simpleCert.html) 프레임을 반환. 없으면 None.
    plus.gov.kr은 제공자 선택·본인인증 폼을 이 iframe 안에 렌더한다."""
    for _ in range(timeout_sec * 2):
        for fr in page.frames:
            if SIMPLECERT_FRAME_KEYWORD in (fr.url or ""):
                return fr
        await asyncio.sleep(0.5)
    return None


async def _request_auth(ctx) -> bool:
    """자동입력이 끝난 뒤 '인증 요청'까지 자동으로 누른다 — 사용자는 폰에서 [인증 허용]만.
    ⚠️ 이 버튼은 사용자 폰으로 인증 푸시를 보낼 뿐, 실제 본인인증 승인은 여전히 사용자가 폰에서 한다
    (법적 본인확인 단계는 자동화하지 않음). Playwright 클릭은 신뢰된 이벤트라 iframe 안에서도 동작."""
    for sel in [
        "#oacx_apply", "button:has-text('인증 요청')", "button:has-text('인증요청')",
        "a:has-text('인증 요청')", "a:has-text('인증요청')", ".btn-certification", "button.btn_confirm",
    ]:
        try:
            el = ctx.locator(sel).first
            if await el.count() > 0:
                await el.click()
                return True
        except Exception:
            continue
    return False


async def _check_agree_all(ctx) -> bool:
    """'전체동의' 체크 — ⚠️ 제공자(카카오톡) 선택이 이 체크를 지우므로(실사용 확정), 반드시
    '제공자 선택 다음, 가장 마지막'에 부른다. 여러 번 불러도 무해(이미 체크면 그대로)."""
    try:
        await asyncio.sleep(0.3)
        for sel in ["#totalAgree", "input#totalAgree", "label:has-text('전체동의')"]:
            try:
                if await ctx.locator(sel).count() > 0:
                    await ctx.check(sel) if ("input" in sel or "#totalAgree" == sel) else await ctx.click(sel)
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


async def _autofill_auth_form(ctx, user_info: dict) -> bool:
    """간편인증 본인인증 폼(iframe oacx 위젯)에 이름·생년월일·휴대폰을 자동 입력하고 전체동의 체크.
    사용자가 정보를 제공한 경우에만 동작하며, 실패해도 조용히 넘어간다(사용자가 직접 입력하면 됨).
    ※ '인증 요청'은 _request_auth로 자동 클릭. 카카오 승인(폰)은 본인이 직접(비가역 본인인증 원칙)."""
    if not user_info:
        return False
    name = str(user_info.get("user_name") or user_info.get("name") or "").strip()
    birth = re.sub(r"[^0-9]", "", str(user_info.get("birth_date", "")))
    phone = re.sub(r"[^0-9]", "", str(user_info.get("phone", "")))
    filled = False
    try:
        if name:
            await ctx.fill("#oacx_name", name); filled = True
        if birth:
            await ctx.fill("#oacx_birth", birth); filled = True
        if phone:
            tail = phone[3:] if phone.startswith("010") and len(phone) >= 10 else phone
            for sel in ["#oacx_phone2", "#oku_phone2", "input.phone"]:
                try:
                    if await ctx.locator(sel).count() > 0:
                        await ctx.fill(sel, tail); filled = True; break
                except Exception:
                    continue
        # '전체동의'는 이름·생년월일·휴대폰을 다 채운 뒤 '가장 마지막'에 체크(필드 재렌더가 동의를 지우지 않게).
        #   ⚠️ 카카오톡 재선택은 이 체크를 또 지우므로, 호출부(_login_on_www_gov)가 '제공자 재선택 → 동의 재체크'
        #      순서를 한 번 더 보장한다.
        await _check_agree_all(ctx)
    except Exception:
        pass
    return filled


async def _login_on_www_gov(page, task, user_info: dict = None) -> bool:
    """
    plus.gov.kr/login 에서 간편인증(카카오톡)으로 로그인.
    제공자 선택·정보입력은 iframe(simpleCert.html) 내부에서 처리한다.
    user_info가 있으면 본인인증 폼을 자동 입력(인증요청·폰승인은 본인).
    반환값: 로그인 성공 여부.
    """
    login_page_url = page.url
    ss = await take_screenshot(page)
    task.update("running", "정부24(plus.gov.kr) 로그인 — 간편인증 선택 중...", ss)

    # 인증수단(카카오/PASS/네이버/토스) — 어르신 다수가 카카오 미사용이라 선택 지원(현장 필수)
    provider = str((user_info or {}).get("auth_provider", "kakao") or "kakao")
    pv = provider_display(provider)

    # ① 간편인증 버튼 클릭 (신 UI: button.login-type → 텍스트 폴백)
    #   고정 1초 대기 대신 버튼이 '보이는 즉시' 진행 — 없을 때만 최대 3초 폴링(실사용: 간편인증이 느리다).
    await wait_any_visible(page, SIMPLE_AUTH_SELECTORS, 3)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if not simple_clicked:
        simple_clicked = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    # 위젯 iframe 로드는 아래 _get_simplecert_frame 이 폴링으로 기다림 — 고정 대기는 잔여 0.5초만(버벅임 제거)
    await asyncio.sleep(0.5)

    # ② 간편인증 위젯 iframe 취득 (없으면 페이지에서 직접 시도하는 폴백)
    frame = await _get_simplecert_frame(page)
    auth_ctx = frame or page
    ss = await take_screenshot(page)
    if frame:
        task.update("running", f"간편인증 위젯 로드됨 — {pv} 선택 중...", ss)
    else:
        task.update("running", f"간편인증 화면 진입 — {pv} 선택을 시도합니다...", ss)

    # ③ 인증수단 선택 (iframe 내부, 뱅크류 오클릭 제외)
    await asyncio.sleep(0.5)
    kakaotalk_clicked = await click_provider_in_anyid(auth_ctx, provider)
    # ⚠️ 제공자(카카오톡) 선택 후 본인인증 폼이 '완전히' 렌더될 때까지 기다린다(실사용 제보):
    #   너무 빨리 자동입력하면 폼 재렌더가 '전체동의' 체크를 지운다(제공자 선택이 동의를 리셋).
    #   → 카카오톡 먼저 클릭 → 폼 안정 → 이름/생년월일/휴대폰 + 전체동의 순으로 채운다.
    await _wait_auth_form_ready(auth_ctx)
    ss = await take_screenshot(page)

    # ④ 본인인증 정보 입력 폼 감지 및 안내 (iframe 컨텍스트에서 감지)
    form_detected = await detect_auth_form(auth_ctx)

    # 정보가 있으면 이름·생년월일·휴대폰 자동 입력 → 생년월일까지 있으면 '인증 요청'도 자동(폰 승인만 남김)
    autofilled = await _autofill_auth_form(auth_ctx, user_info)
    # ⚠️ 실사용 확정: 카카오톡 로고를 놓치면(또는 뒤늦게 눌리면) '개인정보 이용동의'가 풀려 다음으로 못 간다.
    #   자동입력 뒤에 카카오톡을 '한 번 더 확실히' 누르고(선택 확정), 그 다음 전체동의를 '가장 마지막에' 다시
    #   체크한다 → 순서를 '카카오톡 선택 → 동의'로 강하게 고정해 동의 리셋을 방지한다.
    reclick = await click_provider_in_anyid(auth_ctx, provider)
    if reclick:
        kakaotalk_clicked = reclick  # 재클릭이 확정(trusted)이면 자동 인증요청 게이트도 통과
    await asyncio.sleep(0.4)
    await _check_agree_all(auth_ctx)  # 카카오톡(재)선택으로 풀렸을 수 있는 전체동의를 마지막에 다시 체크
    requested = False
    _has_birth = bool(re.sub(r"[^0-9]", "", str((user_info or {}).get("birth_date", ""))))
    if autofilled:
        # ⚠️ '인증 요청'은 **제공자(카카오톡) 선택이 확인됐을 때만** 자동 클릭한다(실사용 확정 버그):
        #   선택이 안 된 채 요청하면 정부24가 "인증서비스를 선택하여 주십시오" 오류를 띄운다.
        #   (폼 자동입력은 제공자 선택과 무관하게 성공하므로, autofilled 만으로 요청하면 안 됨.)
        #   생년월일이 없어도 요청 안 함(불완전 정보 요청도 오류).
        #   ⚠️ 'trusted'(Playwright 신뢰 클릭)일 때만 자동 요청 — 'js' 폴백 클릭은 위젯이
        #      무시할 수 있어(선택 미확정) 요청 시 같은 오류가 난다. 그땐 사용자가 직접 고른다.
        if _has_birth and kakaotalk_clicked == "trusted":
            await asyncio.sleep(0.6)
            requested = await _request_auth(auth_ctx)
        await asyncio.sleep(0.5)
        ss = await take_screenshot(page)

    if autofilled:
        if requested:
            _msg = f"✅ 정보 자동입력 + '인증 요청'까지 완료했어요.\n📱 휴대폰 {pv} 알림에서 [인증 허용]만 누르시면 됩니다."
        elif kakaotalk_clicked != "trusted":
            # 제공자 자동 선택이 확인되지 않음(미클릭 또는 js 폴백) — 정보는 채웠으니
            #   사용자가 '카카오톡'만 고르면 이어짐(가장 흔한 실패 경로).
            _msg = f"✅ 이름·생년월일·휴대폰을 자동 입력했어요.\n화면에서 '{pv}'을 선택한 뒤 '인증 요청'을 누르면, 📱 알림에서 [인증 허용]만 하시면 됩니다."
        elif not _has_birth:
            _msg = f"✅ 이름·휴대폰을 자동 입력했어요.\n화면에서 '생년월일'을 입력하고 '인증 요청'을 누른 뒤, 📱 {pv} [인증 허용]을 해주세요."
        else:
            _msg = f"✅ 이름·생년월일·휴대폰을 자동 입력했어요.\n화면에서 '인증 요청'을 누르면, 📱 {pv} 알림에서 [인증 허용]만 하시면 됩니다."
        task.update("waiting_login", _msg, ss)
    elif kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update(
            "waiting_login",
            f"📱 {pv} 간편인증 화면이 열렸습니다.\n"
            f"스마트폰 {pv} 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 다음 단계가 진행됩니다.",
            ss,
        )
    else:
        task.update(
            "waiting_login",
            f"브라우저에서 '간편인증' 탭 → '{pv}' 선택 후\n"
            "본인인증 정보(이름·생년월일·전화번호)를 입력하고 '인증 요청'을 클릭해주세요.\n"
            f"📱 {pv} 알림 허용 후 자동으로 진행됩니다.",
            ss,
        )

    # 로그인 완료 대기 (최대 8분 = timeout_sec 480)
    login_ok = await wait_for_login(
        page, task, timeout_sec=480, login_url=login_page_url
    )

    if not login_ok:
        ss = await take_screenshot(page)
        task.update("error", "로그인 대기 시간 초과 (8분). 다시 시도해주세요.", ss)
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ 정부24 로그인 완료!\n현재 URL: {page.url}", ss)
    return True


async def _select_doc_form_options(page, doc_name: str) -> None:
    """발급 폼의 필수 선택을 best-effort로 채운다(신청하기 전). 선택이 없어도 무해.
    - 가족관계증명서: '일반증명서' 선택(유형 미선택이면 신청 안 넘어감)
    - 그 외: 발급목적/귀속연도/세목 등 아직 '선택' 상태(selectedIndex 0)인 select 를 첫 유효 옵션으로.
      (소득금액증명·지방세 납세/세목별·기초생활수급자·한부모 등이 목적/연도 미선택 시 발급 미완되던 것 보완)"""
    try:
        if doc_name == "가족관계증명서":
            await page.evaluate("""() => {
                const el = [...document.querySelectorAll('label,span,td,button,a')]
                    .find(e => (e.textContent || '').trim().includes('일반'));
                if (el) el.click();
            }""")
            await asyncio.sleep(0.4)
        # 미선택(0번=대개 '선택하세요') 필수 select 를 첫 '유효' 옵션(값 있고 안내문구 아님)으로.
        await page.evaluate("""() => {
            for (const s of document.querySelectorAll('select')) {
                if (s.disabled || s.selectedIndex > 0) continue;
                const opt = [...s.options].find((o, i) => i > 0 && o.value && !/선택|choose|=선택/i.test(o.text));
                if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
            }
        }""")
        await asyncio.sleep(0.4)
    except Exception:
        pass


async def _select_privacy_masking(page) -> bool:
    """🔒 발급 폼에서 '주민등록번호 뒷자리'를 비공개(미포함/미표시)로 선택 — 개인정보 최소화(사용자 요청).
    정부24 등본류 폼은 표시 항목별 포함/미포함 라디오를 제공한다. '주민등록번호'가 언급된 행에서만
    미포함/미표시/비공개 옵션을 고른다(세대원 정보 등 다른 항목은 건드리지 않음 — 복지 신청엔 필요).
    선택했으면 True. 폼에 해당 옵션이 없으면 False(무해). RPA_PRIVACY_MASK=0 으로 끌 수 있다
    (기관이 뒷자리 포함본을 요구하는 예외 대비 안전밸브)."""
    if os.environ.get("RPA_PRIVACY_MASK", "1") == "0":
        return False
    try:
        clicked = await page.evaluate("""() => {
            const rows = [...document.querySelectorAll('tr, li, dl, .form-group, fieldset')];
            let n = 0;
            for (const row of rows) {
                const t = (row.innerText || '').trim();
                // 행 단위로만(긴 컨테이너 제외) — 화면 전체를 잡아 엉뚱한 라디오를 누르지 않게
                if (t.length > 200 || !/주민등록번호/.test(t)) continue;
                const cands = [...row.querySelectorAll('label, input[type=radio]')];
                for (const el of cands) {
                    const lt = (el.tagName === 'INPUT'
                        ? (el.value || '') + ((el.nextElementSibling && el.nextElementSibling.innerText) || '')
                        : el.innerText) || '';
                    if (/미포함|미표시|비공개/.test(lt)) { el.click(); n++; break; }
                }
            }
            return n;
        }""")
        return bool(clicked)
    except Exception:
        return False


def _is_maintenance_notice(txt: str) -> bool:
    """정부 사이트 '서비스 점검 중' 팝업 감지 — 외부기관 연계 서류(가족관계=대법원, 소득=국세청 홈택스)는
    야간·새벽 점검이 잦아 이 팝업이 뜨면 '앱 오류'가 아니라 정부 사이트 상태다(정직 안내로 전환).
    ⚠️ '점검' 단독은 안내문(정기 점검 시간 안내 등)에도 흔해 오탐 → '점검 중/점검입니다/점검 시간입니다'처럼
       상태를 못박는 구절만 매칭한다(과잉 차단 방지)."""
    t = txt or ""
    return any(k in t for k in (
        "서비스 점검 중", "점검 중입니다", "점검중입니다",
        "시스템 점검 중", "점검 시간입니다", "점검으로 인해",
    ))


def _is_wallet_required(txt: str) -> bool:
    """정부24 '전자문서지갑 발급 후 사용가능' 안내 감지 — 일부 서류(가족관계증명서 등)는 전자발급에
    '전자문서지갑'(정부24 모바일 앱에서 로그인 후 설정)이 선행돼야 한다. 앱 무설정 상태에선 자동발급이
    안 되므로, 점검과 구분해 정직 안내로 전환한다(실사용 제보: 가족관계 타일이 '전자문서지갑' 팝업)."""
    t = txt or ""
    return ("전자문서지갑" in t) and (("발급 후" in t) or ("사용가능" in t) or ("APP" in t) or ("앱" in t))


def _direct_site_hint(doc_name: str) -> str:
    """서류별 '원 발급처 직행' 안내 조각 — 정부24 경로가 막혀도 원 발급처는 대개 정상(실측 확인:
    가족관계는 대법원 efamily가 24시간 발급됨·사용자 스크린샷). 앱의 [전자발급] 버튼이 그리로 간다."""
    if "가족관계" in (doc_name or ""):
        return (
            "원 발급처인 대법원 전자가족관계등록시스템(efamily.scourt.go.kr)은 지금도 발급됩니다 — "
            "옆 [전자발급] 버튼으로 바로 가세요(인터넷 무료·본인인증 필요)."
        )
    if "소득금액" in (doc_name or "") or "납세" in (doc_name or ""):
        return "국세청 홈택스는 08~22시 운영이라 낮 시간에 다시 시도하거나, 옆 [전자발급]으로 직접 발급하세요."
    return "옆 [전자발급]으로 공식 사이트에서 직접 발급해 주세요."


def _wallet_msg(doc_name: str) -> str:
    """전자문서지갑 필요 안내 — 앱 오류가 아니라 정부24 전자발급 사전조건임을 정직하게 안내."""
    return (
        f"‘{doc_name}’은(는) 정부24 경로로는 ‘전자문서지갑’ 설정이 먼저 필요해요(정부24 모바일 앱에서 설정 · 앱 오류 아님). "
        f"등본과 발급 경로가 달라 앱 무설정 상태에선 정부24 자동발급이 어려워요. {_direct_site_hint(doc_name)}"
    )


def _maintenance_msg(doc_name: str) -> str:
    """점검 팝업 감지 시 사용자에게 보여줄 정직 안내 — ⚠️ 실측(2026-07-20): '정부24 연계 경로'가 막힌
    것이지 원 발급처(대법원 efamily 등)는 정상인 경우가 있다. '사이트 전체 점검'으로 단정하지 않는다."""
    return (
        f"정부24의 ‘{doc_name}’ 연계 경로가 점검 중이에요(정부24 연계 상태 · 앱 오류 아님). "
        f"{_direct_site_hint(doc_name)}"
    )


async def _maintenance_popup_text(page) -> str:
    """'보이는 모달/팝업/알림' 컨테이너의 텍스트만 전체 프레임에서 모은다.
    ⚠️ 실사용 제보: 사이트는 정상 발급되는데 앱이 '점검 중'으로 오판하면 안 된다(직접 하면 됨).
       페이지 본문 전체를 훑으면 안내 보일러플레이트('…점검 중에는 이용 불가')까지 잡혀 오탐 →
       실제 점검 팝업은 '모달/레이어'로 뜨므로, 그 컨테이너만 골라 검사해 오탐을 막는다.
       연계기관 iframe(대법원 가족관계·국세청 홈택스)에 떠도 잡히도록 전체 프레임을 순회한다.
    cross-origin·소멸 프레임은 접근 시 예외라 조용히 건너뛴다(무해)."""
    js = (
        "() => {"
        "  const sels = '[role=\"dialog\"],[role=\"alertdialog\"],.modal,.popup,.layer,.layerPopup,"
        ".dialog,.alert,[class*=\"popup\"],[class*=\"modal\"],[class*=\"layer\"]';"
        "  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);"
        "    return r.width > 40 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };"
        "  return [...document.querySelectorAll(sels)].filter(vis).map(el => el.innerText || '').join('\\n');"
        "}"
    )
    parts = []
    for fr in page.frames:
        try:
            t = await fr.evaluate(js)
            if t:
                parts.append(t)
        except Exception:
            continue
    return "\n".join(parts)


async def _wait_auth_form_ready(ctx, timeout_sec: int = 5) -> None:
    """제공자(카카오톡) 선택 후 본인인증 입력 폼(이름/생년월일 필드)이 실제로 렌더될 때까지 대기.
    ⚠️ 실사용 제보: 제공자 클릭 직후 너무 빨리 자동입력하면, 폼 재렌더가 '전체동의' 체크를 지운다
       (제공자 선택이 동의를 리셋). 필드가 나타난 뒤 + 렌더 여유를 두고 진행해 동의 체크가 유지되게 한다."""
    for _ in range(max(1, timeout_sec * 2)):
        try:
            for sel in ("#oacx_name", "#oacx_birth", "input[placeholder*='이름']", "input[placeholder*='생년월일']"):
                if await ctx.locator(sel).count() > 0:
                    await asyncio.sleep(0.7)  # 렌더 완료 여유 — 이후 자동입력·동의 체크가 안정적으로 남는다
                    return
        except Exception:
            pass
        await asyncio.sleep(0.5)


async def _wait_document_rendered(page, timeout_sec: int = 12) -> None:
    """문서출력 뷰어의 '본문'이 실제로 렌더될 때까지 대기 — 빈 PDF 저장 방지.
    ⚠️ 실사용 제보: 발급은 되는데 너무 빨리 캡처해 '헤더만 있고 본문 빈' PDF가 저장됐다.
       네트워크 안정화 후, 문서 뷰어가 그린 캔버스/이미지/embed 또는 충분한 본문 텍스트가
       나타날 때까지 폴링한다. 못 찾아도 최대 대기 후 진행(어떤 경우든 캡처는 한다)."""
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout_sec * 1000)
    except Exception:
        pass
    js = (
        "() => {"
        "  const big = el => el && el.getBoundingClientRect().width > 120 && el.getBoundingClientRect().height > 120;"
        "  const hasCanvas = [...document.querySelectorAll('canvas')].some(c => c.width > 120 && c.height > 120);"
        "  const hasImg = [...document.querySelectorAll('img')].some(i => i.naturalWidth > 120 && i.naturalHeight > 120);"
        "  const hasEmbed = big(document.querySelector('embed, object, iframe'));"
        "  const textLen = (document.body ? document.body.innerText : '').replace(/\\s/g,'').length;"
        "  return hasCanvas || hasImg || hasEmbed || textLen > 300;"
        "}"
    )
    for _ in range(max(1, timeout_sec * 2)):
        try:
            if await page.evaluate(js):
                await asyncio.sleep(2.0)  # 렌더/페인트 완료 여유 — 캡처가 본문을 담게
                return
        except Exception:
            pass
        await asyncio.sleep(0.5)
    await asyncio.sleep(2.0)  # 신호 못 잡아도 최소 여유 후 캡처(빈 화면보다 늦더라도 담기게)


def _pick_result_page(context, fallback):
    """발급 결과 페이지를 고른다 — 무관한 팝업/탭이 최신(pages[-1])이면 엉뚱한 화면을 저장하던 것 방지(감사 :555).
    URL 만 검사(evaluate 없음 → 렌더러 블록 위험 없음): 발급 결과 경로를 담은 살아있는 페이지 우선, 없으면 최신."""
    try:
        alive = [p for p in context.pages if not p.is_closed()]
        if not alive:
            return fallback
        for p in reversed(alive):  # 최신부터
            try:
                u = p.url or ""
            except Exception:
                continue
            if any(k in u for k in ("mbrAplySrvcList", "AplyView", "issue", "gov.kr")):
                return p
        return alive[-1]
    except Exception:
        return fallback


# ── 가족관계증명서: 원 발급처(대법원 전자가족관계등록시스템) 직행 자동화(β) ──
# 실측(2026-07-20, 사용자 스크린샷 5장): 정부24 경로는 '전자문서지갑' 선행+연계 차단으로 실사용 불가,
# efamily 는 24시간 무료 발급 확인. URL·화면 구성(신청인 정보조회→간편인증→신청하기)은 스크린샷 실측,
# 요소는 텍스트·라벨 기반 셀렉터(개편에 강함 — 컨테이너는 정부망 차단이라 DOM ID 실측 불가).
EFAMILY_HOME = "https://efamily.scourt.go.kr/index.jsp"
EFAMILY_APPLY = "https://efamily.scourt.go.kr/pt/PtFrrpApplrInfoInqW.do?menuFg=02"


def _birth6(birth_date) -> str:
    """생년월일 → 주민등록번호 앞 6자리(YYMMDD). '20010601'→'010601', '010601' 그대로, 그 외 ''."""
    d = re.sub(r"[^0-9]", "", str(birth_date or ""))
    if len(d) >= 8:
        return d[2:8]
    if len(d) == 6:
        return d
    return ""


async def _issue_family_cert_efamily(page, task, context, user_info: dict = None) -> None:
    """가족관계증명서 — efamily 직행 발급(β).

    흐름(실측): ① 신청인 정보조회 페이지 → 약관 동의 + 성명·주민번호 앞자리 자동 입력
    ② 🔒 주민등록번호 뒷자리·부/모 성명은 **본인이 정부 화면에 직접 입력**(앱은 이 정보를 수집·저장하지
       않는다 — 프라이버시 설계) → [간편인증] 클릭도 본인
    ③ 간편인증 모달이 뜨면 카카오톡 선택·휴대폰·전체동의를 채워주고, 뒷자리 입력+[인증 요청]은 본인
    ④ 폰 승인 후 증명서 화면 도달 → '일반증명서' 선택·[신청하기] 자동 → 문서 렌더 대기 → PDF 저장.
    각 단계 실패 시 정직 안내 + 화면을 그대로 남겨 사람이 이어서 할 수 있게 한다(β — 무언 실패 금지)."""
    ui = user_info or {}
    name = str(ui.get("user_name") or ui.get("name") or "").strip()
    birth6 = _birth6(ui.get("birth_date"))
    phone = re.sub(r"[^0-9]", "", str(ui.get("phone", "")))
    provider = str(ui.get("auth_provider", "kakao") or "kakao")

    task.update("running", "📄 가족관계증명서(β) — 원 발급처인 대법원 전자가족관계등록시스템으로 이동해요...")
    # ① 신청 페이지 직행(실측 URL) → 실패 시 홈에서 타일 클릭 폴백
    try:
        await page.goto(EFAMILY_APPLY, wait_until="domcontentloaded", timeout=30000)
    except Exception:
        await page.goto(EFAMILY_HOME, wait_until="domcontentloaded", timeout=40000)
        await click_by_text(page, ["가족관계증명서"])
        await asyncio.sleep(2)
    check_cancel(task, context)
    await asyncio.sleep(1.5)

    # ② 약관 동의 체크 + 성명·주민번호 앞 6자리 자동 입력(행 라벨 기반 — ID 미실측이라 텍스트로)
    try:
        await page.evaluate(
            """(v) => {
                // 약관 동의: '이용약관에 동의' 문구 주변의 체크박스
                for (const c of document.querySelectorAll('input[type=checkbox]')) {
                    const t = ((c.closest('label') || c.parentElement || {}).innerText || '') +
                              ((c.parentElement && c.parentElement.parentElement) ? c.parentElement.parentElement.innerText : '');
                    if (t.includes('이용약관')) { if (!c.checked) c.click(); break; }
                }
                const fire = (el) => { el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); };
                for (const tr of document.querySelectorAll('tr')) {
                    const head = ((tr.querySelector('th, td') || {}).innerText || '').trim();
                    const inputs = [...tr.querySelectorAll("input[type=text], input:not([type])")];
                    if (/^성명/.test(head) && inputs[0] && v.name) { inputs[0].value = v.name; fire(inputs[0]); }
                    // 주민등록번호 행: 앞 6자리만 채운다(뒷자리는 본인 직접 — 앱 미수집)
                    if (/^주민등록번호/.test(head) && inputs[0] && v.birth6) { inputs[0].value = v.birth6; fire(inputs[0]); }
                }
            }""",
            {"name": name, "birth6": birth6},
        )
    except Exception:
        pass
    ss = await take_screenshot(page)
    task.update(
        "waiting_login",
        "📋 신청인 정보를 채웠어요(성명·주민번호 앞자리).\n"
        "🔒 화면에서 **주민등록번호 뒷자리**와 **부/모 성명**을 직접 입력해 주세요 — 앱은 이 정보를 저장하지 않아요.\n"
        "입력 후 [간편인증]을 누르면, 인증창은 이어서 도와드릴게요.",
        ss,
    )

    # ③ 간편인증 모달 등장 대기 → 카카오톡 선택 + 휴대폰 채움 + 전체동의(마지막). 인증요청은 본인(뒷자리 필요).
    modal_ready = False
    for _w in range(240):  # 최대 ~8분(약관·정보 입력 + 인증까지 사람 속도)
        check_cancel(task, context)
        try:
            body = await page.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            body = ""
        # 인증 완료 후 화면(신청 폼)으로 이미 넘어갔으면 ④로
        if ("신청하기" in body or "일반증명서" in body) and "인증 요청" not in body:
            modal_ready = False
            break
        if (not modal_ready) and ("인증 요청" in body and "전체동의" in body):
            modal_ready = True
            await click_provider_in_anyid(page, provider)
            await asyncio.sleep(0.6)
            if phone:
                try:
                    await page.evaluate(
                        """(tail) => {
                            const fire = (el) => { el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); };
                            for (const tr of document.querySelectorAll('tr, li, div')) {
                                const t = (tr.innerText || '').trim();
                                if (t.length < 80 && t.includes('휴대폰')) {
                                    const inp = [...tr.querySelectorAll("input[type=text], input[type=tel], input:not([type])")].pop();
                                    if (inp && !inp.value) { inp.value = tail; fire(inp); return; }
                                }
                            }
                        }""",
                        phone[3:] if phone.startswith("010") and len(phone) >= 10 else phone,
                    )
                except Exception:
                    pass
            await _check_agree_all(page)  # 전체동의는 제공자 선택 뒤 '마지막에'(동의 리셋 방지 — 정부24와 동일 순서)
            task.update(
                "waiting_login",
                "📱 인증창을 채웠어요(카카오톡·휴대폰·전체동의).\n"
                "🔒 **주민등록번호 뒷자리**만 직접 입력하고 [인증 요청]을 누른 뒤, 폰에서 [인증 허용]을 해주세요.",
                await take_screenshot(page),
            )
        if _w and _w % 15 == 0:
            task.update("waiting_login", f"진행을 기다리는 중이에요… ({_w * 2}초) 화면 안내대로 입력·인증해 주세요.", await take_screenshot(page))
        await asyncio.sleep(2)

    # ④ 인증 후 증명서 신청 화면 — '일반증명서' 선택(있으면) + [신청하기] → 문서 렌더 대기 → 저장
    check_cancel(task, context)
    await click_by_text(page, ["일반증명서"])
    await asyncio.sleep(0.8)
    if not await click_by_text(page, ["신청하기", "발급하기", "발급 신청"]):
        await click_first_matching(page, ["button:has-text('신청')", "a:has-text('신청')", "input[value*='신청']"])
    await asyncio.sleep(3)
    final_page = _pick_result_page(context, page)
    await _wait_document_rendered(final_page)
    body_now = ""
    try:
        body_now = await final_page.evaluate("() => document.body ? document.body.innerText : ''")
    except Exception:
        pass
    saved = await save_document(final_page, "가족관계증명서", name)
    if saved:
        task.update(
            "done",
            f"✅ 가족관계증명서 발급 완료(β · 대법원 efamily)!\n📄 자동 저장됨: {saved}\n브라우저는 60초 후 자동 종료됩니다.",
            await take_screenshot(final_page),
        )
        task.result = {"success": True, "doc_name": "가족관계증명서", "saved_path": saved}
    else:
        # 저장까지 확인 못 함 — 화면은 그대로 두고 사람이 마무리(β 정직성: 성공 날조 금지)
        task.update(
            "done",
            "⚠️ 가족관계증명서(β) — 자동 저장까지는 확인하지 못했어요.\n"
            + ("화면에 증명서가 떠 있으면 [출력/저장]으로 마무리해 주세요.\n" if ("증명서" in body_now or "출력" in body_now) else "화면 안내대로 남은 단계를 마무리해 주세요.\n")
            + "브라우저는 60초 후 자동 종료됩니다.",
            await take_screenshot(final_page),
        )
        task.result = {"success": False, "doc_name": "가족관계증명서"}


async def run_gov24_rpa(task, doc_name: str, user_info: dict = None, session=None) -> None:
    """정부24에서 서류 발급. user_info(이름·생년월일·휴대폰) 있으면 본인인증 폼 자동입력.

    session(GovSession)이 오면 '여정 공유 세션' 모드 — 브라우저·로그인을 여정의 서류들이 공유해
    카카오 로그인 인증이 서류 수만큼이 아니라 **1회**가 된다(진짜 한 번 인증 연쇄).
    서류별 폼 흐름·성공판정은 단독 실행과 완전히 동일하고, 브라우저 수명·로그인 여부만 다르다:
    · 첫 서류: 세션에 브라우저 생성 + 로그인(성공 시 session.logged_in) · 이후 서류: 폼 직행
    · 로그인 만료·창 닫힘: 기존 재로그인 감지·session.ensure() 재생성이 자연 복구
    · 브라우저 종료는 여정(orchestrator finally)이 담당 — 여기선 세션 브라우저를 닫지 않는다."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    doc_url = DOC_URLS.get(doc_name)
    if not doc_url:
        task.update("error", f"지원하지 않는 문서: {doc_name}")
        return

    import contextlib as _ctxlib
    try:
        async with _ctxlib.AsyncExitStack() as _stack:
            if session is None:
                pw = await _stack.enter_async_context(async_playwright())
                browser = await launch_browser(pw)
                context = await browser.new_context(**make_browser_context_args())
                await context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
                )
                # 네이티브 인쇄 다이얼로그가 렌더러를 블록해 이후 evaluate/count 가 무한 동결되던 것 차단(감사 CRITICAL)
                await context.add_init_script(NO_PRINT_SCRIPT)
                page = await context.new_page()
            else:
                # 여정 공유 세션 — 죽었으면 재생성(logged_in 리셋), 살아있으면 그대로 재사용
                await session.ensure()
                browser, context, page = session.browser, session.context, session.page

            # 🆕 가족관계증명서는 원 발급처(대법원 efamily) 직행(β) — 정부24 경로는 전자문서지갑
            #    선행+연계 차단으로 실사용 불가 확정(2026-07-20 실측). RPA_FAMILY_EFAMILY=0 이면 기존 경로.
            #    efamily 는 자체 인증이라 여정 공유 로그인과 무관 — 발급 후 다음 서류는 plus.gov.kr 로
            #    복귀하며 쿠키 세션이 유지된다(같은 컨텍스트 내 탐색).
            if "가족관계" in doc_name and os.environ.get("RPA_FAMILY_EFAMILY", "1") != "0":
                await _issue_family_cert_efamily(page, task, context, user_info)
                if session is None:
                    await cancellable_sleep(60, task, context)
                    await browser.close()
                return

            if session is not None and session.logged_in:
                # 🔑 같은 로그인으로 이어서 — 로그인 페이지를 건너뛰고 발급 폼 직행(추가 인증 없음).
                #    만료됐다면 아래 발급 폼의 재로그인 감지가 그때 정직하게 재인증을 안내한다.
                task.update("running", f"📄 {doc_name} — 같은 로그인으로 이어서 발급해요(추가 로그인 없이 폼 직행)...")
            else:
                # ① www.gov.kr 로그인 페이지 직접 접속 (세션 수립용)
                task.update("running", f"📄 {doc_name} 발급 준비 — 정부24 로그인/간편인증으로 이동 중...")
                try:
                    await page.goto(WWW_GOV_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    await page.goto(WWW_GOV_LOGIN_URL, wait_until="load", timeout=40000)
                # 간편인증 버튼이 뜨면 즉시 진행(상한 3초 = 기존 고정 sleep과 동일) — 서류당 수 초 단축
                await wait_any_visible(page, SIMPLE_AUTH_SELECTORS, 3)

                ss = await take_screenshot(page)
                task.update("running", f"로그인 페이지 로드 완료\n현재 URL: {page.url}", ss)

                # ② 간편인증(카카오톡) 로그인 수행
                login_ok = await _login_on_www_gov(page, task, user_info)
                if not login_ok:
                    if session is None:
                        await browser.close()
                    return
                if session is not None:
                    session.logged_in = True  # 다음 서류부터 폼 직행 — 이 여정의 로그인 인증은 이것으로 끝

                await asyncio.sleep(2)

            # ③ 새 발급 폼(plus.gov.kr) — 로그인과 같은 호스트라 세션 유지(옛 www.gov.kr/AA040 은 크로스호스트로 끊겼음)
            form_url = APPLY_FORM_URLS.get(doc_name) or ISSUE_URLS.get(doc_name, doc_url)
            task.update("running", f"{doc_name} 발급 폼으로 이동 중...")
            await page.goto(form_url, wait_until="domcontentloaded", timeout=30000)
            # 폼 요소가 뜨면 즉시 진행(상한 4초 = 기존과 동일) — 늦게 뜨는 페이지만 끝까지 기다린다
            await wait_any_visible(page, FORM_READY_SELECTORS, 4)

            # 폼에서 재로그인 요구되면 한 번 더 인증(공유 세션의 로그인 만료도 이 경로가 복구)
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                task.update("running", "재로그인이 필요해요 — 다시 인증합니다...")
                if not await _login_on_www_gov(page, task, user_info):
                    if session is None:
                        await browser.close()
                    return
                if session is not None:
                    session.logged_in = True
                await page.goto(form_url, wait_until="domcontentloaded", timeout=30000)
                await wait_any_visible(page, FORM_READY_SELECTORS, 4)

            # 초본이면 서비스 선택에서 '초본'을 고른다(기본은 등본)
            if doc_name == "주민등록초본":
                await click_by_text(page, ["주민등록표 초본 발급"])
                await asyncio.sleep(1)

            ss = await take_screenshot(page)
            task.update("running", "발급 폼 로드 — 신청하기 진행", ss)

            async def _txt():
                try:
                    return await page.evaluate("() => document.body ? document.body.innerText : ''")
                except Exception:
                    return ""

            # 주소 자동 선택 — 회원정보 주소가 실제 주민등록과 다를 때, 제공된 시도·시군구로 자동 정정(헤드리스에서도 동작)
            sido = str((user_info or {}).get("sido") or "").strip()
            sigungu = str((user_info or {}).get("sigungu") or "").strip()
            if sido or sigungu:
                try:
                    if sido:
                        await page.evaluate(
                            """(v) => {
                                const ss = [...document.querySelectorAll('select')];
                                const sel = ss.find(s => [...s.options].some(o => o.text.includes('경상북도') || o.text.includes('서울특별시')));
                                if (sel) { const o = [...sel.options].find(o => o.text.includes(v)); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', {bubbles:true})); } }
                            }""", sido,
                        )
                        await asyncio.sleep(1.5)  # 시군구 옵션 로드 대기
                    if sigungu:
                        await page.evaluate(
                            """(v) => {
                                const ss = [...document.querySelectorAll('select')];
                                const sel = ss.find(s => [...s.options].some(o => o.text.includes(v)));
                                if (sel) { const o = [...sel.options].find(o => o.text.includes(v)); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', {bubbles:true})); } }
                            }""", sigungu,
                        )
                        await asyncio.sleep(0.8)
                    task.update("running", f"주민등록상 주소를 {sido} {sigungu}(으)로 설정했어요.", await take_screenshot(page))
                except Exception:
                    pass

            # ③.5 발급 폼의 유형/발급목적/귀속연도 등 필수 선택(가족관계 '일반' + 미선택 select 기본값).
            #   소득금액증명·지방세·기초생활수급자·한부모 등은 발급목적/연도 미선택이면 신청이 안 넘어가 발급이 미완됨.
            await _select_doc_form_options(page, doc_name)
            # 🔒 개인정보 최소화(사용자 요청): 주민등록번호 뒷자리는 비공개(미포함/미표시)로 — 실제 선택된 경우에만 안내
            if await _select_privacy_masking(page):
                task.update(
                    "running",
                    "🔒 주민등록번호 뒷자리는 '비공개(미포함)'로 선택했어요 — 서류에 민감정보가 덜 실려요.\n"
                    "(제출처가 뒷자리 포함본을 요구하면 화면에서 '포함'으로 바꿔 주세요)",
                    await take_screenshot(page),
                )

            # ④ 신청하기 — 자동입력만으로 다음 단계로 못 넘어가면(주소 불일치·필수항목 미선택 등)
            #    사용자가 화면 폼을 직접 고칠 시간을 준 뒤 자동으로 다시 신청한다(human-in-the-loop 보정).
            submitted = False
            addr_warned = False
            fix_hinted = False   # '폼을 직접 확인/선택' 안내를 이미 띄웠는지(중복 안내 방지)
            stuck = 0            # 진행 신호 없이 헛돈 횟수 — 일정 이상이면 사용자 수정 유예 부여
            task.update("running", "신청 버튼을 눌러 발급을 진행하고 있어요…", await take_screenshot(page))
            # 폼 진입 직후 팝업 확인 — 점검(연계기관 야간)·전자문서지갑 필요는 헛돌지 않고 즉시 정직 안내.
            _popup0 = await _maintenance_popup_text(page)
            if _is_maintenance_notice(_popup0):
                task.update("error", _maintenance_msg(doc_name), await take_screenshot(page))
                return
            if _is_wallet_required(_popup0):
                task.update("error", _wallet_msg(doc_name), await take_screenshot(page))
                return
            for _hb in range(24):  # 최대 ~4분(주소·폼 정정 대기 포함)
                check_cancel(task, context)  # 취소·창닫힘 즉시 탈출
                # 하트비트: 침묵 구간(과거 최대 4분 무갱신 → '멈췄다' 오인, 실사용 피드백)마다 진행 화면 공유.
                # ⚠️ 대기 안내(주소·폼 수정)는 generic 문구로 '해야 할 일 안내'를 덮어쓰지 않는다(자가 검토 회귀)
                #    — 대신 같은 안내를 새 스크린샷과 함께 반복해 살아있음을 보여준다.
                if _hb and _hb % 4 == 0:
                    if addr_warned:
                        task.update(
                            "waiting_login",
                            "⚠️ 화면의 '주민등록상 주소'를 본인 주소(시도·시군구)로 바꿔 주세요.\n"
                            "바꾸면 자동으로 다시 신청합니다. (계속 기다리는 중…)",
                            await take_screenshot(page),
                        )
                    elif fix_hinted:
                        task.update(
                            "waiting_login",
                            "⚠️ 화면 폼에서 필요한 항목(대상자·발급목적·유형 등)이 있으면 직접 확인/선택해 주세요.\n"
                            "고치면 잠시 후 자동으로 다시 신청합니다. (계속 기다리는 중…)",
                            await take_screenshot(page),
                        )
                    else:
                        task.update("running", f"발급 처리 진행 중… ({_hb * 5}초 경과) — 브라우저 창을 닫지 마세요.", await take_screenshot(page))
                # 발급 진행 버튼 — plus.gov.kr 발급폼은 '신청하기', 안내페이지(AA020) 폴백은 '발급하기'.
                if not await click_by_text(page, ["신청하기", "민원신청하기", "발급하기"]):
                    await click_first_matching(page, ["button:has-text('신청하기')", "a:has-text('발급하기')", "button:has-text('발급하기')", "#btnMinwonApply", "#btnApply", "input[value*='신청']"])
                await asyncio.sleep(3)
                txt = await _txt()
                # 🛠 정부 사이트 '서비스 점검 중' 팝업 — 등본(행안부·24h)과 달리 가족관계(대법원 전자가족관계등록)·
                #   소득금액증명(국세청 홈택스 08~22시) 등 외부기관 연계 서류는 야간·새벽 점검이 잦다.
                #   ⚠️ 팝업은 연계기관 iframe 안에 뜰 수 있어 메인 body만 보면 놓친다(실사용: '지연'으로만 보임)
                #      → 메인+전체 프레임 텍스트를 함께 확인. 4분 헛돌지 않고 즉시 정직 안내.
                _popup = await _maintenance_popup_text(page)
                if _is_maintenance_notice(_popup):
                    task.update("error", _maintenance_msg(doc_name), await take_screenshot(page))
                    return
                if _is_wallet_required(_popup):
                    task.update("error", _wallet_msg(doc_name), await take_screenshot(page))
                    return
                # 주소 불일치 안내 모달 → 닫고, 사용자가 시도·시군구를 고칠 때까지 대기 후 재시도
                if ("해당 시군구에 존재하지 않" in txt) or ("정보가 해당" in txt and "존재하지 않" in txt):
                    await click_by_text(page, ["닫기", "확인"])
                    if not addr_warned:
                        task.update(
                            "waiting_login",
                            "⚠️ 자동 입력된 주소가 실제 주민등록 주소와 달라요.\n"
                            "화면의 '주민등록상 주소'에서 시도·시군구를 본인 주소로 바꿔 주세요.\n"
                            "바꾸면 자동으로 다시 신청합니다. (기다리는 중…)",
                            await take_screenshot(page),
                        )
                        addr_warned = True
                    await asyncio.sleep(8)  # 사용자 정정 시간
                    continue
                # 전자서명(간편인증 재요구) 또는 발급 결과 도달 → 다음 단계로
                if (await _get_simplecert_frame(page, timeout_sec=2)) is not None:
                    submitted = True
                    break
                if any(k in txt for k in ["문서출력", "처리완료", "발급완료", "발급 완료"]) or "mbrAplySrvcList" in page.url:
                    submitted = True
                    break
                # 진행 신호가 없음 = 자동 입력만으론 다음 단계로 못 넘어감(서류별 필수항목이 등본과 다를 때).
                #   두 번 이상 헛돌면 사용자에게 폼을 직접 고칠 유예(대기)를 주고, 그 뒤 루프 상단에서
                #   자동으로 다시 '신청하기'를 눌러 재시도한다(실사용 요청: "약간 대기 → 알아서 다음 시도").
                stuck += 1
                # 🧠 스마트 복구 1단계: '예상 밖 안내 팝업'이 진행을 막고 있으면 사람이 하듯 [확인]으로 닫고
                #    바로 재시도한다(사용자 요청: 상황 보고 알아서). 점검·전자문서지갑 팝업은 위에서 이미
                #    정직 안내로 종결됐으므로, 여기 도달한 팝업은 단순 안내일 가능성이 높다. 무엇을 했는지
                #    반드시 알린다(침묵 자동화 금지).
                if stuck == 1:
                    _blk = (await _maintenance_popup_text(page)).strip()
                    if _blk:
                        await click_by_text(page, ["확인"])
                        task.update("running", "안내창이 진행을 막고 있어 [확인]으로 닫고 다시 시도해요…", await take_screenshot(page))
                        continue
                if stuck >= 2:
                    if not fix_hinted:
                        task.update(
                            "waiting_login",
                            "⚠️ 자동 입력만으로는 다음 단계로 넘어가지 못했어요.\n"
                            "화면 폼에서 필요한 항목(대상자·발급목적·유형 등)을 직접 확인/선택해 주세요.\n"
                            "고치면 잠시 후 자동으로 다시 신청합니다. (기다리는 중…)",
                            await take_screenshot(page),
                        )
                        fix_hinted = True
                    await asyncio.sleep(6)  # 사용자 수정 시간 — 그 사이 편집하면 다음 루프가 자동 재신청
                    continue
                await asyncio.sleep(2)

            # ⑤ 전자서명(간편인증 재요구)이 뜨면 자동입력+인증요청, 폰 승인은 본인
            sign_frame = await _get_simplecert_frame(page, timeout_sec=3)
            if sign_frame is not None:
                _prov = str((user_info or {}).get("auth_provider", "kakao") or "kakao")
                await click_provider_in_anyid(sign_frame, _prov)
                # 첫 로그인과 동일하게 — 제공자 선택 후 폼이 렌더될 때까지 기다린 뒤 자동입력(전체동의 리셋 방지).
                await _wait_auth_form_ready(sign_frame)
                _sf_filled = await _autofill_auth_form(sign_frame, user_info)
                # 카카오톡 재선택 → 전체동의 재체크(동의 리셋 방지, 첫 로그인과 동일 순서 보장)
                await click_provider_in_anyid(sign_frame, _prov)
                await asyncio.sleep(0.4)
                await _check_agree_all(sign_frame)
                if _sf_filled and re.sub(r"[^0-9]", "", str((user_info or {}).get("birth_date", ""))):
                    await _request_auth(sign_frame)
                task.update("waiting_login", f"📱 전자서명 인증이에요 — {provider_display(_prov)} [인증 허용]을 눌러주세요.", await take_screenshot(page))
                for _sg in range(180):  # ~6분 — 폰 인증은 넉넉히(과거 240초는 촉박, 감사 :543)
                    check_cancel(task, context)  # 취소·창닫힘 즉시 탈출
                    await asyncio.sleep(2)
                    t = await _txt()
                    if any(k in t for k in ["문서출력", "처리완료", "발급완료"]) or "mbrAplySrvcList" in page.url:
                        break
                    if _sg and _sg % 10 == 0:  # 20초마다 — 폰 승인 대기 중에도 살아있음을 보여준다
                        task.update("waiting_login", f"📱 전자서명 승인을 기다리는 중… ({_sg * 2}초) 폰에서 [인증 허용]을 눌러주세요.", await take_screenshot(page))

            # ⑥ 발급 결과에서 문서출력 → PDF 저장
            await asyncio.sleep(2)
            await click_by_text(page, ["문서출력", "출력하기"])
            await asyncio.sleep(3)
            final_page = _pick_result_page(context, page)
            try:
                await final_page.bring_to_front()
            except Exception:
                pass
            # 🖨 문서출력 뷰어는 본문 렌더가 늦다 — 너무 빨리 캡처하면 '헤더만 있고 본문 빈' PDF가 저장됨
            #    (실사용 제보). 본문이 실제로 그려질 때까지 기다린 뒤 save_document 로 캡처한다.
            await _wait_document_rendered(final_page)
            final_url = final_page.url
            body_now = await _txt()
            # ⚠️ 실제 발급 신호로만 성공 판정 — save_document 는 어떤 화면이든 항상 저장(headed에선 스샷 폴백)
            #   하므로 saved 유무로 판정하면 '미발급 화면'도 발급완료로 오보된다(감사 확정 결함).
            really_issued = ("처리완료" in body_now) or ("발급완료" in body_now) or ("발급 완료" in body_now) or ("mbrAplySrvcList" in final_url)
            # ⚠️ 미발급 화면은 저장하지 않는다 — save_document 파일은 파일명 글롭으로 recent_issued_docs →
            #   신청서 자동첨부에 잡히므로, 저장하면 '진행 화면 캡처'가 발급물처럼 신청서에 붙을 수 있다(감사 HIGH).
            saved = await save_document(final_page, doc_name, getattr(task, 'user_name', '')) if really_issued else ""

            # 성공 판정은 really_issued(권위 신호) 단독으로 — headed 저장이 구조적으로 실패해도
            #   실제 발급 성공을 '미완료'로 뒤집지 않는다(감사 HIGH :567). saved 는 자동/수동 저장 안내에만 영향.
            if really_issued:
                task.update(
                    "done",
                    f"✅ {doc_name} 발급 완료!\n"
                    + (f"📄 자동 저장됨: {saved}\n" if saved else "브라우저 화면에서 '문서출력'으로 저장(PDF)해 주세요.\n")
                    + "브라우저는 60초 후 자동 종료됩니다.",
                    await take_screenshot(final_page),
                )
                task.result = {"success": True, "doc_name": doc_name, "saved_path": saved or None}
                if not saved:
                    task.result["manual_save"] = True
            else:
                # 발급이 확인되지 않음 — 위에서 미발급 화면은 저장하지 않았다(saved=""). 신청 자동첨부·
                #   여정 saved_docs 에 미발급 화면이 섞일 여지 자체를 없앤다.
                task.update(
                    "done",
                    f"⚠️ {doc_name}은(는) 아직 발급이 '완료되지 않았어요'.\n"
                    "화면에서 주소·본인인증을 확인하고 '문서출력'까지 눌러 저장을 마무리해 주세요.\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    await take_screenshot(final_page),
                )
                task.result = {"success": False, "doc_name": doc_name, "final_url": final_url}

            if session is None:
                await cancellable_sleep(60, task, context)  # 중단 가능한 유예(창 닫으면 즉시 반납, 감사 :586)
                await browser.close()
            # 공유 세션 모드: 브라우저는 여정 소유 — 다음 서류가 같은 로그인으로 즉시 이어받고,
            # 종료는 orchestrator finally 가 담당(수동 저장이 필요해도 창이 여정 내내 열려 있다).

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
