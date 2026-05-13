"""
국민건강보험공단 건강보험 자격득실확인서 실제 자동 발급 (Playwright RPA)
사이트: https://www.nhis.or.kr
- 자격득실확인서 직접 접근 시 로그인 페이지로 자동 리디렉션
- 로그인 후 자격득실확인서 발급
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
)

NHIS_MAIN = "https://www.nhis.or.kr"
# 자격득실확인서 직접 링크 (로그인 안 되어 있으면 자동 리디렉션)
NHIS_DOC_URL = "https://www.nhis.or.kr/nhis/minwon/jpAea00401.do"
# 로그인 페이지
NHIS_LOGIN_URL = "https://www.nhis.or.kr/nhis/etc/personalLoginPage.do"

# 로그인 버튼 선택자 (nhis.or.kr 확인 완료 class: btn-navi navi-row icon_login)
LOGIN_BTN_SELECTORS = [
    "a.btn-navi.icon_login",
    "a.btn-navi.navi-row.icon_login",
    "a[class*='icon_login']",
    "a:has-text('로그인')",
    "button:has-text('로그인')",
    "a[href*='login']",
]

# 간편인증 / 카카오 선택자 (NHIS 로그인 화면)
KAKAO_SELECTORS = [
    "a[title*='카카오']",
    "a:has-text('카카오')",
    "img[alt*='카카오']",
    "[class*='kakao']",
    "a[href*='kakao']",
    "li.kakao a",
    # 공동인증서가 기본 → 간편인증 탭 먼저
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "button:has-text('간편인증')",
]

# 자격득실확인서 메뉴 선택자 (로그인 후)
DOC_MENU_SELECTORS = [
    "a:has-text('자격득실확인서')",
    "a:has-text('자격득실')",
    "li:has-text('자격득실확인서') a",
    "a[href*='jpAea004']",
    "a[href*='certif']",
    "a[href*='qualif']",
]

ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "input[value='발급']",
    "input[value='출력']",
    "button:has-text('출력')",
    "#btnIssue",
    ".btn-issue",
    "#btnPrint",
]

PRINT_SELECTORS = [
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "button:has-text('PDF')",
    "button:has-text('저장')",
    "#btnPrint",
    ".btn-print",
]


async def run_nhis_rpa(task) -> None:
    """국민건강보험공단에서 건강보험 자격득실확인서 발급"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
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

            # ① 자격득실확인서 페이지 직접 접속 (로그인 안 되어 있으면 자동 리디렉션)
            task.update("running", "건강보험공단 자격득실확인서 페이지 접속 중...")
            await page.goto(NHIS_DOC_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            current_url = page.url
            task.update("running", f"접속 완료\n현재 URL: {current_url}", ss)

            # ② 로그인 페이지로 리디렉션됐는지 확인, 아니면 직접 이동
            if "login" not in current_url.lower() and "personal" not in current_url.lower():
                await page.goto(NHIS_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "로그인 페이지로 이동", ss)

            # ③ 로그인 버튼 클릭 (로그인 링크가 따로 있는 경우)
            if "login" not in page.url.lower() and "personal" not in page.url.lower():
                await click_first_matching(page, LOGIN_BTN_SELECTORS)
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "로그인 페이지 이동 완료", ss)

            # ④ 간편인증 → 카카오톡 클릭
            await asyncio.sleep(1)

            # 간편인증 링크 클릭 (class: login-link — NHIS 확인 완료)
            simple_auth = [
                "a.login-link",
                "a:has-text('간편 인증')",
                "a:has-text('간편인증')",
            ]
            await click_first_matching(page, simple_auth)
            await asyncio.sleep(2)

            # 카카오톡 선택 (뱅크/스토리 제외 — 공통 헬퍼 사용)
            kakao_clicked = await click_kakaotalk_in_anyid(page)

            await asyncio.sleep(2)
            ss = await take_screenshot(page)

            # 본인인증 폼이 열렸는지 감지
            if await detect_auth_form(page):
                task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
            elif kakao_clicked:
                task.update(
                    "waiting_login",
                    "📱 카카오 간편인증 화면이 열렸습니다.\n"
                    "스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.\n"
                    "인증 완료 후 자동으로 다음 단계가 진행됩니다.",
                    ss,
                )
            else:
                task.update(
                    "waiting_login",
                    "열린 브라우저에서 카카오 간편인증으로 로그인해주세요.\n"
                    "📱 로그인 완료 후 자동으로 진행됩니다.",
                    ss,
                )

            # ⑤ 로그인 완료 대기
            login_ok = await wait_for_login(
                page, task, timeout_sec=300, login_url=NHIS_LOGIN_URL
            )
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", "로그인 완료! 자격득실확인서 발급 페이지로 이동합니다.", ss)
            await asyncio.sleep(1.5)

            # ⑥ 자격득실확인서 발급 페이지로 재이동
            await page.goto(NHIS_DOC_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2.5)
            ss = await take_screenshot(page)
            task.update("running", "자격득실확인서 발급 페이지 접속 완료", ss)

            # ⑦ 자격득실확인서 메뉴 클릭 시도 (리스트에서 선택)
            if await click_first_matching(page, DOC_MENU_SELECTORS):
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "자격득실확인서 메뉴 선택 완료", ss)

            # ⑧ 발급/출력 버튼 클릭
            await asyncio.sleep(1)
            clicked = await click_first_matching(page, ISSUE_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "발급 버튼 클릭 완료 — 처리 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update(
                    "running",
                    "브라우저에서 '발급하기' 또는 '출력' 버튼을 클릭해주세요.\n"
                    "완료 후 자동으로 감지합니다.",
                    ss,
                )

            # ⑨ 출력/저장 버튼 대기 (최대 90초)
            for _ in range(90):
                try:
                    for sel in PRINT_SELECTORS:
                        el = page.locator(sel).first
                        if await el.count() > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            break

                    if len(context.pages) > 1:
                        popup = context.pages[-1]
                        await popup.bring_to_front()
                        ss = await take_screenshot(popup)
                        task.update("running", "발급 완료 팝업 감지!", ss)
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            ss = await take_screenshot(page)
            task.update(
                "done",
                "✅ 건강보험 자격득실확인서 발급 절차 완료!\n"
                "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.\n"
                "브라우저는 60초 후 자동 종료됩니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": "건강보험 자격득실확인서"}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
