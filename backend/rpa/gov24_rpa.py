"""
정부24 실제 브라우저 자동화 (Playwright RPA)
- 실제 브라우저를 눈에 보이게 열어 사용자가 로그인 후 자동 진행
- 현재 지원: 주민등록등본 (주민등록법 제29조)
"""
import asyncio
import base64
import uuid
from typing import Callable, Optional
from datetime import datetime

# 정부24 URL 상수
GOV24_BASE = "https://www.gov.kr"
# 주민등록등본 민원 직접 링크
RESIDENT_REGISTER_URL = "https://www.gov.kr/mw/AA-MO-SV-0117.do"
# 로그인 페이지
LOGIN_URL = "https://www.gov.kr/portal/login/member"

# 태스크 상태 저장소 (task_id → status dict)
_rpa_tasks: dict = {}


def get_task(task_id: str) -> Optional[dict]:
    return _rpa_tasks.get(task_id)


def list_tasks() -> list:
    return list(_rpa_tasks.values())


class RPATask:
    def __init__(self, task_id: str, doc_name: str, user_name: str):
        self.task_id = task_id
        self.doc_name = doc_name
        self.user_name = user_name
        self.steps: list = []
        self.status = "pending"  # pending / running / waiting_login / done / error
        self.current_step = ""
        self.screenshot_b64: Optional[str] = None
        self.result: Optional[dict] = None
        self.created_at = datetime.now().isoformat()

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "doc_name": self.doc_name,
            "user_name": self.user_name,
            "status": self.status,
            "current_step": self.current_step,
            "steps": self.steps,
            "screenshot_b64": self.screenshot_b64,
            "result": self.result,
            "created_at": self.created_at,
        }

    def update(self, status: str, step: str, screenshot: Optional[str] = None):
        self.status = status
        self.current_step = step
        self.steps.append({"time": datetime.now().strftime("%H:%M:%S"), "msg": step})
        if screenshot:
            self.screenshot_b64 = screenshot


async def _take_screenshot(page) -> str:
    """현재 페이지 스크린샷 → base64 인코딩"""
    try:
        buf = await page.screenshot(full_page=False, type="jpeg", quality=70)
        return base64.b64encode(buf).decode()
    except Exception:
        return ""


