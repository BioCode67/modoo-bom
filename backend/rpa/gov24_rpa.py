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
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, launch_browser, save_document,
)

# 정부24 로그인 페이지 — 2026년 plus.gov.kr로 이전(옛 www.gov.kr/portal/login/memberLogin 은 soft-404).
WWW_GOV_LOGIN_URL = "https://plus.gov.kr/login"
# 간편인증 위젯이 로드되는 iframe URL 키워드
SIMPLECERT_FRAME_KEYWORD = "simpleCert"

# 서비스 안내 페이지 (로그인 후 접속)
_JUMIN_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_FAMILY_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=97400000004&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_DISABLED_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=14600000273&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _JUMIN_URL,
    "주민등록초본": _JUMIN_URL,
    "가족관계증명서": _FAMILY_URL,
    "장애인증명서": _DISABLED_URL,
}


# 발급 신청 폼(로그인 필요) — 서비스 안내(AA020) 없이 바로 발급 폼(AA040)으로 직행.
# 로그인 세션이 살아있으면 여기로 가면 실제 발급 양식이 바로 뜬다(안내 페이지 저장 방지).
def _issue_url(capp_biz_cd: str) -> str:
    return (
        f"https://www.gov.kr/mw/AA040OfferMainFrm.do?capp_biz_cd={capp_biz_cd}"
        "&HighCtgCD=A01010001&FAX_TYPE=N&img=02&selectedSeq=01"
    )


ISSUE_URLS = {
    "주민등록등본": _issue_url("13100000015"),
    "주민등록초본": _issue_url("13100000015"),
    "가족관계증명서": _issue_url("97400000004"),
    "장애인증명서": _issue_url("14600000273"),
}

# 새 발급 폼(plus.gov.kr) — 로그인과 같은 호스트라 세션이 유지된다(옛 www.gov.kr/AA040 은 크로스호스트라 세션이 끊김).
def _apply_form_url(capp_biz_cd: str) -> str:
    return f"https://plus.gov.kr/minwon/apply/applyMinwonForm/?cappBizCd={capp_biz_cd}&tpSeq=01"


