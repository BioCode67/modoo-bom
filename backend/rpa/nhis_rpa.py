"""
국민건강보험공단 건강보험 자격득실확인서 RPA (Playwright)

흐름:
  ① 자격득실확인서 URL 접속 → 로그인 페이지로 자동 리디렉션
  ② 사용자에게 로그인 단계 안내 (간편인증 → 카카오톡)
  ③ 로그인 완료 후 자격득실확인서 URL로 자동 복귀 감지
  ④ '발급' 버튼 자동 클릭
  ⑤ 인쇄/PDF 창이 뜨면 완료
"""
import asyncio
from rpa.base import take_screenshot, make_browser_context_args

# 자격득실확인서 직접 URL (미로그인 시 로그인 후 자동 복귀)
NHIS_CERT_URL = "https://www.nhis.or.kr/nhis/minwon/jpAea00401.do"
# 로그인 완료 판정: URL에 이 문자열 등장 또는 로그아웃 버튼 등장
CERT_URL_KEYWORD = "jpAea00401"
LOGIN_URL_KEYWORD = "personalLoginPage"

# 발급 버튼 선택자 (페이지에 따라 다를 수 있음)
ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "input[value*='발급']",
    "input[value*='출력']",
    "button:has-text('출력')",
    "button:has-text('확인서 발급')",
    ".btn-issue",
    "#btnIssue",
    "#btnPrint",
]

# 로그아웃 버튼 (로그인 완료 감지용)
LOGOUT_SELECTORS = [
    "a[href*='logout']",
    "a[href*='Logout']",
    "a[title*='로그아웃']",
    "button:has-text('로그아웃')",
    ".btn-logout",
    ".logout",
    ".user-logout",
    "a:has-text('로그아웃')",
]

LOGIN_GUIDE = """\
🔐 로그인 단계 안내 (브라우저 창을 보세요)

1️⃣  열린 브라우저에서 '간편 인증' 탭 클릭
2️⃣  인증 목록에서 '카카오톡' 클릭
3️⃣  이름 / 생년월일 / 전화번호 입력
4️⃣  '전체동의' 체크 후 '인증 요청' 클릭
5️⃣  📱 스마트폰 카카오톡 알림 → [본인인증 허용] 누르기

✅ 인증 완료 후 자동으로 다음 단계가 진행됩니다."""


async def _wait_for_cert_page(page, task, timeout_sec: int = 300) -> bool:
    """로그인 완료 후 자격득실확인서 페이지 복귀 대기"""
    last_report = 0

    for elapsed in range(timeout_sec):
        try:
            url = page.url

            # 방법 1: 자격득실확인서 URL로 복귀
            if CERT_URL_KEYWORD in url and LOGIN_URL_KEYWORD not in url:
                return True

            # 방법 2: 로그아웃 버튼 등장 (로그인 완료 = 어느 페이지든)
            for sel in LOGOUT_SELECTORS:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        return True
                except Exception:
                    pass

        except Exception:
            pass

        # 15초마다 스크린샷 + 안내
        if elapsed > 0 and elapsed - last_report >= 15:
            try:
                ss = await take_screenshot(page)
                remaining = timeout_sec - elapsed
                task.update(
                    "waiting_login",
                    f"{LOGIN_GUIDE}\n\n⏱ 남은 시간: {remaining}초",
                    ss,
                )
                last_report = elapsed
            except Exception:
                pass

        await asyncio.sleep(1)

    return False


async def _click_issue_button(page, context, task) -> bool:
    """발급 버튼 클릭. 팝업이 열리는 경우도 처리."""
    # 페이지가 로드될 시간 여유
    await asyncio.sleep(2)

    # 모든 열린 페이지에서 발급 버튼 탐색
    for check_page in context.pages:
        for sel in ISSUE_SELECTORS:
            try:
                el = check_page.locator(sel).first
                if await el.count() > 0:
                    await el.scroll_into_view_if_needed()
                    await el.click()
                    await asyncio.sleep(1.5)
                    ss = await take_screenshot(check_page)
                    task.update("running", f"'발급' 버튼 클릭 완료 — 처리 중...", ss)
                    return True
            except Exception:
                continue

    # JavaScript 폴백 — 텍스트 기반 버튼 탐색
    try:
        for check_page in context.pages:
            result = await check_page.evaluate("""
                () => {
                    const keywords = ['발급', '확인서 발급', '발급하기', '출력', '인쇄'];
                    for (const kw of keywords) {
                        const el = Array.from(
                            document.querySelectorAll('button, input[type=button], input[type=submit], a')
                        ).find(e => (e.textContent || e.value || '').includes(kw));
                        if (el) { el.click(); return kw; }
                    }
                    return null;
                }
            """)
            if result:
                await asyncio.sleep(1.5)
                ss = await take_screenshot(check_page)
                task.update("running", f"JS로 '{result}' 버튼 클릭 완료", ss)
                return True
    except Exception:
        pass

    return False


