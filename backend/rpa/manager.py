"""RPA 태스크 생명주기 관리"""
import asyncio
import uuid
from datetime import datetime
from typing import Optional

# task_id → RPATask 저장소
_rpa_tasks: dict = {}


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
        }


def get_task(task_id: str) -> Optional[dict]:
    return _rpa_tasks.get(task_id)


_SUPPORTED_DOCS = {
    "주민등록등본": ("gov24", "정부24"),
    "주민등록초본": ("gov24", "정부24"),
    "가족관계증명서": ("gov24", "정부24"),
    "장애인증명서": ("gov24", "정부24"),
    "건강보험 자격득실확인서": ("nhis", "국민건강보험공단"),
    "고용보험 피보험자격 이력내역서": ("work24", "고용24"),
}

SUPPORTED_DOC_NAMES = list(_SUPPORTED_DOCS.keys())

_SUPPORTED_SERVICES = [
    "기초연금", "아동수당", "부모급여", "청년 내일저축계좌", "첫만남이용권", "기초생활 생계급여",
]
SUPPORTED_SERVICE_NAMES = _SUPPORTED_SERVICES


def start_apply_task(service_name: str, user_name: str, profile: dict) -> str:
    """복지 서비스 신청 RPA 태스크 시작"""
    task_id = uuid.uuid4().hex[:10]
    task = RPATask(task_id, service_name, user_name)
    _rpa_tasks[task_id] = task.to_dict()

    loop = asyncio.get_event_loop()

    async def _run():
        _rpa_tasks[task_id] = task
        from rpa.apply_rpa import run_apply_rpa
        await run_apply_rpa(task, service_name, profile)
        _rpa_tasks[task_id] = task.to_dict()

    loop.create_task(_run())
    return task_id


def start_rpa_task(doc_name: str, user_name: str, user_info: dict = None) -> str:
    """RPA 태스크를 비동기 시작하고 task_id 반환"""
    if doc_name not in _SUPPORTED_DOCS:
        raise ValueError(f"지원하지 않는 문서: {doc_name}. 지원 목록: {SUPPORTED_DOC_NAMES}")

    task_id = uuid.uuid4().hex[:10]
    task = RPATask(task_id, doc_name, user_name)
    _rpa_tasks[task_id] = task.to_dict()
    _info = user_info or {}

    loop = asyncio.get_event_loop()

    async def _run():
        _rpa_tasks[task_id] = task  # 객체로 교체 (update() 호출용)
        rpa_type = _SUPPORTED_DOCS[doc_name][0]

        if rpa_type == "gov24":
            from rpa.gov24_rpa import run_gov24_rpa
            await run_gov24_rpa(task, doc_name)
        elif rpa_type == "nhis":
            from rpa.nhis_rpa import run_nhis_rpa
            await run_nhis_rpa(task, _info)
        elif rpa_type == "work24":
            from rpa.work24_rpa import run_work24_rpa
            await run_work24_rpa(task)

        # 최종 dict 저장
        _rpa_tasks[task_id] = task.to_dict()

    loop.create_task(_run())
    return task_id
