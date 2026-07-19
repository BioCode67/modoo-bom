"""여정 스코프 공유 브라우저 세션 — 정부24 연쇄발급 '진짜 한 번 인증'의 핵심.

왜: 여정의 gov24 서류가 서류마다 새 브라우저를 띄우면 카카오 로그인 인증도 서류 수만큼
필요했다(3서류 = 승인 3회). 첫 서류가 만든 브라우저·로그인 세션을 여정 내내 공유하면
로그인 인증은 1회가 된다(서류별 전자서명 인증은 정부24 정책에 따라 필요 시 그대로 —
없는 걸 없앤 척하지 않는다).

설계 원칙:
· 서류별 폼 흐름·셀렉터·성공판정은 일절 건드리지 않는다 — 브라우저 '수명'만 여정 레벨로 승격.
· 세션이 죽었거나(창 닫힘·크래시) 로그인이 만료되면 기존 경로가 자연 복구한다
  (ensure()가 재생성, 발급 폼의 재로그인 감지가 재인증).
· 한 여정 안에서 순차 사용 전제(병렬 공유 금지). 단계 코루틴이 하드취소돼도 브라우저는
  세션 소유라 살아남고, 다음 서류의 goto가 화면 상태를 리셋한다.
· 여정 종료(정상·취소·예외)는 orchestrator finally 가 close()로 반드시 정리한다.
"""
import asyncio

from rpa.base import launch_browser, make_browser_context_args, NO_PRINT_SCRIPT


class GovSession:
    """정부24 공유 세션 홀더. ensure()로 살아있는 페이지를 보장하고 close()로 전부 정리."""

    def __init__(self):
        self._pw = None
        self.browser = None
        self.context = None
        self.page = None
        self.logged_in = False  # 이 세션에서 정부24 로그인을 마쳤는지 — 후속 서류는 폼 직행
        self.closed = False

    def alive(self) -> bool:
        """페이지가 아직 살아있는지(사용자가 창을 닫으면 False)."""
        try:
            return self.page is not None and not self.page.is_closed()
        except Exception:
            return False

    async def ensure(self) -> bool:
        """살아있는 페이지를 보장. 반환: 새로 만들었는지(True=새 브라우저 → 로그인 필요).
        죽은 세션은 조용히 재생성하며 logged_in 을 리셋한다(재로그인은 기존 경로가 수행)."""
        if self.closed:
            raise RuntimeError("이미 종료된 세션")
        if self.alive():
            return False
        await self._teardown()
        from playwright.async_api import async_playwright
        self._pw = await async_playwright().start()
        try:
            self.browser = await launch_browser(self._pw)
            self.context = await self.browser.new_context(**make_browser_context_args())
            await self.context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            await self.context.add_init_script(NO_PRINT_SCRIPT)  # 인쇄창 렌더러 블록 방지(감사 CRITICAL)
            self.page = await self.context.new_page()
        except Exception:
            await self._teardown()  # 반쯤 만들어진 리소스 누수 방지
            raise
        self.logged_in = False
        return True

    async def _teardown(self):
        try:
            if self.browser is not None:
                await self.browser.close()
        except Exception:
            pass
        try:
            if self._pw is not None:
                await self._pw.stop()
        except Exception:
            pass
        self.browser = self.context = self.page = None
        self._pw = None
        self.logged_in = False

    async def close(self):
        """여정 종료 정리 — 몇 번을 불러도 안전(idempotent)."""
        self.closed = True
        await self._teardown()


async def close_quietly(session) -> None:
    """orchestrator finally 용 — 세션이 없거나 닫다 실패해도 여정 종결을 막지 않는다."""
    if session is None:
        return
    try:
        await asyncio.wait_for(session.close(), timeout=15)
    except Exception:
        pass
