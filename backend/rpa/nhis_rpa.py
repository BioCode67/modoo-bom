"""
국민건강보험공단 건강보험 자격득실확인서 RPA (Playwright)

흐름:
  ① 자격득실확인서 URL 접속 → 로그인 페이지로 자동 리디렉션
  ② anyid iframe 탐지 → 카카오톡 클릭 → 이름/생년월일/전화번호 자동 입력
  ③ '인증 요청' 클릭 → 사용자가 폰에서 카카오 알림 승인
  ④ 로그인 완료 URL 감지 → 자격득실확인서 페이지 복귀
  ⑤ '발급' 버튼 자동 클릭
  ⑥ 인쇄/PDF 창 완료
"""
import asyncio
import re
from rpa.base import take_screenshot, make_browser_context_args

NHIS_CERT_URL = "https://www.nhis.or.kr/nhis/minwon/jpAea00401.do"
CERT_URL_KEYWORD = "jpAea00401"
LOGIN_URL_KEYWORD = "personalLoginPage"

ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "input[value*='발급']",
    "input[value*='출력']",
    "button:has-text('출력')",
    "button:has-text('확인서 발급')",
    ".btn-issue", "#btnIssue", "#btnPrint",
]

LOGOUT_SELECTORS = [
    "a[href*='logout']", "a[href*='Logout']",
    "a[title*='로그아웃']", "button:has-text('로그아웃')",
    ".btn-logout", ".logout", ".user-logout",
    "a:has-text('로그아웃')",
]

MANUAL_LOGIN_GUIDE = """\
🔐 로그인 단계 안내 (브라우저 창을 보세요)

1️⃣  열린 브라우저에서 '간편 인증' 탭 클릭
2️⃣  인증 목록에서 '카카오톡' 클릭
3️⃣  이름 / 생년월일 / 전화번호 입력
4️⃣  '전체동의' 체크 후 '인증 요청' 클릭
5️⃣  📱 스마트폰 카카오톡 알림 → [본인인증 허용] 누르기

✅ 인증 완료 후 자동으로 다음 단계가 진행됩니다."""


def _normalize_user_info(user_info: dict) -> tuple[str, str, str, str]:
    """이름, 생년월일(8자리), 전화 앞자리, 전화 뒷자리 반환"""
    name = user_info.get("user_name", "")
    birth_raw = re.sub(r"[^0-9]", "", user_info.get("birth_date", ""))  # 19900101
    phone_raw = re.sub(r"[^0-9]", "", user_info.get("phone", ""))       # 01012345678
    phone_prefix = phone_raw[:3] if len(phone_raw) >= 3 else "010"
    phone_suffix = phone_raw[3:] if len(phone_raw) > 3 else ""
    return name, birth_raw, phone_prefix, phone_suffix


async def _find_anyid_frame(page, timeout_sec: int = 15):
    """anyid/webplay iframe 탐색 (동일 출처이므로 접근 가능)"""
    for _ in range(timeout_sec):
        for frame in page.frames:
            if "eswebgen" in frame.url or "webplay" in frame.url:
                return frame
        await asyncio.sleep(1)
    return None