async def _wait_for_print_popup(context, task, timeout_sec: int = 90) -> bool:
    """인쇄/출력 팝업 또는 PDF 버튼 대기"""
    print_sels = [
        "button:has-text('출력')", "button:has-text('인쇄')",
        "button:has-text('PDF')", "button:has-text('저장')",
        "#btnPrint", ".btn-print",
    ]

    for _ in range(timeout_sec):
        try:
            for check_page in context.pages:
                for sel in print_sels:
                    try:
                        el = check_page.locator(sel).first
                        if await el.count() > 0:
                            await check_page.bring_to_front()
                            ss = await take_screenshot(check_page)
                            task.update("running", "출력/PDF 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            return True
                    except Exception:
                        pass

            # 새 탭이 열렸으면 (발급 완료 후 결과창)
            if len(context.pages) > 1:
                newest = context.pages[-1]
                await newest.wait_for_load_state("domcontentloaded", timeout=3000)
                ss = await take_screenshot(newest)
                task.update("running", "발급 완료 페이지 감지!", ss)
                return True
        except Exception:
            pass
        await asyncio.sleep(1)

    return False


async def run_nhis_rpa(task) -> None:
    """국민건강보험공단 건강보험 자격득실확인서 발급 RPA"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치\n터미널에서: pip install playwright && playwright install chromium")
        return

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=200,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            ctx_args = make_browser_context_args()
            ctx_args["no_viewport"] = True  # 최대화 적용
            context = await browser.new_context(**ctx_args)
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① 자격득실확인서 URL 접속 (미로그인 → 로그인 페이지로 리디렉션)
            task.update("running", "건강보험공단 접속 중...\n(로그인 페이지로 이동합니다)")
            try:
                await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(NHIS_CERT_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(2)

            ss = await take_screenshot(page)
            current_url = page.url
            task.update("running", f"페이지 로드 완료\nURL: {current_url}", ss)

            # ② 이미 로그인된 경우 바로 발급
            if CERT_URL_KEYWORD in current_url and LOGIN_URL_KEYWORD not in current_url:
                task.update("running", "이미 로그인 상태 — 발급 버튼 탐색 중...", ss)
            else:
                # ③ 로그인 안내 후 완료 대기
                ss = await take_screenshot(page)
                task.update("waiting_login", LOGIN_GUIDE, ss)

                login_ok = await _wait_for_cert_page(page, task, timeout_sec=300)

                if not login_ok:
                    ss = await take_screenshot(page)
                    task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                    await browser.close()
                    return

                ss = await take_screenshot(page)
                task.update("running", "✅ 로그인 완료! 자격득실확인서 페이지 이동 중...", ss)
                await asyncio.sleep(1)

                # ④ 자격득실확인서 URL로 직접 이동 (로그인 후 리디렉션 안 된 경우 대비)
                if CERT_URL_KEYWORD not in page.url:
                    await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=20000)
                    await asyncio.sleep(2)
                    ss = await take_screenshot(page)
                    task.update("running", f"자격득실확인서 페이지 접속\nURL: {page.url}", ss)

            # ⑤ 발급 버튼 클릭
            ss = await take_screenshot(page)
            task.update("running", "발급 버튼 탐색 중...", ss)

            clicked = await _click_issue_button(page, context, task)

            if not clicked:
                ss = await take_screenshot(page)
                task.update(
                    "running",
                    "발급 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '발급하기' 또는 '출력' 버튼을 직접 클릭해주세요.\n"
                    "클릭 후 자동으로 감지합니다.",
                    ss,
                )

            # ⑥ 출력/PDF 팝업 대기 (최대 90초)
            await _wait_for_print_popup(context, task, timeout_sec=90)

            # ⑦ 최종 스크린샷 및 완료 처리
            try:
                final_page = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final_page)
            except Exception:
                ss = await take_screenshot(page)

            task.update(
                "done",
                "✅ 건강보험 자격득실확인서 발급 절차 완료!\n\n"
                "브라우저에서 Ctrl+P (Mac: ⌘+P) 로 PDF 저장 또는 인쇄가 가능합니다.\n"
                "브라우저는 2분 후 자동 종료됩니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": "건강보험 자격득실확인서"}

            await asyncio.sleep(120)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            ss = await take_screenshot(page)
        except Exception:
            ss = None
        task.update("error", f"자동화 오류: {str(e)[:300]}\n터미널에서 상세 로그를 확인하세요.", ss)
