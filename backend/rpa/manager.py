"""RPA 태스크 생명주기 관리 + 다중 사용자 안전 계층.

원격 다중 사용자(심사·시연)에서도 '안 터지게' 하기 위한 3중 안전장치:
  1) 동시 실행 상한(_MAX_CONCURRENT) + 대기 큐 — 브라우저가 무한 생성돼 서버가 죽는 것을 차단.
  2) 태스크당 하드 타임아웃(_TASK_TIMEOUT) — 멈춘 세션이 슬롯을 영구 점유하지 못하게.
  3) 태스크 저장소 크기 상한(_MAX_TASKS) — 메모리 무한 증가 방지(오래된 것부터 제거).
큐가 가득 차면 can_accept()=False → 라우터가 503으로 정중히 거절하고 프론트가 무설치 안내로 폴백.

개인정보 원칙(rpa/config.py): 이름·생년월일·연락처는 메모리에서만 쓰고 로깅/디스크 저장하지 않는다.
"""
import asyncio
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

# task_id → RPATask(실행 중) 또는 dict(완료) 저장소
_rpa_tasks: dict = {}
# 백그라운드 asyncio.Task 강한 참조 보관소. create_task 반환값을 버리면
# 이벤트 루프가 약참조만 쥐고 있어 GC가 실행 중 RPA를 조용히 취소할 수 있다(문서화된 함정).
# 완료 시 콜백으로 자동 제거.
_bg_tasks: set = set()

# ── 다중 사용자 안전 파라미터(환경변수로 조정) ──
_MAX_CONCURRENT = max(1, int(os.getenv("RPA_MAX_CONCURRENT", "2")))   # 동시에 띄우는 브라우저 수
_MAX_QUEUE = max(0, int(os.getenv("RPA_MAX_QUEUE", "8")))             # 대기 큐 최대 길이(초과 시 거절)
_TASK_TIMEOUT = max(60, int(os.getenv("RPA_TASK_TIMEOUT", "900")))    # 태스크 하드 타임아웃(초)
_MAX_TASKS = max(50, int(os.getenv("RPA_MAX_TASKS", "200")))          # 저장소 보관 상한

_sem: Optional[asyncio.Semaphore] = None
_active = 0     # 현재 브라우저를 점유 중인 태스크 수
_waiting = 0    # 슬롯을 기다리는(큐) 태스크 수


def _get_sem() -> asyncio.Semaphore:
    # 세마포어는 실행 중 이벤트 루프에 바인딩돼야 하므로 최초 사용 시점에 생성한다.
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(_MAX_CONCURRENT)
    return _sem


def _spawn_bg(coro) -> asyncio.Task:
    """백그라운드 태스크를 강한 참조로 붙들어 GC의 조용한 취소를 막고, 완료 시 자동 정리."""
    task = asyncio.ensure_future(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


def can_accept() -> bool:
    """새 RPA 요청을 받아들일 여력이 있는지(대기 큐가 넘치지 않았는지)."""
    return _waiting < _MAX_QUEUE


def capacity() -> dict:
    """현재 처리 용량 스냅샷 — /api/health 노출용(프론트가 '대기 N명'·폴백 판단)."""
    return {
        "max_concurrent": _MAX_CONCURRENT,
        "active": _active,
        "waiting": _waiting,
        "queue_limit": _MAX_QUEUE,
        "accepting": can_accept(),
    }


def _evict_old() -> None:
    """저장소가 상한을 넘으면 가장 오래된 태스크부터 제거(메모리 보호)."""
    if len(_rpa_tasks) <= _MAX_TASKS:
        return
    def _created(v):
        return v.get("created_at", "") if isinstance(v, dict) else getattr(v, "created_at", "")
    for k, _ in sorted(_rpa_tasks.items(), key=lambda kv: _created(kv[1]))[: len(_rpa_tasks) - _MAX_TASKS]:
        _rpa_tasks.pop(k, None)


class RPATask:
    def __init__(self, task_id: str, doc_name: str, user_name: str):
        self.task_id = task_id
        self.doc_name = doc_name
        self.user_name = user_name
        self.steps: list = []
        self.status = "pending"
        self.current_step = ""
        self.screenshot_b64: Optional[str] = None
        self.result: Optional[dict] = None
        self.created_at = datetime.now().isoformat()
        # 발급 문서 다운로드 인가 토큰(추측 불가). 시작자에게만 rpa-issue 응답으로 주고, rpa-status에는 노출하지 않는다.
        # → task_id(로그·URL에 노출됨)만으로는 남의 개인문서(주민번호 포함)를 받을 수 없게 한다.
        self.download_token = secrets.token_urlsafe(18)

    def update(self, status: str, step: str, screenshot: Optional[str] = None):
        self.status = status
        self.current_step = step
        if step:
            self.steps.append({"time": datetime.now().strftime("%H:%M:%S"), "msg": step})
        if screenshot is not None:
            self.screenshot_b64 = screenshot
        # 스토어 동기화
        _rpa_tasks[self.task_id] = self.to_dict()

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
            "download_token": self.download_token,  # 저장은 하되, rpa-status 응답에선 라우터가 제거해 노출 안 함
        }