async def _auto_kakao_login(page, context, task, name: str, birth: str, prefix: str, suffix: str) -> bool:
    """카카오톡 간편인증 자동 입력. 성공 시 True 반환."""

    # anyid iframe 탐색
    ss = await take_screenshot(page)
    task.update("running", "카카오 인증 위젯 탐색 중...", ss)

    anyid = await _find_anyid_frame(page, timeout_sec=15)
    if not anyid:
        task.update("running", f"⚠️ anyid iframe 미발견 — 수동 로그인으로 전환\n\n{MANUAL_LOGIN_GUIDE}", ss)
        return False

    ss = await take_screenshot(page)
    task.update("running", "인증 위젯 발견. 카카오톡 클릭 중...", ss)

    # 카카오톡 아이콘 클릭 (force=True 로 visibility 체크 우회)
    kakao_sels = [
        ".ico.certificate.kakao-talk",
        "li:has(.kakao-talk)",
        ".kakao-talk",
        "li[class*='kakao']",
        "img[alt*='카카오']",
        "img[src*='kakao']",
    ]
    clicked = False
    for sel in kakao_sels:
        try:
            el = anyid.locator(sel).first
            if await el.count() > 0:
                await el.click(force=True)
                clicked = True
                break
        except Exception:
            continue

    if not clicked:
        # JS 폴백
        try:
            result = await anyid.evaluate("""
                () => {
                    const el = document.querySelector('.kakao-talk, [class*="kakao"]');
                    if (el) { el.click(); return true; }
                    return false;
                }
            """)
            clicked = bool(result)
        except Exception:
            pass

    if not clicked:
        task.update("running", f"⚠️ 카카오 버튼 클릭 실패 — 수동 로그인으로 전환\n\n{MANUAL_LOGIN_GUIDE}")
        return False

    await asyncio.sleep(2)
    ss = await take_screenshot(page)
    task.update("running", f"카카오톡 선택 완료. 개인정보 자동 입력 중...", ss)

    # 입력 폼 탐색 (anyid frame + 새로 열린 page/frame 모두 시도)
    search_frames = list(page.frames)
    for p in context.pages:
        for f in p.frames:
            if f not in search_frames:
                search_frames.append(f)

    for frame in search_frames:
        try:
            name_el = frame.locator(
                'input[name*="nm"], input[name*="name"], input[id*="name"], input[placeholder*="이름"]'
            ).first
            if await name_el.count() == 0:
                continue

            # 이름
            await name_el.fill(name, force=True)

            # 생년월일
            birth_el = frame.locator(
                'input[name*="birth"], input[name*="bday"], input[id*="birth"], input[placeholder*="생년월일"]'
            ).first
            await birth_el.fill(birth, force=True)

            # 휴대폰 앞자리 (select)
            try:
                sel_el = frame.locator("select").first
                if await sel_el.count() > 0:
                    await sel_el.select_option(prefix)
            except Exception:
                pass

            # 휴대폰 뒷자리 (input)
            phone_el = frame.locator(
                'input[name*="phone"], input[name*="tel"], input[name*="mobile"], '
                'input[id*="phone"], input[placeholder*="번호"]'
            ).first
            await phone_el.fill(suffix, force=True)

            await asyncio.sleep(0.5)

            # 전체동의 체크
            agree_sels = [
                'input[type="checkbox"][id*="all"]',
                'label:has-text("전체동의")',
                '.all-agree',
                'input[type="checkbox"]',
            ]
            for asел in agree_sels:
                try:
                    el = frame.locator(asел).first
                    if await el.count() > 0:
                        await el.click(force=True)
                        break
                except Exception:
                    continue

            await asyncio.sleep(0.3)
            ss = await take_screenshot(page)
            task.update("running", "개인정보 입력 완료. '인증 요청' 클릭 중...", ss)

            # 인증 요청 클릭
            req_sels = [
                'button:has-text("인증 요청")',
                'a:has-text("인증 요청")',
                'input[value*="인증 요청"]',
                'button[class*="confirm"]',
                'button[class*="submit"]',
            ]
            for rsel in req_sels:
                try:
                    el = frame.locator(rsel).first
                    if await el.count() > 0:
                        await el.click(force=True)
                        await asyncio.sleep(1)
                        ss = await take_screenshot(page)
                        task.update(
                            "waiting_login",
                            "📱 카카오톡 알림이 발송되었습니다!\n\n"
                            "스마트폰의 카카오톡 알림을 확인하고\n[본인인증 허용] 버튼을 눌러주세요.\n\n"
                            "✅ 승인하면 자동으로 서류 발급이 진행됩니다.",
                            ss,
                        )
                        return True
                except Exception:
                    continue

            # JS 폴백으로 인증 요청 클릭
            try:
                result = await frame.evaluate("""
                    () => {
                        const btn = Array.from(
                            document.querySelectorAll('button, input[type=button], input[type=submit], a')
                        ).find(e => (e.textContent || e.value || '').includes('인증 요청'));
                        if (btn) { btn.click(); return true; }
                        return false;
                    }
                """)
                if result:
                    await asyncio.sleep(1)
                    ss = await take_screenshot(page)
                    task.update(
                        "waiting_login",
                        "📱 카카오톡 알림이 발송되었습니다!\n\n"
                        "스마트폰의 카카오톡 알림을 확인하고\n[본인인증 허용] 버튼을 눌러주세요.",
                        ss,
                    )
                    return True
            except Exception:
                pass

        except Exception:
            continue

    task.update("running", f"⚠️ 폼 자동 입력 실패 — 수동 로그인으로 전환\n\n{MANUAL_LOGIN_GUIDE}")
    return False


