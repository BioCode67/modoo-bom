"""
고용24 고용보험 피보험자격 이력내역서 실제 자동 발급 (Playwright RPA)
사이트: https://www.work24.go.kr
"""
import asyncio
from rpa.base import (
    take_screenshot, try_click_kakao, wait_for_login,
    click_first_matching, make_browser_context_args,
)

WORK24_MAIN = "https://www.work24.go.kr"
WORK24_LOGIN = "https://www.work24.go.kr/cm/d/a/CMAAD0010.do"

# 피보험자격이력내역서 직접 링크 후보
WORK24_DOC_URLS = [
    "https://www.work24.go.kr/ui/a/d/CMIAD0010.do",   # 고용보험 개인 서비스
    "https://www.work24.go.kr/cm/d/a/CMAAD0010.do",   # 로그인
]

# 피보험자격이력 메뉴 선택자
DOC_MENU_SELECTORS = [
    "a:has-text('피보험자격이력')",
    "a:has-text('피보험 자격 이력')",
    "a:has-text('이력내역서')",
    "a[href*='CMIAD']",
    "a[href*='insure']",
    "a[href*='피보험']",
]

ISSUE_SELECTORS = [
    "button:has-text('조회')",
    "button:has-text('발급')",
    "input[value='조회']",
    "input[value='발급']",
    "a:has-text('발급')",
    "#btnSearch",
    "#btnIssue",
    ".btn-search",
]

PRINT_SELECTORS = [
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "button:has-text('PDF저장')",
    "button:has-text('프린트')",
    "#btnPrint",
    ".btn-print",
]


async def run_work24_rpa(task) -> None:
    """고용24에서 고용보험 피보험자격 이력내역서 발급"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치")
        return

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=400,
                args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(**make_browser_context_args())
            page = await context.new_page()

            # ① 고용24 접속
            task.update("running", "고용24 접속 중...")
            await page.goto(WORK24_MAIN, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", "고용24 메인 페이지 접속 완료", ss)

            # ② 로그인 페이지 이동
            login_selectors = [
                "a:has-text('로그인')",
                "button:has-text('로그인')",
                "a[href*='login']",
                "a[href*='CMAAD']",
            ]
            clicked = await click_first_matching(page, login_selectors)
            if not clicked:
                await page.goto(WORK24_LOGIN, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", "로그인 페이지 이동", ss)

            # ③ 카카오 간편인증 클릭
            await asyncio.sleep(1)
            kakao_clicked = await try_click_kakao(page)
            ss = await take_screenshot(page)
            if kakao_clicked:
                task.update(
                    "waiting_login",
                    "카카오 인증 화면으로 이동했습니다.\n"
                    "📱 스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.",
                    ss,
                )
            else:
                task.update(
                    "waiting_login",
                    "열린 브라우저에서 카카오 간편인증으로 로그인해주세요.\n"
                    "📱 로그인 완료 후 자동으로 진행됩니다.",
                    ss,
                )

            # ④ 로그인 완료 대기
            login_ok = await wait_for_login(page, task, timeout_sec=180)
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (3분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", "로그인 완료! 피보험자격이력내역서 메뉴를 찾는 중...", ss)
            await asyncio.sleep(1.5)

            # ⑤ 피보험자격이력 메뉴 클릭 시도
            clicked = await click_first_matching(page, DOC_MENU_SELECTORS)
            if clicked:
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "피보험자격이력내역서 메뉴 선택 완료", ss)
            else:
                # 직접 URL 이동
                await page.goto(WORK24_DOC_URLS[0], wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "피보험자격이력내역서 페이지 이동", ss)

            # ⑥ 조회/발급 버튼 클릭
            await asyncio.sleep(1)
            clicked = await click_first_matching(page, ISSUE_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "조회 버튼 클릭 완료 — 이력 조회 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update(
                    "running",
                    "브라우저에서 '조회' 또는 '발급' 버튼을 클릭해주세요.",
                    ss,
                )

            # ⑦ 출력 버튼 대기
            for _ in range(60):
                try:
                    for sel in PRINT_SELECTORS:
                        el = page.locator(sel).first
                        if await el.count() > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            break

                    pages = context.pages
                    if len(pages) > 1:
                        popup = pages[-1]
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
                "✅ 고용보험 피보험자격 이력내역서 발급 절차 완료!\n"
                "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": "고용보험 피보험자격 이력내역서"}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:200]}", None)
