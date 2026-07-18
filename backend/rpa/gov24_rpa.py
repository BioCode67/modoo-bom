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
import re
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_provider_in_anyid, provider_display, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, launch_browser, save_document,
    check_cancel, cancellable_sleep, CancelledByUser, NO_PRINT_SCRIPT,
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
        for sel in ["#totalAgree", "input#totalAgree", "label:has-text('전체동의')"]:
            try:
                if await ctx.locator(sel).count() > 0:
                    await ctx.check(sel) if "input" in sel or "#totalAgree" == sel else await ctx.click(sel)
                    break
            except Exception:
                continue
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
    await asyncio.sleep(1)
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
    # 폼 등장은 아래 detect_auth_form/자동입력이 감지 — 잔여 안정화만
    await asyncio.sleep(0.5)
    ss = await take_screenshot(page)

    # ④ 본인인증 정보 입력 폼 감지 및 안내 (iframe 컨텍스트에서 감지)
    form_detected = await detect_auth_form(auth_ctx)

    # 정보가 있으면 이름·생년월일·휴대폰 자동 입력 → 생년월일까지 있으면 '인증 요청'도 자동(폰 승인만 남김)
    autofilled = await _autofill_auth_form(auth_ctx, user_info)
    requested = False
    _has_birth = bool(re.sub(r"[^0-9]", "", str((user_info or {}).get("birth_date", ""))))
    if autofilled:
        # 생년월일이 없으면 인증요청을 자동으로 누르지 않는다(불완전 정보로 요청하면 오류)
        if _has_birth:
            await asyncio.sleep(0.6)
            requested = await _request_auth(auth_ctx)
        await asyncio.sleep(0.5)
        ss = await take_screenshot(page)

    if autofilled:
        if requested:
            _msg = f"✅ 정보 자동입력 + '인증 요청'까지 완료했어요.\n📱 휴대폰 {pv} 알림에서 [인증 허용]만 누르시면 됩니다."
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


async def run_gov24_rpa(task, doc_name: str, user_info: dict = None) -> None:
    """정부24에서 주민등록등본 또는 초본 발급. user_info(이름·생년월일·휴대폰) 있으면 본인인증 폼 자동입력."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    doc_url = DOC_URLS.get(doc_name)
    if not doc_url:
        task.update("error", f"지원하지 않는 문서: {doc_name}")
        return

    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw)
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            # 네이티브 인쇄 다이얼로그가 렌더러를 블록해 이후 evaluate/count 가 무한 동결되던 것 차단(감사 CRITICAL)
            await context.add_init_script(NO_PRINT_SCRIPT)
            page = await context.new_page()

            # ① www.gov.kr 로그인 페이지 직접 접속 (세션 수립용)
            task.update("running", f"📄 {doc_name} 발급 준비 — 정부24 로그인/간편인증으로 이동 중...")
            try:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            ss = await take_screenshot(page)
            task.update("running", f"로그인 페이지 로드 완료\n현재 URL: {page.url}", ss)

            # ② 간편인증(카카오톡) 로그인 수행
            login_ok = await _login_on_www_gov(page, task, user_info)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 새 발급 폼(plus.gov.kr) — 로그인과 같은 호스트라 세션 유지(옛 www.gov.kr/AA040 은 크로스호스트로 끊겼음)
            form_url = APPLY_FORM_URLS.get(doc_name) or ISSUE_URLS.get(doc_name, doc_url)
            task.update("running", f"{doc_name} 발급 폼으로 이동 중...")
            await page.goto(form_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(4)

            # 폼에서 재로그인 요구되면 한 번 더 인증
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                task.update("running", "재로그인이 필요해요 — 다시 인증합니다...")
                if not await _login_on_www_gov(page, task, user_info):
                    await browser.close()
                    return
                await page.goto(form_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(4)

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

            # ④ 신청하기 — 자동입력 주소가 실제 주민등록 주소와 다르면(정보 없음 안내) 사용자가 고칠 때까지 기다렸다 자동 재시도
            submitted = False
            addr_warned = False
            task.update("running", "신청 버튼을 눌러 발급을 진행하고 있어요…", await take_screenshot(page))
            for _hb in range(24):  # 최대 ~4분(주소 정정 대기 포함)
                check_cancel(task, context)  # 취소·창닫힘 즉시 탈출
                # 하트비트: 침묵 구간(과거 최대 4분 무갱신 → '멈췄다' 오인, 실사용 피드백)마다 진행 화면 공유.
                # ⚠️ 주소 정정 대기 중엔 generic 문구로 '해야 할 일 안내'를 덮어쓰지 않는다(자가 검토에서 잡은 회귀)
                #    — 대신 같은 안내를 새 스크린샷과 함께 반복해 살아있음을 보여준다.
                if _hb and _hb % 4 == 0:
                    if addr_warned:
                        task.update(
                            "waiting_login",
                            "⚠️ 화면의 '주민등록상 주소'를 본인 주소(시도·시군구)로 바꿔 주세요.\n"
                            "바꾸면 자동으로 다시 신청합니다. (계속 기다리는 중…)",
                            await take_screenshot(page),
                        )
                    else:
                        task.update("running", f"발급 처리 진행 중… ({_hb * 5}초 경과) — 브라우저 창을 닫지 마세요.", await take_screenshot(page))
                # 발급 진행 버튼 — plus.gov.kr 발급폼은 '신청하기', 안내페이지(AA020) 폴백은 '발급하기'.
                if not await click_by_text(page, ["신청하기", "민원신청하기", "발급하기"]):
                    await click_first_matching(page, ["button:has-text('신청하기')", "a:has-text('발급하기')", "button:has-text('발급하기')", "#btnMinwonApply", "#btnApply", "input[value*='신청']"])
                await asyncio.sleep(3)
                txt = await _txt()
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
                await asyncio.sleep(2)

            # ⑤ 전자서명(간편인증 재요구)이 뜨면 자동입력+인증요청, 폰 승인은 본인
            sign_frame = await _get_simplecert_frame(page, timeout_sec=3)
            if sign_frame is not None:
                _prov = str((user_info or {}).get("auth_provider", "kakao") or "kakao")
                await click_provider_in_anyid(sign_frame, _prov)
                await asyncio.sleep(1)
                if await _autofill_auth_form(sign_frame, user_info) and re.sub(r"[^0-9]", "", str((user_info or {}).get("birth_date", ""))):
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

            await cancellable_sleep(60, task, context)  # 중단 가능한 유예(창 닫으면 즉시 반납, 감사 :586)
            await browser.close()

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