async def _wait_for_cert_page(page, task, timeout_sec: int = 300) -> bool:
    """로그인 완료 후 자격득실확인서 페이지 복귀 대기"""
    last_report = 0

    for elapsed in range(timeout_sec):
        try:
            url = page.url
            if CERT_URL_KEYWORD in url and LOGIN_URL_KEYWORD not in url:
                return True
            for sel in LOGOUT_SELECTORS:
                try:
                    if await page.locator(sel).first.count() > 0:
                        return True
                except Exception:
                    pass
        except Exception:
            pass

        if elapsed > 0 and elapsed - last_report >= 15:
            try:
                ss = await take_screenshot(page)
                task.update(
                    "waiting_login",
                    f"📱 카카오톡 알림 승인 대기 중...\n\n"
                    f"스마트폰에서 카카오톡 → [본인인증 허용] 을 눌러주세요.\n\n"
                    f"⏱ 남은 시간: {timeout_sec - elapsed}초",
                    ss,
                )
                last_report = elapsed
            except Exception:
                pass

        await asyncio.sleep(1)

    return False


async def _click_issue_button(page, context, task) -> bool:
    """발급 버튼 클릭"""
    await asyncio.sleep(2)
    for check_page in context.pages:
        for sel in ISSUE_SELECTORS:
            try:
                el = check_page.locator(sel).first
                if await el.count() > 0:
                    await el.scroll_into_view_if_needed()
                    await el.click()
                    await asyncio.sleep(1.5)
                    ss = await take_screenshot(check_page)
                    task.update("running", "'발급' 버튼 클릭 완료 — 처리 중...", ss)
                    return True
            except Exception:
                continue

    # JS 폴백
    try:
        for check_page in context.pages:
            result = await check_page.evaluate("""
                () => {
                    const kws = ['발급', '확인서 발급', '발급하기', '출력', '인쇄'];
                    for (const kw of kws) {
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


async def run_nhis_rpa(task, user_info: dict = None) -> None:
    """국민건강보험공단 건강보험 자격득실확인서 발급 RPA"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치\n터미널에서: pip install playwright && playwright install chromium")
        return

    info = user_info or {}
    name, birth, ph_prefix, ph_suffix = _normalize_user_info(info)
    has_user_info = bool(name and birth and ph_suffix)

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=150,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            ctx_args = make_browser_context_args()
            ctx_args["no_viewport"] = True
            context = await browser.new_context(**ctx_args)
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① 자격득실확인서 URL 접속
            task.update("running", "건강보험공단 접속 중...\n(로그인 페이지로 이동합니다)")
            try:
                await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(NHIS_CERT_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(2)

            ss = await take_screenshot(page)
            current_url = page.url

            # ② 이미 로그인된 경우 바로 발급
            if CERT_URL_KEYWORD in current_url and LOGIN_URL_KEYWORD not in current_url:
                task.update("running", "이미 로그인 상태 — 발급 버튼 탐색 중...", ss)

            else:
                # ③ 로그인 페이지 — 개인정보가 있으면 자동 입력 시도
                if has_user_info:
                    task.update(
                        "running",
                        f"로그인 페이지 도달.\n카카오 인증 자동 입력 시작...\n"
                        f"이름: {name} / 생년월일: {birth} / 전화: {ph_prefix}-{ph_suffix}",
                        ss,
                    )
                    await asyncio.sleep(3)  # 페이지 완전 로드 대기
                    auto_ok = await _auto_kakao_login(page, context, task, name, birth, ph_prefix, ph_suffix)
                else:
                    # 개인정보 없으면 수동 안내
                    task.update("waiting_login", MANUAL_LOGIN_GUIDE, ss)
                    auto_ok = False

                login_ok = await _wait_for_cert_page(page, task, timeout_sec=300)

                if not login_ok:
                    ss = await take_screenshot(page)
                    task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                    await browser.close()
                    return

                ss = await take_screenshot(page)
                task.update("running", "✅ 로그인 완료! 자격득실확인서 페이지 이동 중...", ss)
                await asyncio.sleep(1)

                if CERT_URL_KEYWORD not in page.url:
                    await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=20000)
                    await asyncio.sleep(2)
                    ss = await take_screenshot(page)
                    task.update("running", f"자격득실확인서 페이지 접속\nURL: {page.url}", ss)

            # ④ 발급 버튼 클릭
            ss = await take_screenshot(page)
            task.update("running", "발급 버튼 탐색 중...", ss)
            clicked = await _click_issue_button(page, context, task)

            if not clicked:
                ss = await take_screenshot(page)
                task.update(
                    "running",
                    "발급 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '발급하기' 또는 '출력' 버튼을 직접 클릭해주세요.",
                    ss,
                )

            # ⑤ 출력/PDF 팝업 대기
            await _wait_for_print_popup(context, task, timeout_sec=90)

            # ⑥ 완료
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