def get_task(task_id: str) -> Optional[dict]:
    return _rpa_tasks.get(task_id)


@asynccontextmanager
async def rpa_slot():
    """RPA 실행 슬롯 — 동시 실행 상한 안에서만 브라우저를 띄우게 하는 게이트.
    오케스트레이터(여정)의 각 단계도 이 슬롯을 거쳐 전체 동시성이 _MAX_CONCURRENT로 묶인다."""
    global _active
    async with _get_sem():
        _active += 1
        try:
            yield
        finally:
            _active = max(0, _active - 1)


async def _guarded_run(task: "RPATask", run_coro) -> None:
    """태스크를 동시성 상한·타임아웃·정리 안에서 실행한다. run_coro는 인자 없는 async 팩토리."""
    global _active, _waiting
    _waiting += 1
    if _active >= _MAX_CONCURRENT:
        task.update("queued", "대기 중… 앞의 자동화가 끝나면 자동으로 시작해요")
    dequeued = False
    try:
        async with _get_sem():
            _waiting -= 1
            dequeued = True
            _active += 1
            try:
                await asyncio.wait_for(run_coro(), timeout=_TASK_TIMEOUT)
            finally:
                _active = max(0, _active - 1)
    except asyncio.TimeoutError:
        task.update("error", "시간이 초과돼 자동화를 종료했어요. 공식 사이트에서 이어서 진행해 주세요.")
    except Exception as e:  # noqa: BLE001 — 어떤 실패도 슬롯을 정상 반납해야 함
        task.update("error", f"자동화 오류: {str(e)[:200]}")
    finally:
        if not dequeued:
            _waiting = max(0, _waiting - 1)
        _rpa_tasks[task.task_id] = task.to_dict()
        _evict_old()


_SUPPORTED_DOCS = {
    "주민등록등본": ("gov24", "정부24"),
    "주민등록초본": ("gov24", "정부24"),
    "가족관계증명서": ("gov24", "정부24"),
    "장애인증명서": ("gov24", "정부24"),
    # CDP local_agent(selftest)로 검증된 정부24 소득·복지 증명 5종 — 데스크탑앱 자동발급 확장(6→11종)
    "소득금액증명": ("gov24", "정부24"),
    "지방세 납세증명서": ("gov24", "정부24"),
    "지방세 세목별 과세증명서": ("gov24", "정부24"),
    "기초생활수급자 증명서": ("gov24", "정부24"),
    "한부모가족 증명서": ("gov24", "정부24"),
    "건강보험 자격득실확인서": ("nhis", "국민건강보험공단"),
    "고용보험 피보험자격 이력내역서": ("work24", "고용24"),
}

SUPPORTED_DOC_NAMES = list(_SUPPORTED_DOCS.keys())

_SUPPORTED_SERVICES = [
    "기초연금", "아동수당", "부모급여", "청년 내일저축계좌", "첫만남이용권", "기초생활 생계급여",
]
SUPPORTED_SERVICE_NAMES = _SUPPORTED_SERVICES


def start_apply_task(service_name: str, user_name: str, profile: dict) -> str:
    """복지 서비스 신청 RPA 태스크 시작(동시성 상한·타임아웃 적용)."""
    task_id = uuid.uuid4().hex
    task = RPATask(task_id, service_name, user_name)
    _rpa_tasks[task_id] = task

    async def run_coro():
        from rpa.apply_rpa import run_apply_rpa
        await run_apply_rpa(task, service_name, profile)

    _spawn_bg(_guarded_run(task, run_coro))
    return task_id


def start_rpa_task(doc_name: str, user_name: str, user_info: dict = None) -> str:
    """RPA 태스크를 비동기 시작하고 task_id 반환(동시성 상한·타임아웃 적용)."""
    if doc_name not in _SUPPORTED_DOCS:
        raise ValueError(f"지원하지 않는 문서: {doc_name}. 지원 목록: {SUPPORTED_DOC_NAMES}")

    task_id = uuid.uuid4().hex
    task = RPATask(task_id, doc_name, user_name)
    _rpa_tasks[task_id] = task
    _info = user_info or {}

    async def run_coro():
        rpa_type = _SUPPORTED_DOCS[doc_name][0]
        if rpa_type == "gov24":
            from rpa.gov24_rpa import run_gov24_rpa
            await run_gov24_rpa(task, doc_name, _info)
        elif rpa_type == "nhis":
            from rpa.nhis_rpa import run_nhis_rpa
            await run_nhis_rpa(task, _info)
        elif rpa_type == "work24":
            from rpa.work24_rpa import run_work24_rpa
            await run_work24_rpa(task)

    _spawn_bg(_guarded_run(task, run_coro))
    return task_id
