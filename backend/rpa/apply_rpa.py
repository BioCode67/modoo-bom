"""
복지로 복지 서비스 실제 신청 RPA (Playwright)

흐름:
  ① 복지로 로그인 (카카오톡 간편인증)
  ② 대상 서비스 검색 또는 직접 URL 이동
  ③ 신청하기 버튼 클릭
  ④ 신청 양식 자동 작성
  ⑤ 제출 전 사용자 최종 확인 대기

지원 서비스:
  - 기초연금
  - 아동수당
  - 부모급여
  - 청년 내일저축계좌
"""
import asyncio
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options,
)

BOKJIRO_LOGIN_URL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/loginPage/moveTWAT52012M.do"
BOKJIRO_SEARCH_URL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"

# 서비스별 신청 URL (복지로 직접 링크)
SERVICE_APPLY_URLS = {
    "기초연금": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002501",
    "아동수당": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002948",
    "부모급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00010441",
    "청년 내일저축계좌": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00003748",
    "첫만남이용권": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00009878",
    "기초생활 생계급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000049",
}

APPLY_BUTTON_SELECTORS = [
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('온라인신청')",
    "a:has-text('모바일신청')",
    ".btn-apply", "#btnApply",
    "input[value='신청하기']",
]

SUBMIT_BUTTON_SELECTORS = [
    "button:has-text('신청')",
    "button:has-text('제출')",
    "input[type='submit']",
    "button[type='submit']",
    "a:has-text('신청 완료')",
]


async def _login_bokjiro(page, task) -> bool:
    """복지로 로그인 (간편인증/카카오톡)"""
    login_url = page.url
    ss = await take_screenshot(page)
    task.update("running", "복지로 로그인 페이지 — 간편인증 탭 탐색 중...", ss)

    await asyncio.sleep(2)

    # 간편인증 탭
    simple_selectors = [
        "a:has-text('간편인증')", "li:has-text('간편인증') a",
        "button:has-text('간편인증')", ".easy-login",
        "[onclick*='easy']", "[data-tab='easy']",
    ]
    clicked_simple = await click_first_matching(page, simple_selectors)
    if not clicked_simple:
        clicked_simple = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    if clicked_simple:
        await asyncio.sleep(2)

    # 카카오톡 선택
    kakaotalk_clicked = await click_kakaotalk_in_anyid(page)
    await asyncio.sleep(2)
    ss = await take_screenshot(page)

    form_detected = await detect_auth_form(page)
    if kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update("waiting_login",
            "📱 카카오톡 간편인증 화면이 열렸습니다.\n"
            "스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 진행됩니다.", ss)
    else:
        task.update("waiting_login",
            "브라우저에서 '간편인증' → '카카오톡' 선택 후\n"
            "본인인증을 완료해주세요. 📱 카카오톡 알림 허용 후 자동 진행됩니다.", ss)

    login_ok = await wait_for_login(page, task, timeout_sec=300, login_url=login_url)
    if not login_ok:
        task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.")
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ 복지로 로그인 완료!\n현재: {page.url}", ss)
    return True


async def run_apply_rpa(task, service_name: str, profile: dict) -> None:
    """복지로에서 복지 서비스 신청 자동화"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    service_url = SERVICE_APPLY_URLS.get(service_name, BOKJIRO_SEARCH_URL)

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(**get_launch_options())
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① 복지로 로그인 페이지
            task.update("running", "복지로 로그인 페이지 접속 중...")
            try:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            # ② 로그인
            login_ok = await _login_bokjiro(page, task)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 서비스 페이지 이동
            task.update("running", f"'{service_name}' 서비스 페이지로 이동 중...")
            await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"'{service_name}' 서비스 정보 페이지 접속 완료", ss)

            # 로그인 재요구 처리
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                login_ok = await _login_bokjiro(page, task)
                if not login_ok:
                    await browser.close()
                    return
                await asyncio.sleep(2)
                await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(3)

            # ④ 신청하기 버튼 클릭
            ss = await take_screenshot(page)
            task.update("running", "신청하기 버튼 탐색 중...", ss)

            apply_clicked = await click_first_matching(page, APPLY_BUTTON_SELECTORS)
            await asyncio.sleep(2)

            if not apply_clicked:
                ss = await take_screenshot(page)
                task.update("waiting_login",
                    f"신청하기 버튼을 찾지 못했습니다.\n"
                    f"브라우저에서 '{service_name}' 신청하기 버튼을 직접 클릭한 후\n"
                    f"신청 양식이 표시되면 계속 진행됩니다.", ss)
                await asyncio.sleep(30)

            ss = await take_screenshot(page)
            task.update("running", "신청 양식 로드 중...", ss)

            # ⑤ 팝업 확인
            target_page = page
            if len(context.pages) > 1:
                target_page = context.pages[-1]
                await target_page.bring_to_front()
                ss = await take_screenshot(target_page)
                task.update("running", "신청 팝업 창 감지 — 양식 자동 작성 중...", ss)

            await asyncio.sleep(2)

            # ⑥ 기본 양식 자동 작성 (이름·생년월일·연락처)
            import re as _re
            name = profile.get("name", "")
            birth = _re.sub(r"[^0-9]", "", str(profile.get("birth_date", "")))
            phone = _re.sub(r"[^0-9]", "", str(profile.get("phone", "")))

            async def _fill(selectors, value):
                if not value:
                    return
                for sel in selectors:
                    try:
                        el = target_page.locator(sel).first
                        if await el.count() > 0:
                            await el.fill(value)
                            return
                    except Exception:
                        pass

            await _fill(["input[name='aplcntNm']", "input[placeholder*='이름']", "#aplcntNm"], name)
            await _fill(["input[placeholder*='생년월일']", "input[name*='brthdy']", "input[name*='birth']"], birth)
            await _fill(["input[placeholder*='휴대폰']", "input[placeholder*='연락처']", "input[name*='telno']", "input[name*='phone']"], phone)

            await asyncio.sleep(1)
            ss = await take_screenshot(target_page)
            task.update("running",
                f"✅ '{service_name}' 신청 양식이 열렸습니다!\n\n"
                f"📋 남은 작업:\n"
                f"1. 신청 양식의 내용을 확인해주세요\n"
                f"2. 추가 정보가 필요하면 직접 입력해주세요\n"
                f"3. 모든 내용 확인 후 '신청' 버튼을 클릭해주세요\n\n"
                f"⚠️ 제출은 반드시 직접 확인 후 진행해주세요.", ss)

            # 브라우저를 60초간 유지 (사용자가 직접 확인/제출)
            task.result = {"success": True, "service_name": service_name, "status": "form_ready"}
            await asyncio.sleep(60)

            # 최종 스크린샷
            try:
                final_page = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final_page)
            except Exception:
                ss = await take_screenshot(page)

            task.update("done",
                f"✅ '{service_name}' 신청 절차 안내 완료!\n"
                "브라우저에서 신청을 마저 진행하거나 나중에 복지로(www.bokjiro.go.kr)에서 신청하실 수 있습니다.\n"
                "문의: ☎ 129 (복지로 콜센터)", ss)

            await asyncio.sleep(30)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
