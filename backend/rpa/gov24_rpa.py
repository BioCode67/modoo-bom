"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)
- plus.gov.kr SPA 기반 로그인 (2024년 이전 www.gov.kr → plus.gov.kr 전환)
- 간편인증 탭 선택 → 카카오톡(TALK) 클릭 → anyid 본인인증 폼 → 사용자 완료 대기
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
_BASE_DOC_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _BASE_DOC_URL,
    "주민등록초본": _BASE_DOC_URL,
}

# 간편인증 탭 선택자
SIMPLE_AUTH_SELECTORS = [
    "li.simplicity.login_type.anyidEsign a",
    "li.anyidEsign a",
    "a.login-link.open-modal",
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "a[class*='anyidEsign']",
]

# ★ 카카오톡(TALK) 전용 선택자 — 카카오뱅크/카카오스토리와 구분하기 위해 '톡' 포함
KAKAOTALK_SELECTORS = [
    "a[title='카카오톡']",
    "img[alt='카카오톡']",
    "a:has-text('카카오톡')",
    "li:has-text('카카오톡') a",
    "button:has-text('카카오톡')",
    # anyid 리스트 내 TALK 아이콘
    ".kakao-talk",
    "[class*='kakaotalk']",
    "[data-id='kakaotalk']",
    "[data-provider='kakaotalk']",
]

# 신청 버튼 선택자
APPLY_SELECTORS = [
    "a.btn_bg01",
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

# 본인인증 정보 폼이 떴는지 감지하는 선택자 (anyid 인증 요청 폼)
AUTH_FORM_SELECTORS = [
    "button:has-text('인증 요청')",
    "button:has-text('인증요청')",
    "input[placeholder*='생년월일']",
    "input[placeholder*='이름']",
    "button:has-text('전체동의')",
    "label:has-text('전체동의')",
    "input[type='checkbox']",  # 동의 체크박스
]


async def _click_kakaotalk_in_anyid(page, task) -> bool:
    """
    anyid 모달에서 '카카오톡' 을 정확히 클릭.
    카카오뱅크(뱅크) / 카카오스토리 와 혼동하지 않도록 '톡' 을 포함한 텍스트만 매칭.
    """
    # 1) Playwright 선택자로 시도
    for sel in KAKAOTALK_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1.5)
                return True
        except Exception:
            continue

    # 2) JS: '카카오톡' 텍스트를 정확히 포함하는 요소 클릭 (뱅크 제외)
    try:
        result = await page.evaluate("""
            () => {
                // '카카오톡' 텍스트만 매칭 — 카카오뱅크/카카오스토리 제외
                const all = [...document.querySelectorAll('a, button, li, span, img, div')];
                const candidates = all.filter(el => {
                    const text = (
                        (el.textContent || '') +
                        (el.getAttribute('alt') || '') +
                        (el.getAttribute('title') || '') +
                        (el.getAttribute('data-id') || '') +
                        (el.getAttribute('data-provider') || '') +
                        el.className
                    ).toLowerCase();
                    // '카카오톡' 또는 'kakaotalk' — '뱅크' / 'bank' 제외
                    return (text.includes('카카오톡') || text.includes('kakaotalk')) &&
                           !text.includes('뱅크') && !text.includes('bank');
                });
                if (candidates.length > 0) {
                    const el = candidates[0];
                    const clickTarget = el.tagName === 'IMG'
                        ? (el.closest('a') || el.closest('button') || el)
                        : el;
                    clickTarget.click();
                    return true;
                }
                return false;
            }
        """)
        if result:
            await asyncio.sleep(1.5)
            return True
    except Exception:
        pass

    # 3) JS: anyid 리스트에서 마지막 카카오 계열 항목 (카카오톡이 보통 리스트 하단)
    try:
        result = await page.evaluate("""
            () => {
                const all = [...document.querySelectorAll('a, button, li')];
                const kakaoItems = all.filter(el => {
                    const t = (el.textContent + el.className).toLowerCase();
                    return t.includes('카카오') || t.includes('kakao');
                });
                // 여러 카카오 항목 중 가장 마지막 = 카카오톡 (리스트 순서상 하단)
                if (kakaoItems.length > 0) {
                    kakaoItems[kakaoItems.length - 1].click();
                    return kakaoItems.length;
                }
                return 0;
            }
        """)
        if result:
            await asyncio.sleep(1.5)
            return True
    except Exception:
        pass

    return False


