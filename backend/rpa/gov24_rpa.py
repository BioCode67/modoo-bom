"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)
- 카카오 간편인증 자동 클릭 → 사용자 폰 인증 대기 → 자동 발급
"""
import asyncio
from rpa.base import (
    take_screenshot, try_click_kakao, wait_for_login,
    click_first_matching, make_browser_context_args,
)

# 정부24 URL
GOV24_LOGIN_URL = "https://www.gov.kr/portal/login/member"
DOC_URLS = {
    "주민등록등본": "https://www.gov.kr/mw/AA-MO-SV-0117.do",
    "주민등록초본": "https://www.gov.kr/mw/AA-MO-SV-0119.do",
}

# 신청 버튼 선택자
APPLY_SELECTORS = [
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "button:has-text('발급신청')",
    "a:has-text('발급신청')",
    "input[value='신청하기']",
    "input[value='발급신청']",
    ".btn-apply",
    "#btnApply",
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
                slow_mo=400,
                args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(**make_browser_context_args())
            page = await context.new_page()

            # ① 정부24 로그인 페이지 접속
            task.update("running", "정부24 로그인 페이지 접속 중...")
            await page.goto(GOV24_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", "정부24 로그인 페이지 열림", ss)

            # ② 카카오 간편인증 버튼 자동 클릭
            await asyncio.sleep(1)
            kakao_clicked = await try_click_kakao(page)
            ss = await take_screenshot(page)
            if kakao_clicked:
                task.update(
                    "waiting_login",
                    "카카오 인증 화면으로 이동했습니다.\n"
                    "📱 스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.\n"
                    "인증 완료 후 자동으로 진행됩니다.",
                    ss,
                )
            else:
                task.update(
                    "waiting_login",
                    "열린 브라우저에서 카카오 간편인증으로 로그인해주세요.\n"
                    "📱 로그인 완료 후 자동으로 진행됩니다.",
                    ss,
                )

            # ③ 로그인 완료 대기
            login_ok = await wait_for_login(page, task, timeout_sec=180, login_url=GOV24_LOGIN_URL)
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (3분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", f"로그인 완료! {doc_name} 발급 페이지로 이동합니다.", ss)
            await asyncio.sleep(1)

            # ④ 문서 발급 페이지 이동
            await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2.5)
            ss = await take_screenshot(page)
            task.update("running", f"{doc_name} 발급 신청 페이지 접속", ss)

            # ⑤ "온라인 발급" 탭 선택 (있는 경우)
            online_selectors = [
                "a:has-text('온라인발급')", "button:has-text('온라인발급')",
                "li:has-text('온라인발급')", "a:has-text('전자문서')",
            ]
            clicked = await click_first_matching(page, online_selectors)
            if clicked:
                await asyncio.sleep(1)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑥ 발급 목적 선택 (일반용 / 금융용 등) — 기본값 사용
            purpose_selectors = [
                "select[name*='purpose']", "select[name*='issuPurps']",
                "#issuPurps", "#purpose",
            ]
            for sel in purpose_selectors:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.select_option(index=0)
                        break
                except Exception:
                    pass

            # ⑦ 신청하기 버튼 클릭
            await asyncio.sleep(1)
            clicked = await click_first_matching(page, APPLY_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "신청하기 버튼 클릭 완료 — 결과를 기다리는 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update(
                    "running",
                    "신청 버튼을 찾고 있습니다.\n"
                    "브라우저에서 '신청하기' 버튼을 눌러주세요.",
                    ss,
                )

            # ⑧ 팝업 / 인쇄 창 처리 (최대 60초 대기)
            popup_handled = False
            for _ in range(60):
                try:
                    # 인쇄 버튼 등장 감지
                    for sel in PRINT_SELECTORS:
                        el = page.locator(sel).first
                        if await el.count() > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            popup_handled = True
                            break
                    if popup_handled:
                        break

                    # 팝업 창 감지
                    pages = context.pages
                    if len(pages) > 1:
                        popup = pages[-1]
                        await popup.bring_to_front()
                        ss = await take_screenshot(popup)
                        task.update("running", "팝업 창 감지 — 발급 완료 화면입니다.", ss)
                        popup_handled = True
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            ss = await take_screenshot(page)
            task.update(
                "done",
                f"✅ {doc_name} 발급 절차 완료!\n"
                "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": doc_name}

            # 브라우저를 60초간 유지 (사용자가 저장할 시간)
            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:200]}", None)
