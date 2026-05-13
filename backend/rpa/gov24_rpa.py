"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)
- plus.gov.kr SPA 기반 로그인 (2024년 이전 www.gov.kr → plus.gov.kr 전환)
- 간편인증 탭 선택 → 카카오 클릭 → 사용자 폰 인증 대기 → 자동 발급
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
)

# 정부24 통합 플랫폼 (SPA, Vue.js 기반)
GOV24_BASE = "https://plus.gov.kr"
GOV24_LOGIN_URL = "https://plus.gov.kr/login/login"

# 문서 발급 서비스 URL (www.gov.kr 민원24 연계)
# 등본/초본 모두 동일한 서비스 페이지(CappBizCD=13100000015)에서 발급됨
# 신청 양식에서 등본/초본 선택
_BASE_DOC_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _BASE_DOC_URL,
    "주민등록초본": _BASE_DOC_URL,
}

# 간편인증 탭 선택자 (로그인 페이지에 표시되는 탭)
SIMPLE_AUTH_SELECTORS = [
    "li.simplicity.login_type.anyidEsign a",
    "li.anyidEsign a",
    "a.login-link.open-modal",
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "a[class*='anyidEsign']",
]

# 간편인증 모달/팝업 내부의 카카오 버튼
KAKAO_MODAL_SELECTORS = [
    "a[title*='카카오']",
    "a[data-id*='kakao']",
    "img[alt*='카카오']",
    "a:has-text('카카오')",
    "[class*='kakao']",
    "a[href*='kakao']",
    "li.kakao a",
    ".kakao-btn",
]

# 신청 버튼 선택자
APPLY_SELECTORS = [
    "a.btn_bg01",               # gov.kr 민원24 서비스 카드 확인 버튼
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('발급신청')",
    "button:has-text('발급신청')",
    "a:has-text('온라인신청')",
    "input[value='신청하기']",
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


async def _click_simple_auth_kakao(page, task) -> bool:
    """
    정부24 로그인 페이지에서 간편인증 탭 → 카카오 버튼 순서로 클릭.
    성공 여부 반환.
    """
    # 간편인증 탭 클릭
    await asyncio.sleep(1.5)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if simple_clicked:
        ss = await take_screenshot(page)
        task.update("running", "간편인증 탭 선택 완료 — 카카오 버튼을 찾는 중...", ss)
        await asyncio.sleep(2)
    else:
        ss = await take_screenshot(page)
        task.update("running", "간편인증 탭을 찾지 못했습니다. 직접 선택해주세요.", ss)
        return False

    # 카카오 버튼 클릭 (모달 또는 같은 페이지)
    kakao_clicked = await click_first_matching(page, KAKAO_MODAL_SELECTORS)
    if kakao_clicked:
        await asyncio.sleep(2)
        return True

    # JS 직접 클릭 시도 (Shadow DOM 또는 동적 렌더링 대응)
    try:
        result = await page.evaluate("""
            () => {
                const candidates = [
                    ...document.querySelectorAll('a, button, img'),
                ].filter(el => {
                    const t = (el.textContent + el.getAttribute('alt') + el.getAttribute('title') + el.className).toLowerCase();
                    return t.includes('카카오') || t.includes('kakao');
                });
                if (candidates.length > 0) { candidates[0].click(); return true; }
                return false;
            }
        """)
        if result:
            await asyncio.sleep(2)
            return True
    except Exception:
        pass

    return False


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

            # navigator.webdriver 숨기기
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

            page = await context.new_page()

            # ① plus.gov.kr 로그인 페이지 접속
            task.update("running", "정부24 로그인 페이지 접속 중... (plus.gov.kr)")
            try:
                await page.goto(GOV24_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(GOV24_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"정부24 로그인 페이지 로드 완료\n현재 URL: {page.url}", ss)

            # ② 간편인증 → 카카오 버튼 클릭
            kakao_clicked = await _click_simple_auth_kakao(page, task)
            ss = await take_screenshot(page)

            if kakao_clicked:
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
                    "열린 브라우저에서 '간편인증' 탭을 선택하고\n"
                    "카카오 간편인증으로 로그인해주세요.\n"
                    "📱 로그인 완료 후 자동으로 진행됩니다.",
                    ss,
                )

            # ③ 로그인 완료 대기 (URL이 login에서 벗어날 때 감지)
            login_ok = await wait_for_login(
                page, task, timeout_sec=180, login_url=GOV24_LOGIN_URL
            )
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (3분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", f"로그인 완료! {doc_name} 발급 페이지로 이동합니다.", ss)
            await asyncio.sleep(1.5)

            # ④ 문서 발급 서비스 페이지 이동
            task.update("running", f"{doc_name} 민원 서비스 페이지 이동 중...")
            await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"{doc_name} 서비스 페이지 접속 완료", ss)

            # ⑤ "온라인 발급" / "신청하기" 탭 있으면 선택
            online_selectors = [
                "a:has-text('온라인발급')", "a:has-text('온라인 발급')",
                "a:has-text('전자문서')", "button:has-text('온라인발급')",
            ]
            if await click_first_matching(page, online_selectors):
                await asyncio.sleep(1.5)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑥ 초본 신청 시 양식에서 "초본" 선택
            if doc_name == "주민등록초본":
                try:
                    await page.evaluate("""
                        () => {
                            // 등본/초본 라디오 버튼 또는 선택 항목에서 초본 선택
                            const labels = Array.from(document.querySelectorAll('label, span, td'));
                            const chobonLabel = labels.find(el => el.textContent.trim() === '초본');
                            if (chobonLabel) {
                                // 연관 input 클릭
                                const forAttr = chobonLabel.getAttribute('for');
                                if (forAttr) {
                                    const inp = document.getElementById(forAttr);
                                    if (inp) { inp.click(); return; }
                                }
                                chobonLabel.click();
                                return;
                            }
                            // select 요소에서 초본 option 선택
                            const selects = document.querySelectorAll('select');
                            selects.forEach(sel => {
                                const opt = Array.from(sel.options).find(o => o.text.includes('초본'));
                                if (opt) sel.value = opt.value;
                            });
                        }
                    """)
                    await asyncio.sleep(0.5)
                    ss = await take_screenshot(page)
                    task.update("running", "초본 선택 완료", ss)
                except Exception:
                    pass

            # ⑦ 발급 목적 기본값 선택
            for sel in ["select[name*='purpose']", "select[name*='issuPurps']", "#issuPurps"]:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.select_option(index=0)
                        break
                except Exception:
                    pass

            # ⑧ 신청하기 버튼 클릭
            await asyncio.sleep(1)
            clicked = await click_first_matching(page, APPLY_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "신청하기 버튼 클릭 완료 — 결과를 기다리는 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update(
                    "running",
                    "발급 신청 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '신청하기' 또는 '발급신청' 버튼을 눌러주세요.",
                    ss,
                )

            # ⑧ 인쇄/출력 창 대기 (최대 90초)
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
                        task.update("running", "팝업 창 감지 — 발급 완료 화면입니다.", ss)
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

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
