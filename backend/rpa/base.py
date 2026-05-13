"""RPA 공통 기반 — 브라우저 세션, 스크린샷, 카카오 로그인 감지"""
import asyncio
import base64
from datetime import datetime
from typing import Optional, Callable

# 카카오 간편인증 버튼 선택자 (각 사이트에서 공통적으로 사용)
KAKAO_SELECTORS = [
    "a:has-text('카카오')",
    "button:has-text('카카오')",
    "img[alt*='카카오']",
    ".kakao-login",
    "[class*='kakao']",
    "a[href*='kakao']",
]

# ★ 카카오톡(TALK) 전용 선택자 — 카카오뱅크/카카오스토리와 구분
KAKAOTALK_SELECTORS = [
    "a[title='카카오톡']",
    "img[alt='카카오톡']",
    "a:has-text('카카오톡')",
    "li:has-text('카카오톡') a",
    "button:has-text('카카오톡')",
    ".kakao-talk",
    "[class*='kakaotalk']",
    "[data-id='kakaotalk']",
    "[data-provider='kakaotalk']",
]

# 본인인증 정보 입력 폼 감지 선택자 (anyid 인증 요청 폼)
AUTH_FORM_SELECTORS = [
    "button:has-text('인증 요청')",
    "button:has-text('인증요청')",
    "input[placeholder*='생년월일']",
    "input[placeholder*='이름']",
    "button:has-text('전체동의')",
    "label:has-text('전체동의')",
    "input[type='checkbox']",
]

AUTH_FORM_USER_GUIDE = (
    "📋 카카오톡 본인인증 정보 입력 폼이 열렸습니다.\n\n"
    "1️⃣  이름 입력\n"
    "2️⃣  생년월일 입력 (예: 19900101)\n"
    "3️⃣  휴대폰 번호 입력\n"
    "4️⃣  '전체동의' 체크박스 선택\n"
    "5️⃣  '인증 요청' 버튼 클릭\n\n"
    "📱 이후 카카오톡 알림에서 [본인인증 허용] 을 누르면 자동으로 진행됩니다."
)

# 로그인 완료 감지 선택자
LOGIN_SUCCESS_SELECTORS = [
    "a[href*='logout']",
    "button:has-text('로그아웃')",
    ".logout",
    ".user-name",
    ".member-name",
    "#headerUserName",
    ".mypage-link",
    "a:has-text('로그아웃')",
    "[title*='로그아웃']",
]

# 공통 로그인 완료 URL 패턴
LOGIN_DONE_URL_KEYWORDS = ["main", "mypage", "portal/service", "index", "dashboard"]
LOGIN_PAGE_URL_KEYWORDS = ["login", "member/join", "auth", "personalLoginPage", "openLginPage"]


async def click_kakaotalk_in_anyid(page) -> bool:
    """
    anyid 모달에서 카카오톡을 정확히 클릭.
    카카오뱅크/카카오스토리와 혼동하지 않도록 '톡'/'kakaotalk' 텍스트만 매칭.
    """
    # 1단계: Playwright 선택자
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

    # 2단계: JS — '카카오톡'/'kakaotalk' 포함, '뱅크'/'bank' 제외
    try:
        result = await page.evaluate("""
            () => {
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

    # 3단계: JS — anyid 리스트에서 마지막 카카오 항목 (카카오톡이 보통 하단)
    try:
        result = await page.evaluate("""
            () => {
                const all = [...document.querySelectorAll('a, button, li')];
                const kakaoItems = all.filter(el => {
                    const t = (el.textContent + el.className).toLowerCase();
                    return t.includes('카카오') || t.includes('kakao');
                });
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


async def detect_auth_form(page) -> bool:
    """본인인증 정보 입력 폼이 열렸는지 감지"""
    for sel in AUTH_FORM_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                return True
        except Exception:
            continue
    return False


async def take_screenshot(page) -> str:
    try:
        buf = await page.screenshot(full_page=False, type="jpeg", quality=75)
        return base64.b64encode(buf).decode()
    except Exception:
        return ""


async def try_click_kakao(page) -> bool:
    """카카오 로그인 버튼 자동 클릭 시도. 성공 여부 반환."""
    for sel in KAKAO_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await asyncio.sleep(1.5)
                return True
        except Exception:
            continue
    return False


async def wait_for_login(
    page,
    task,
    timeout_sec: int = 180,
    login_url: Optional[str] = None,
) -> bool:
    """
    로그인 완료까지 대기 (최대 timeout_sec 초).
    로그아웃 버튼 등장 또는 URL 변화로 감지.
    """
    report_interval = 15  # 15초마다 진행상황 스크린샷
    last_report = 0

    for elapsed in range(timeout_sec):
        try:
            current_url = page.url

            # URL 기반 감지 — login 키워드가 URL에서 사라지면 완료
            is_login_page = any(k in current_url for k in LOGIN_PAGE_URL_KEYWORDS)
            is_done_page = any(k in current_url for k in LOGIN_DONE_URL_KEYWORDS)
            if is_done_page and not is_login_page:
                return True

            # 특정 로그인 URL 이탈 감지 (hash SPA 포함)
            if login_url:
                # plus.gov.kr SPA: login_url이 hash에 있으므로 현재 URL과 직접 비교
                if login_url not in current_url and not is_login_page:
                    return True

            # 로그아웃 버튼 감지
            for sel in LOGIN_SUCCESS_SELECTORS:
                try:
                    el = page.locator(sel)
                    if await el.count() > 0:
                        return True
                except Exception:
                    pass

            # 일정 간격으로 대기 중 스크린샷 업데이트
            if elapsed - last_report >= report_interval and elapsed > 0:
                try:
                    ss = await take_screenshot(page)
                    remaining = timeout_sec - elapsed
                    task.update(
                        "waiting_login",
                        f"📱 카카오 인증을 기다리는 중... (남은 시간: {remaining}초)\n"
                        "스마트폰 카카오톡 알림을 확인해주세요.",
                        ss,
                    )
                    last_report = elapsed
                except Exception:
                    pass

        except Exception:
            pass
        await asyncio.sleep(1)
    return False


async def click_first_matching(page, selectors: list) -> bool:
    """선택자 목록 중 첫 번째로 찾은 요소 클릭. 성공 여부 반환."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1)
                return True
        except Exception:
            continue
    return False


def make_browser_context_args() -> dict:
    return {
        "viewport": {"width": 1280, "height": 900},
        "locale": "ko-KR",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
    }