async def _detect_auth_form(page) -> bool:
    """anyid 본인인증 정보 입력 폼이 화면에 떴는지 확인"""
    for sel in AUTH_FORM_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                return True
        except Exception:
            continue
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

            # ② 간편인증 탭 클릭
            await asyncio.sleep(1.5)
            simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
            if simple_clicked:
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "간편인증 탭 선택 완료 — anyid 모달에서 카카오톡 찾는 중...", ss)
            else:
                ss = await take_screenshot(page)
                task.update(
                    "waiting_login",
                    "간편인증 탭을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '간편인증' 탭을 직접 클릭하고\n"
                    "카카오톡(TALK)을 선택한 뒤 인증을 완료해주세요.",
                    ss,
                )

            # ③ anyid 모달에서 카카오톡 클릭 (카카오뱅크 아님!)
            await asyncio.sleep(1)
            kakaotalk_clicked = await _click_kakaotalk_in_anyid(page, task)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)

            # ④ 본인인증 정보 입력 폼 감지
            form_detected = await _detect_auth_form(page)

            if kakaotalk_clicked and form_detected:
                task.update(
                    "waiting_login",
                    "📋 카카오톡 본인인증 정보 입력 폼이 열렸습니다.\n\n"
                    "브라우저에서 다음을 직접 입력해주세요:\n"
                    "  1️⃣  이름 입력\n"
                    "  2️⃣  생년월일 입력 (예: 19900101)\n"
                    "  3️⃣  휴대폰 번호 입력\n"
                    "  4️⃣  '전체동의' 체크박스 선택\n"
                    "  5️⃣  '인증 요청' 버튼 클릭\n\n"
                    "📱 이후 카카오톡 알림에서 [본인인증 허용] 을 누르면 자동으로 진행됩니다.",
                    ss,
                )
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
                    "열린 브라우저에서 '간편인증' 탭 → '카카오톡(TALK)' 선택 후\n"
                    "본인인증 정보(이름·생년월일·전화번호)를 입력하고\n"
                    "'인증 요청'을 클릭해주세요.\n"
                    "📱 카카오톡 알림 허용 후 자동으로 진행됩니다.",
                    ss,
                )

            # ⑤ 로그인 완료 대기 (URL이 login에서 벗어날 때 감지, 최대 5분)
            login_ok = await wait_for_login(
                page, task, timeout_sec=300, login_url=GOV24_LOGIN_URL
            )
            if not login_ok:
                ss = await take_screenshot(page)
                task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", f"로그인 완료! {doc_name} 발급 페이지로 이동합니다.", ss)
            await asyncio.sleep(1.5)

            # ⑥ 문서 발급 서비스 페이지 이동
            task.update("running", f"{doc_name} 민원 서비스 페이지 이동 중...")
            await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"{doc_name} 서비스 페이지 접속 완료", ss)

            # ⑦ "온라인 발급" 탭 선택
            online_selectors = [
                "a:has-text('온라인발급')", "a:has-text('온라인 발급')",
                "a:has-text('전자문서')", "button:has-text('온라인발급')",
            ]
            if await click_first_matching(page, online_selectors):
                await asyncio.sleep(1.5)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑧ 초본 신청 시 양식에서 '초본' 선택
            if doc_name == "주민등록초본":
                try:
                    await page.evaluate("""
                        () => {
                            const labels = Array.from(document.querySelectorAll('label, span, td'));
                            const chobonLabel = labels.find(el => el.textContent.trim() === '초본');
                            if (chobonLabel) {
                                const forAttr = chobonLabel.getAttribute('for');
                                if (forAttr) {
                                    const inp = document.getElementById(forAttr);
                                    if (inp) { inp.click(); return; }
                                }
                                chobonLabel.click();
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
                    ss = await take_screenshot(page)
                    task.update("running", "초본 선택 완료", ss)
                except Exception:
                    pass

            # ⑨ 발급 목적 기본값 선택
            for sel in ["select[name*='purpose']", "select[name*='issuPurps']", "#issuPurps"]:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.select_option(index=0)
                        break
                except Exception:
                    pass

            # ⑩ 신청하기 버튼 클릭
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

            # ⑪ 인쇄/출력 창 대기 (최대 90초)
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