async def run_resident_register_rpa(task: RPATask) -> None:
    """
    주민등록등본 실제 발급 자동화.
    브라우저를 열어 사용자가 로그인하면, 이후 발급 신청을 자동 처리.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 패키지가 설치되어 있지 않습니다. pip install playwright && playwright install chromium")
        return

    try:
        async with async_playwright() as pw:
            # 눈에 보이는 브라우저로 실행
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=300,
                args=["--start-maximized"],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                locale="ko-KR",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            # ── 1단계: 정부24 접속 ──────────────────────────────────────────
            task.update("running", "정부24 접속 중...")
            await page.goto(GOV24_BASE, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(1)
            ss = await _take_screenshot(page)
            task.update("running", "정부24 메인 페이지 로드 완료", ss)

            # ── 2단계: 로그인 페이지로 이동 ─────────────────────────────────
            task.update("running", "로그인 페이지로 이동 중...")
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(1.5)
            ss = await _take_screenshot(page)
            task.update(
                "waiting_login",
                "로그인 페이지가 열렸습니다. 열린 브라우저에서 로그인을 완료해주세요. (간편인증·공동인증서·아이디 로그인 가능)",
                ss,
            )

            # ── 3단계: 로그인 완료 감지 (최대 3분) ──────────────────────────
            # 로그인 성공 시 URL이 /portal/main 등으로 변경되거나 .logout 버튼 등장
            login_detected = False
            for _ in range(180):  # 최대 3분
                try:
                    current_url = page.url
                    # URL 변화 감지
                    if (
                        "login" not in current_url
                        and "/portal" in current_url
                        or "mypage" in current_url
                    ):
                        login_detected = True
                        break
                    # 로그아웃 버튼 존재 여부로 감지
                    logout_btn = page.locator(
                        "a[href*='logout'], button:has-text('로그아웃'), .logout"
                    )
                    if await logout_btn.count() > 0:
                        login_detected = True
                        break
                    # 사용자명 표시 감지
                    username_el = page.locator(".user-name, .member-name, #headerUserName")
                    if await username_el.count() > 0:
                        login_detected = True
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            if not login_detected:
                ss = await _take_screenshot(page)
                task.update("error", "로그인 대기 시간이 초과되었습니다 (3분). 다시 시도해주세요.", ss)
                await browser.close()
                return

            ss = await _take_screenshot(page)
            task.update("running", "로그인 감지! 주민등록등본 발급 페이지로 이동합니다.", ss)
            await asyncio.sleep(1)

            # ── 4단계: 주민등록등본 발급 페이지 이동 ───────────────────────
            await page.goto(RESIDENT_REGISTER_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await _take_screenshot(page)
            task.update("running", "주민등록등본 발급 신청 페이지 접속", ss)

            # ── 5단계: 발급 형태 선택 (온라인 발급 / 전자문서) ─────────────
            # 정부24는 발급 방식 선택 UI가 있음
            try:
                # "온라인발급" 또는 "전자문서지갑" 탭 클릭 시도
                online_btn = page.locator(
                    "button:has-text('온라인발급'), a:has-text('온라인발급'), "
                    "button:has-text('전자문서'), a:has-text('전자문서')"
                ).first
                if await online_btn.count() > 0:
                    await online_btn.click()
                    await asyncio.sleep(1)
                    ss = await _take_screenshot(page)
                    task.update("running", "온라인 발급 선택", ss)
            except Exception:
                pass

            # ── 6단계: 신청 버튼 클릭 ──────────────────────────────────────
            try:
                apply_btn = page.locator(
                    "button:has-text('신청하기'), a:has-text('신청하기'), "
                    "button:has-text('발급신청'), input[value='신청하기']"
                ).first
                if await apply_btn.count() > 0:
                    await apply_btn.click()
                    await asyncio.sleep(2)
                    ss = await _take_screenshot(page)
                    task.update("running", "발급 신청 버튼 클릭 완료", ss)
                else:
                    ss = await _take_screenshot(page)
                    task.update(
                        "running",
                        "신청 버튼을 찾고 있습니다. 열린 브라우저에서 '신청하기'를 눌러주세요.",
                        ss,
                    )
            except Exception as e:
                ss = await _take_screenshot(page)
                task.update("running", f"신청 버튼 탐색 중... {str(e)[:60]}", ss)

            # ── 7단계: 신청 완료 / 다운로드 감지 ───────────────────────────
            # 완료 페이지 또는 다운로드 트리거를 최대 2분 대기
            download_path = None
            done = False
            for _ in range(120):
                try:
                    url = page.url
                    # 완료 페이지 URL 패턴
                    if any(kw in url for kw in ["complete", "result", "done", "print"]):
                        done = True
                        break
                    # "출력" 또는 "저장" 버튼 등장
                    print_btn = page.locator(
                        "button:has-text('출력'), button:has-text('저장'), "
                        "button:has-text('인쇄'), a:has-text('인쇄')"
                    )
                    if await print_btn.count() > 0:
                        done = True
                        ss = await _take_screenshot(page)
                        task.update("running", "출력/저장 버튼 감지!", ss)
                        await asyncio.sleep(1)
                        await print_btn.first.click()
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            ss = await _take_screenshot(page)
            if done:
                task.update("done", "주민등록등본 발급 신청이 완료되었습니다! 브라우저에서 확인해주세요.", ss)
                task.result = {
                    "success": True,
                    "doc_name": "주민등록등본",
                    "message": "정부24 실제 발급 완료 — 열린 브라우저에서 인쇄/저장 가능",
                }
            else:
                task.update(
                    "done",
                    "자동화가 완료되었습니다. 열린 브라우저에서 발급 절차를 마저 진행해주세요.",
                    ss,
                )
                task.result = {
                    "success": True,
                    "doc_name": "주민등록등본",
                    "message": "브라우저가 열려 있습니다. 남은 단계를 완료해주세요.",
                }

            # 브라우저는 사용자가 직접 닫도록 유지 (30초 후 자동 종료)
            await asyncio.sleep(30)
            await browser.close()

    except Exception as e:
        task.update("error", f"자동화 오류: {str(e)}", None)


def start_rpa_task(doc_name: str, user_name: str) -> str:
    """RPA 태스크를 비동기로 시작하고 task_id 반환"""
    task_id = uuid.uuid4().hex[:10]
    task = RPATask(task_id, doc_name, user_name)
    _rpa_tasks[task_id] = task.to_dict()

    # asyncio 루프에서 실행
    loop = asyncio.get_event_loop()

    async def _run():
        _rpa_tasks[task_id].update("pending", "")  # type hint workaround
        # RPATask 인스턴스로 다시 래핑
        t = RPATask(task_id, doc_name, user_name)
        _rpa_tasks[task_id] = t  # dict → 객체로 교체
        await run_resident_register_rpa(t)
        # 최종 상태 dict로 변환
        _rpa_tasks[task_id] = t.to_dict()

    loop.create_task(_run())
    return task_id