APPLY_FORM_URLS = {
    "주민등록등본": _apply_form_url("13100000015"),
    "주민등록초본": _apply_form_url("13100000015"),
    "가족관계증명서": _apply_form_url("97400000004"),
    "장애인증명서": _apply_form_url("14600000273"),
}

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

    # ① 간편인증 버튼 클릭 (신 UI: button.login-type → 텍스트 폴백)
    await asyncio.sleep(1.5)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if not simple_clicked:
        simple_clicked = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    await asyncio.sleep(2.5)

    # ② 간편인증 위젯 iframe 취득 (없으면 페이지에서 직접 시도하는 폴백)
    frame = await _get_simplecert_frame(page)
    auth_ctx = frame or page
    ss = await take_screenshot(page)
    if frame:
        task.update("running", "간편인증 위젯 로드됨 — 카카오톡 선택 중...", ss)
    else:
        task.update("running", "간편인증 화면 진입 — 카카오톡 선택을 시도합니다...", ss)

    # ③ 카카오톡 선택 (iframe 내부, 카카오뱅크 제외)
    await asyncio.sleep(1)
    kakaotalk_clicked = await click_kakaotalk_in_anyid(auth_ctx)
    await asyncio.sleep(2)
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
            _msg = "✅ 정보 자동입력 + '인증 요청'까지 완료했어요.\n📱 카카오톡 알림에서 [인증 허용]만 누르시면 됩니다."
        elif not _has_birth:
            _msg = "✅ 이름·휴대폰을 자동 입력했어요.\n화면에서 '생년월일'을 입력하고 '인증 요청'을 누른 뒤, 📱 카카오톡 [인증 허용]을 해주세요."
        else:
            _msg = "✅ 이름·생년월일·휴대폰을 자동 입력했어요.\n화면에서 '인증 요청'을 누르면, 📱 카카오톡 알림에서 [인증 허용]만 하시면 됩니다."
        task.update("waiting_login", _msg, ss)
    elif kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update(
            "waiting_login",
            "📱 카카오톡 간편인증 화면이 열렸습니다.\n"
            "스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 다음 단계가 진행됩니다.",
            ss,
        )
    else:
        task.update(
            "waiting_login",
            "브라우저에서 '간편인증' 탭 → '카카오톡(TALK)' 선택 후\n"
            "본인인증 정보(이름·생년월일·전화번호)를 입력하고 '인증 요청'을 클릭해주세요.\n"
            "📱 카카오톡 알림 허용 후 자동으로 진행됩니다.",
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


async def _handle_apply_popup(context, page, task, doc_name) -> bool:
    """
    신청하기 클릭 후 팝업이 열리면 팝업 페이지를 반환, 아니면 현재 페이지.
    초본 선택 및 목적 선택 처리 포함.
    """
    await asyncio.sleep(2)

    # 팝업이 열렸는지 확인
    target_page = page
    if len(context.pages) > 1:
        target_page = context.pages[-1]
        await target_page.bring_to_front()
        ss = await take_screenshot(target_page)
        task.update("running", "신청 팝업 창 감지 — 양식 작성 중...", ss)

    # 문서 유형별 선택 처리
    if doc_name == "주민등록초본":
        try:
            await target_page.evaluate("""
                () => {
                    const labels = Array.from(document.querySelectorAll('label, span, td'));
                    const label = labels.find(el => el.textContent.trim() === '초본');
                    if (label) {
                        const forAttr = label.getAttribute('for');
                        if (forAttr) {
                            const inp = document.getElementById(forAttr);
                            if (inp) { inp.click(); return; }
                        }
                        label.click();
                        return;
                    }
                    const selects = document.querySelectorAll('select');
                    selects.forEach(sel => {
                        const opt = Array.from(sel.options).find(o => o.text.includes('초본'));
                        if (opt) sel.value = opt.value;
                    });
                }
            """)
            await asyncio.sleep(0.5)
            ss = await take_screenshot(target_page)
            task.update("running", "초본 선택 완료", ss)
        except Exception:
            pass

    # 가족관계증명서 유형 선택 (일반증명서 기본)
    if doc_name == "가족관계증명서":
        try:
            await target_page.evaluate("""
                () => {
                    const labels = Array.from(document.querySelectorAll('label, span, td'));
                    const label = labels.find(el => el.textContent.trim().includes('일반'));
                    if (label) { label.click(); return; }
                    const selects = document.querySelectorAll('select');
                    selects.forEach(sel => {
                        const opt = Array.from(sel.options).find(o => o.text.includes('일반'));
                        if (opt) sel.value = opt.value;
                    });
                }
            """)
            await asyncio.sleep(0.5)
        except Exception:
            pass

    # 발급 목적 기본값 선택
    for sel in ["select[name*='purpose']", "select[name*='issuPurps']", "#issuPurps", "select"]:
        try:
            el = target_page.locator(sel).first
            if await el.count() > 0:
                await el.select_option(index=0)
                break
        except Exception:
            pass

    await asyncio.sleep(0.5)
    return target_page


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

            # ④ 신청하기 — 자동입력 주소가 실제 주민등록 주소와 다르면(정보 없음 안내) 사용자가 고칠 때까지 기다렸다 자동 재시도
            submitted = False
            addr_warned = False
            for _ in range(24):  # 최대 ~4분(주소 정정 대기 포함)
                if not await click_by_text(page, ["신청하기", "민원신청하기"]):
                    await click_first_matching(page, ["button:has-text('신청하기')", "#btnMinwonApply", "#btnApply", "input[value*='신청']"])
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
                await click_kakaotalk_in_anyid(sign_frame)
                await asyncio.sleep(1)
                if await _autofill_auth_form(sign_frame, user_info) and re.sub(r"[^0-9]", "", str((user_info or {}).get("birth_date", ""))):
                    await _request_auth(sign_frame)
                task.update("waiting_login", "📱 전자서명 인증이에요 — 카카오톡 [인증 허용]을 눌러주세요.", await take_screenshot(page))
                for _ in range(120):
                    await asyncio.sleep(2)
                    t = await _txt()
                    if any(k in t for k in ["문서출력", "처리완료", "발급완료"]) or "mbrAplySrvcList" in page.url:
                        break

            # ⑥ 발급 결과에서 문서출력 → PDF 저장
            await asyncio.sleep(2)
            await click_by_text(page, ["문서출력", "출력하기"])
            await asyncio.sleep(3)
            final_page = context.pages[-1] if len(context.pages) > 1 else page
            try:
                await final_page.bring_to_front()
            except Exception:
                pass
            saved = await save_document(final_page, doc_name)
            final_url = final_page.url
            body_now = await _txt()
            issued = ("처리완료" in body_now) or ("mbrAplySrvcList" in final_url) or bool(saved)

            if saved:
                task.update(
                    "done",
                    f"✅ {doc_name} 발급 완료!\n📄 자동 저장됨: {saved}\n브라우저는 60초 후 자동 종료됩니다.",
                    await take_screenshot(final_page),
                )
                task.result = {"success": True, "doc_name": doc_name, "saved_path": saved}
            else:
                task.update(
                    "done",
                    f"⚠️ {doc_name} 발급 화면까지 진행했어요.\n"
                    "브라우저에서 '문서출력'으로 저장을 마무리해 주세요(주소·인증 확인 필요).\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    await take_screenshot(final_page),
                )
                task.result = {"success": issued, "doc_name": doc_name, "final_url": final_url}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
