"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)

흐름:
  ① www.gov.kr 로그인 페이지 접속 (returnUrl 없이 — 세션만 수립)
  ② 간편인증 탭 → 카카오톡 → anyid 본인인증 폼 → 사용자 완료 대기
  ③ 로그인 완료 → www.gov.kr 세션 수립
  ④ 서비스 안내 페이지 이동 → 신청하기 클릭
  ⑤ 신청 폼 처리 → 출력/PDF

왜 www.gov.kr 로그인을 따로 하냐:
  plus.gov.kr 로그인 세션은 www.gov.kr에 공유되지 않음.
  www.gov.kr 서비스(주민등록등본 등)는 www.gov.kr 세션이 필요.
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS,
)

# www.gov.kr 로그인 페이지 (returnUrl 없이 직접 접속)
WWW_GOV_LOGIN_URL = "https://www.gov.kr/portal/login/memberLogin"

# 서비스 안내 페이지 (로그인 후 접속)
_JUMIN_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_FAMILY_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=14100000017&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_DISABLED_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=11100000006&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _JUMIN_URL,
    "주민등록초본": _JUMIN_URL,
    "가족관계증명서": _FAMILY_URL,
    "장애인증명서": _DISABLED_URL,
}

# www.gov.kr 간편인증 탭 선택자
SIMPLE_AUTH_SELECTORS = [
    # www.gov.kr 로그인 탭 (관찰된 클래스 기반)
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

# 신청하기 버튼 선택자
APPLY_SELECTORS = [
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


async def _login_on_www_gov(page, task) -> bool:
    """
    www.gov.kr 로그인 페이지에서 간편인증(카카오톡)으로 로그인.
    반환값: 로그인 성공 여부.
    """
    login_page_url = page.url
    ss = await take_screenshot(page)
    task.update("running", "www.gov.kr 로그인 페이지 — 간편인증 탭 선택 중...", ss)

    # 간편인증 탭 클릭
    await asyncio.sleep(1.5)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if simple_clicked:
        await asyncio.sleep(2)
        ss = await take_screenshot(page)
        task.update("running", "간편인증 탭 선택 완료 — anyid 카카오톡 클릭 중...", ss)
    else:
        ss = await take_screenshot(page)
        task.update("running", "간편인증 탭을 자동으로 못 찾음 — 수동으로 클릭해주세요.", ss)

    # anyid 모달에서 카카오톡 클릭 (카카오뱅크 제외)
    await asyncio.sleep(1)
    kakaotalk_clicked = await click_kakaotalk_in_anyid(page)
    await asyncio.sleep(2)
    ss = await take_screenshot(page)

    # 본인인증 정보 입력 폼 감지 및 안내
    form_detected = await detect_auth_form(page)

    if kakaotalk_clicked and form_detected:
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

    # 로그인 완료 대기 (최대 5분)
    login_ok = await wait_for_login(
        page, task, timeout_sec=300, login_url=login_page_url
    )

    if not login_ok:
        ss = await take_screenshot(page)
        task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ www.gov.kr 로그인 완료!\n현재 URL: {page.url}", ss)
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


async def run_gov24_rpa(task, doc_name: str) -> None:
    """정부24에서 주민등록등본 또는 초본 발급"""
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
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=300,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① www.gov.kr 로그인 페이지 직접 접속 (세션 수립용)
            task.update("running", "www.gov.kr 로그인 페이지 접속 중...")
            try:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            ss = await take_screenshot(page)
            task.update("running", f"로그인 페이지 로드 완료\n현재 URL: {page.url}", ss)

            # ② 간편인증(카카오톡) 로그인 수행
            login_ok = await _login_on_www_gov(page, task)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 서비스 안내 페이지로 이동 (이제 www.gov.kr 세션 있음)
            task.update("running", f"{doc_name} 서비스 페이지로 이동 중...")
            await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"{doc_name} 서비스 페이지 접속 완료", ss)

            # 혹시 로그인 페이지로 다시 튕긴 경우 재처리
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                task.update("running", "서비스 접근 시 재로그인 요구 — 다시 로그인 중...", ss)
                login_ok = await _login_on_www_gov(page, task)
                if not login_ok:
                    await browser.close()
                    return
                await asyncio.sleep(2)
                # 재접속
                if "AA020InfoCappView" not in page.url:
                    await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(3)
                    ss = await take_screenshot(page)
                    task.update("running", f"{doc_name} 서비스 페이지 재접속 완료", ss)

            # ④ "온라인발급" / "인터넷발급" 탭 선택
            await asyncio.sleep(1)
            online_selectors = [
                "a:has-text('온라인발급')", "a:has-text('온라인 발급')",
                "a:has-text('인터넷발급')", "a:has-text('전자문서')",
                "button:has-text('온라인발급')",
            ]
            if await click_first_matching(page, online_selectors):
                await asyncio.sleep(1.5)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑤ 신청하기 버튼 클릭
            await asyncio.sleep(1)
            ss = await take_screenshot(page)
            task.update("running", "신청하기 버튼 탐색 중...", ss)

            clicked = await click_first_matching(page, APPLY_SELECTORS)
            await asyncio.sleep(2)

            if clicked:
                # 신청 클릭 후 로그인 페이지로 튕겼으면 다시 로그인
                if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                    task.update("running", "신청 클릭 후 로그인 요구 — 로그인 처리 중...")
                    login_ok = await _login_on_www_gov(page, task)
                    if not login_ok:
                        await browser.close()
                        return
                    await asyncio.sleep(2)
                    # 로그인 후 returnUrl로 자동 복귀되지 않으면 재시도
                    if "AA020InfoCappView" not in page.url:
                        await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(3)
                        await click_first_matching(page, online_selectors)
                        await asyncio.sleep(1)
                        await click_first_matching(page, APPLY_SELECTORS)
                        await asyncio.sleep(2)

                ss = await take_screenshot(page)
                task.update("running", "신청하기 클릭 완료 — 양식 처리 중...", ss)

                # 팝업 처리 및 초본/목적 선택
                target_page = await _handle_apply_popup(context, page, task, doc_name)

                # 최종 제출 버튼 클릭
                submit_selectors = [
                    "button:has-text('발급')",
                    "button:has-text('확인')",
                    "input[type='submit']",
                    "button[type='submit']",
                    "a:has-text('발급')",
                ]
                if await click_first_matching(target_page, submit_selectors):
                    await asyncio.sleep(2)
                    ss = await take_screenshot(target_page)
                    task.update("running", "발급 신청 완료 — 결과 대기 중...", ss)
            else:
                ss = await take_screenshot(page)
                task.update(
                    "running",
                    "신청하기 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '신청하기' 또는 '온라인발급' 버튼을 직접 클릭해주세요.",
                    ss,
                )

            # ⑥ 인쇄/출력 창 대기 (최대 120초)
            printed = False
            for _ in range(120):
                try:
                    # 현재 페이지와 팝업 모두 확인
                    for check_page in context.pages:
                        for sel in PRINT_SELECTORS:
                            try:
                                el = check_page.locator(sel).first
                                if await el.count() > 0:
                                    await check_page.bring_to_front()
                                    ss = await take_screenshot(check_page)
                                    task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                                    await el.click()
                                    printed = True
                                    break
                            except Exception:
                                pass
                        if printed:
                            break
                    if printed:
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            # 최종 스크린샷
            try:
                final_page = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final_page)
            except Exception:
                ss = await take_screenshot(page)

            task.update(
                "done",
                f"✅ {doc_name} 발급 절차 완료!\n"
                "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.\n"
                "브라우저는 60초 후 자동 종료됩니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": doc_name}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
