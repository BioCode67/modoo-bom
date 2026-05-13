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
LOGIN_PAGE_URL_KEYWORDS = ["login", "member/join", "auth"]


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
    for _ in range(timeout_sec):
        try:
            current_url = page.url

            # URL 기반 감지
            is_login_page = any(k in current_url for k in LOGIN_PAGE_URL_KEYWORDS)
            is_done_page = any(k in current_url for k in LOGIN_DONE_URL_KEYWORDS)
            if is_done_page and not is_login_page:
                return True

            # 특정 로그인 URL 이탈 감지
            if login_url and login_url not in current_url and "login" not in current_url:
                return True

            # 로그아웃 버튼 감지
            for sel in LOGIN_SUCCESS_SELECTORS:
                try:
                    el = page.locator(sel)
                    if await el.count() > 0:
                        return True
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
