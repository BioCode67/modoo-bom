"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)
- www.gov.kr 로그인 → 간편인증(카카오톡) → anyid 본인인증 → 서비스 페이지
- 로그인은 www.gov.kr에서 직접 수행 (plus.gov.kr과 다른 세션이므로)
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
)

# 문서 발급 서비스 URL (www.gov.kr)
_BASE_DOC_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _BASE_DOC_URL,
    "주민등록초본": _BASE_DOC_URL,
}

# www.gov.kr 로그인 페이지 직접 URL (returnUrl 없이, 감지용)
GOV24_LOGIN_BASE = "https://www.gov.kr/portal/login"

# 간편인증 탭 선택자 (www.gov.kr 로그인 화면)
SIMPLE_AUTH_SELECTORS = [
    # www.gov.kr 로그인 탭
    "li.simplicity.login_type.anyidEsign a",
    "li.anyidEsign a",
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "button:has-text('간편인증')",
    ".login-tab:has-text('간편인증')",
    "a[onclick*='tab']",
    # plus.gov.kr 폴백
    "a.login-link.open-modal",
    "a[class*='anyidEsign']",
]

# 신청하기 버튼 선택자
APPLY_SELECTORS = [
    "a.btn_bg01",
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('발급신청')",
    "button:has-text('발급신청')",
    "a:has-text('온라인신청')",
    "a:has-text('인터넷발급')",
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


async def _do_login(page, task) -> str:
    """
    현재 페이지(로그인 페이지)에서 간편인증 → 카카오톡 흐름 수행.
    현재 로그인 URL 반환 (wait_for_login에 넘겨주기 위해).
    """
    login_page_url = page.url
    ss = await take_screenshot(page)
    task.update("running", f"로그인 페이지 감지\nURL: {login_page_url}", ss)

    # 간편인증 탭 클릭
    await asyncio.sleep(1.5)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if simple_clicked:
        await asyncio.sleep(2)
        ss = await take_screenshot(page)
        task.update("running", "간편인증 탭 선택 완료 — 카카오톡 찾는 중...", ss)

    # anyid 모달에서 카카오톡 클릭 (카카오뱅크 아님)
    await asyncio.sleep(1)
    kakaotalk_clicked = await click_kakaotalk_in_anyid(page)
    await asyncio.sleep(2)
    ss = await take_screenshot(page)

    # 본인인증 정보 입력 폼 감지
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
    elif simple_clicked:
        task.update(
            "waiting_login",
            "간편인증 탭이 선택됐습니다.\n"
            "브라우저에서 '카카오톡(TALK)'을 선택하고 본인인증을 완료해주세요.\n"
            "📱 카카오톡 알림 허용 후 자동으로 진행됩니다.",
            ss,
        )
    else:
        task.update(
            "waiting_login",
            "브라우저에서 '간편인증' 탭 → '카카오톡(TALK)' 선택 후\n"
            "본인인증 정보(이름·생년월일·전화번호)를 입력하고\n"
            "'인증 요청'을 클릭해주세요.\n"
            "📱 카카오톡 알림 허용 후 자동으로 진행됩니다.",
            ss,
        )

    return login_page_url


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

            # ① www.gov.kr 서비스 페이지 직접 접속
            #    로그인이 안 되어 있으면 자동으로 www.gov.kr 로그인 페이지로 리디렉션됨.
            #    www.gov.kr 세션으로 로그인해야 이후 서비스 접근이 가능함.
            task.update("running", f"정부24 서비스 페이지 접속 중... ({doc_name})")
            try:
                await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(doc_url, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            current_url = page.url
            ss = await take_screenshot(page)
            task.update("running", f"접속 완료\n현재 URL: {current_url}", ss)

            # ② 로그인 페이지로 리디렉션됐으면 로그인 수행
            is_login_page = any(k in current_url for k in ["login", "Login", "member"])

            if is_login_page:
                login_page_url = await _do_login(page, task)

                # ③ 로그인 완료 대기 (URL이 서비스 페이지로 돌아올 때까지, 최대 5분)
                login_ok = await wait_for_login(
                    page, task, timeout_sec=300, login_url=login_page_url
                )
                if not login_ok:
                    ss = await take_screenshot(page)
                    task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                    await browser.close()
                    return

                ss = await take_screenshot(page)
                task.update("running", f"로그인 완료! 현재 URL: {page.url}", ss)
                await asyncio.sleep(2)

                # 로그인 후 URL이 서비스 페이지로 복귀하지 않았으면 직접 이동
                if "AA020InfoCappView" not in page.url:
                    task.update("running", f"{doc_name} 서비스 페이지로 이동 중...")
                    await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(3)
                    ss = await take_screenshot(page)
                    task.update("running", f"{doc_name} 서비스 페이지 접속 완료", ss)

                    # 이번에도 로그인 페이지면 에러
                    if any(k in page.url for k in ["login", "Login", "member"]):
                        task.update(
                            "error",
                            "서비스 페이지 접근 중 다시 로그인 페이지로 리디렉션됐습니다.\n"
                            "브라우저에서 직접 로그인 후 문서를 발급해주세요.",
                            await take_screenshot(page),
                        )
                        await browser.close()
                        return
            else:
                # 이미 로그인된 상태
                task.update("running", "이미 로그인됨 — 서비스 페이지 직접 접속 완료", ss)

            # ④ "온라인 발급" 탭 선택
            await asyncio.sleep(1)
            online_selectors = [
                "a:has-text('온라인발급')", "a:has-text('온라인 발급')",
                "a:has-text('전자문서')", "button:has-text('온라인발급')",
                "a:has-text('인터넷발급')",
            ]
            if await click_first_matching(page, online_selectors):
                await asyncio.sleep(1.5)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑤ 초본 신청 시 '초본' 선택
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

            # ⑥ 발급 목적 기본값 선택
            for sel in ["select[name*='purpose']", "select[name*='issuPurps']", "#issuPurps"]:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0:
                        await el.select_option(index=0)
                        break
                except Exception:
                    pass

            # ⑦ 신청하기 버튼 클릭
            await asyncio.sleep(1)
            ss = await take_screenshot(page)
            task.update("running", "신청하기 버튼 탐색 중...", ss)

            clicked = await click_first_matching(page, APPLY_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "신청하기 버튼 클릭 완료 — 결과를 기다리는 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update(
                    "running",
                    "발급 신청 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '신청하기' 또는 '발급신청' 버튼을 직접 눌러주세요.\n"
                    "완료 후 자동으로 감지합니다.",
                    ss,
                )

            # ⑧ 인쇄/출력 창 대기 (최대 90초)
            printed = False
            for _ in range(90):
                try:
                    for sel in PRINT_SELECTORS:
                        el = page.locator(sel).first
                        if await el.count() > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            printed = True
                            break

                    if len(context.pages) > 1:
                        popup = context.pages[-1]
                        await popup.bring_to_front()
                        ss = await take_screenshot(popup)
                        task.update("running", "팝업 창 감지 — 발급 완료 화면입니다.", ss)
                        printed = True
                        break

                    if printed:
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            ss = await take_screenshot(page)
            if printed:
                task.update(
                    "done",
                    f"✅ {doc_name} 발급 절차 완료!\n"
                    "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    ss,
                )
            else:
                task.update(
                    "done",
                    f"✅ {doc_name} 신청 완료! 출력 버튼은 자동으로 감지되지 않았습니다.\n"
                    "열린 브라우저에서 직접 Ctrl+P(⌘+P)로 PDF 저장하거나 인쇄해주세요.\n"
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
