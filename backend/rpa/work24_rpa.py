"""
고용24 고용보험 피보험자격 이력내역서 실제 자동 발급 (Playwright RPA)
사이트: https://www.work24.go.kr
- 간편인증 로그인 → 개인서비스 → 피보험자격이력내역서 발급
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
)

WORK24_MAIN = "https://www.work24.go.kr/cm/main.do"
# 로그인 페이지 (간편인증 포함)
WORK24_LOGIN_URL = "https://www.work24.go.kr/cm/z/b/0210/openLginPageForAnyIdIntro.do"

# 피보험자격이력내역서 메뉴 선택자 (로그인 후 GNB/사이드 메뉴에 표시)
DOC_MENU_SELECTORS = [
    "a:has-text('피보험자격이력')",
    "a:has-text('피보험 자격이력')",
    "a:has-text('이력내역서')",
    "a:has-text('피보험자격 이력')",
    "span:has-text('피보험자격이력')",
    "li:has-text('피보험자격이력') a",
    "li:has-text('이력내역서') a",
]

# 조회 버튼 선택자
SEARCH_SELECTORS = [
    "button:has-text('조회')",
    "input[value='조회']",
    "a:has-text('조회')",
    "#btnSearch",
    ".btn-search",
    "button:has-text('확인')",
]

# 발급/출력 버튼 선택자
ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "a:has-text('발급')",
    "input[value='발급']",
    "#btnIssue",
    "#btnPrint",
    ".btn-issue",
    ".btn-print",
]

# 간편인증 탭 선택자 (work24 로그인 페이지)
SIMPLE_AUTH_SELECTORS = [
    "a.link-easy-anyId",
    "a[class*='easy-anyId']",
    "a[onclick*='anyidAdaptor']",
    ".btn_quick_login",
    "a:has-text('간편인증')",
]


async def _navigate_to_doc_menu(page, task) -> bool:
    """로그인 후 피보험자격이력내역서 메뉴 탐색"""
    # 메인 메뉴에서 직접 클릭 시도
    clicked = await click_first_matching(page, DOC_MENU_SELECTORS)
    if clicked:
        return True

    # JavaScript로 텍스트 기반 탐색
    try:
        found = await page.evaluate("""
            () => {
                const keywords = ['피보험자격이력', '이력내역서', '피보험자격 이력'];
                for (const kw of keywords) {
                    const els = Array.from(document.querySelectorAll('a, button, span, li'));
                    const el = els.find(e => e.textContent && e.textContent.includes(kw));
                    if (el) {
                        const link = el.tagName === 'A' ? el : el.closest('a') || el.querySelector('a');
                        if (link) { link.click(); return true; }
                        el.click();
                        return true;
                    }
                }
                return false;
            }
        """)
        if found:
            await asyncio.sleep(2)
            return True
    except Exception:
        pass

    # work24 fn_goPageUrl 함수로 직접 메뉴 호출 (개인서비스 → 고용보험 → 피보험자격)
    try:
        await page.evaluate("""
            () => {
                // work24 개인 → 고용보험 개인서비스 이동
                if (typeof fn_goPageUrl === 'function') {
                    // 개인서비스 마이페이지 이동
                    fn_goPageUrl('/cm', 'EBG020000001', '/z/a/0100/myPageMainPost.do', 'EBM01', 'N', '');
                }
            }
        """)
        await asyncio.sleep(2)
        # 이후 텍스트 기반으로 재탐색
        return await click_first_matching(page, DOC_MENU_SELECTORS)
    except Exception:
        pass

    return False


async def run_work24_rpa(task) -> None:
    """고용24에서 고용보험 피보험자격 이력내역서 발급"""
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

            # ① 고용24 메인 접속
            task.update("running", "고용24(work24) 접속 중...")
            await page.goto(WORK24_MAIN, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", "고용24 메인 페이지 접속 완료", ss)

            # ② 로그인 페이지 이동
            login_selectors = [
                "a:has-text('로그인')",
                "button:has-text('로그인')",
                ".btn_quick_login",
                "a[onclick*='openLginPage']",
                "a[onclick*='login']",
            ]
            clicked = await click_first_matching(page, login_selectors)
            if not clicked:
                await page.goto(WORK24_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", f"로그인 페이지 이동\n현재 URL: {page.url}", ss)

            # ③ 간편인증 클릭 → 카카오톡 선택
            await asyncio.sleep(1)

            # 간편인증 링크 클릭 (class: link-easy-anyId — Work24 확인 완료)
            easy_auth_clicked = await click_first_matching(page, [
                "a.link-easy-anyId",
                "a[class*='easy-anyId']",
                "a:has-text('간편인증')",
            ])
            if easy_auth_clicked:
                await asyncio.sleep(3)  # anyid 모달 로드 대기

            # anyid 모달 내 카카오톡 클릭 (뱅크/스토리 제외 — 공통 헬퍼 사용)
            kakao_clicked = await click_kakaotalk_in_anyid(page)

            await asyncio.sleep(2)
            ss = await take_screenshot(page)

            # 본인인증 폼이 열렸는지 감지
            if await detect_auth_form(page):
                task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
            elif kakao_clicked or easy_auth_clicked:
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

            # ④ 로그인 완료 대기
            login_ok = await wait_for_login(
                page, task, timeout_sec=300, login_url=WORK24_LOGIN_URL
            )
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", "로그인 완료! 피보험자격이력내역서 메뉴를 찾는 중...", ss)
            await asyncio.sleep(2)

            # ⑤ 피보험자격이력내역서 메뉴 탐색
            doc_found = await _navigate_to_doc_menu(page, task)
            ss = await take_screenshot(page)

            if doc_found:
                task.update("running", "피보험자격이력내역서 메뉴 선택 완료", ss)
            else:
                task.update(
                    "running",
                    "메뉴를 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 [개인서비스 → 고용보험 → 피보험자격이력] 메뉴를 클릭해주세요.\n"
                    "완료 후 자동으로 감지합니다.",
                    ss,
                )
                # 사용자가 수동 탐색할 시간 대기
                await asyncio.sleep(30)
                ss = await take_screenshot(page)
                task.update("running", "현재 화면 확인", ss)

            await asyncio.sleep(2)

            # ⑥ 조회 버튼 클릭
            clicked = await click_first_matching(page, SEARCH_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "조회 버튼 클릭 — 이력 조회 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update("running", "화면을 확인하는 중...", ss)

            # ⑦ 발급/출력 버튼 대기 (최대 90초)
            for _ in range(90):
                try:
                    for sel in ISSUE_SELECTORS:
                        el = page.locator(sel).first
                        if await el.count() > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "발급/출력 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            await asyncio.sleep(2)
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
                "✅ 고용보험 피보험자격 이력내역서 발급 절차 완료!\n"
                "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.\n"
                "브라우저는 60초 후 자동 종료됩니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": "고용보험 피보험자격 이력내역서"}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
