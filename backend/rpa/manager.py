"""RPA 태스크 생명주기 관리 + 다중 사용자 안전 계층.

원격 다중 사용자(심사·시연)에서도 '안 터지게' 하기 위한 3중 안전장치:
  1) 동시 실행 상한(_MAX_CONCURRENT) + 대기 큐 — 브라우저가 무한 생성돼 서버가 죽는 것을 차단.
  2) 태스크당 하드 타임아웃(_TASK_TIMEOUT) — 멈춘 세션이 슬롯을 영구 점유하지 못하게.
  3) 태스크 저장소 크기 상한(_MAX_TASKS) — 메모리 무한 증가 방지(오래된 것부터 제거).
큐가 가득 차면 can_accept()=False → 라우터가 503으로 정중히 거절하고 프론트가 무설치 안내로 폴백.

개인정보 원칙(rpa/config.py): 이름·생년월일·연락처는 메모리에서만 쓰고 로깅/디스크 저장하지 않는다.
"""
import asyncio
import hmac
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional


def token_ok(t, token) -> bool:
    """상수시간 토큰 비교 — 비ASCII/None/타입불일치 입력에도 예외 없이 False.
    (hmac.compare_digest 는 비ASCII str 에 TypeError 를 던져 게이트가 500 이 되던 결함 방지 — 감사 확정)."""
    try:
        if not t or not token:
            return False
        return hmac.compare_digest(str(t).encode("utf-8"), str(token).encode("utf-8"))
    except (TypeError, ValueError):
        return False


# 상태 응답에서 토큰 미인가 시 제거할 민감 필드(정부 페이지 스샷·실명·민감 서류종).
_SENSITIVE_STATUS_FIELDS = ("screenshot_b64", "user_name", "doc_name")


def redact_status(d: dict, authorized: bool) -> dict:
    """상태 dict 를 응답용으로 정제 — download_token 은 항상 제거, 미인가면 PII 필드도 제거."""
    d = dict(d)
    d.pop("download_token", None)  # 인가 비밀은 어떤 경우에도 노출 금지
    if not authorized:
        for k in _SENSITIVE_STATUS_FIELDS:
            d.pop(k, None)
    return d


# task_id → RPATask(실행 중) 또는 dict(완료) 저장소.
# ⚠️ update() 가 매번 to_dict() 스냅샷으로 덮으므로, 폴링 조회용인 이 스토어에는 대부분 dict 가 담긴다.
_rpa_tasks: dict = {}
# task_id → '살아있는' RPATask 객체(실행 중에만). _rpa_tasks 는 dict 스냅샷이라 취소 플래그를 걸 수 없어,
# request_cancel 이 실제 객체에 cancel_requested 를 세팅하려면 이 별도 레지스트리가 필요하다(감사 취소인프라).
_live_tasks: dict = {}
# 백그라운드 asyncio.Task 강한 참조 보관소. create_task 반환값을 버리면
# 이벤트 루프가 약참조만 쥐고 있어 GC가 실행 중 RPA를 조용히 취소할 수 있다(문서화된 함정).
# 완료 시 콜백으로 자동 제거.
_bg_tasks: set = set()


def register_live(task) -> None:
    """실행 중 RPATask 를 취소 대상 레지스트리에 등록(_guarded_run·여정 단계 시작 시)."""
    try:
        _live_tasks[task.task_id] = task
    except Exception:
        pass


def unregister_live(task_id: str) -> None:
    """종결된 RPATask 를 취소 레지스트리에서 제거(누수 방지)."""
    _live_tasks.pop(task_id, None)

# ── 다중 사용자 안전 파라미터(환경변수로 조정) ──
_MAX_CONCURRENT = max(1, int(os.getenv("RPA_MAX_CONCURRENT", "2")))   # 동시에 띄우는 브라우저 수
_MAX_QUEUE = max(0, int(os.getenv("RPA_MAX_QUEUE", "8")))             # 대기 큐 최대 길이(초과 시 거절)
# 태스크 하드 타임아웃(초) — 기본 1800.
# ⚠️ 내부 대기 합(gov24 로그인480+주소정정240+전자서명240+유예60 ≈ 1020s / apply 로그인300+검토600 ≈ 900s)보다
#    커야 검토·인증 도중 브라우저가 강제 종료되지 않는다. 과거 기본 900은 이 합보다 짧아 현장에서
#    발급/검토 중 창이 닫히던 결함(감사 확정) → 1800으로 상향(uvicorn·docker 기동에도 안전 기본).
_TASK_TIMEOUT = max(60, int(os.getenv("RPA_TASK_TIMEOUT", "1800")))
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


_TERMINAL_STATUSES = ("done", "completed", "error", "cancelled")


def _evict_old() -> None:
    """저장소가 상한을 넘으면 '끝난' 태스크 중 가장 오래된 것부터 제거(메모리 보호).

    ⚠️ 진행 중(pending/queued/running/waiting_*) 태스크를 지우면 다중 접속 데모에서
    사용자가 폴링하던 status 가 갑자기 404 → 화면이 멈춘다. 종료 상태만 퇴거 대상(감사 지적)."""
    if len(_rpa_tasks) <= _MAX_TASKS:
        return
    def _created(v):
        return v.get("created_at", "") if isinstance(v, dict) else getattr(v, "created_at", "")
    def _status(v):
        return v.get("status", "") if isinstance(v, dict) else getattr(v, "status", "")
    removable = [(k, v) for k, v in _rpa_tasks.items() if _status(v) in _TERMINAL_STATUSES]
    excess = len(_rpa_tasks) - _MAX_TASKS
    for k, _ in sorted(removable, key=lambda kv: _created(kv[1]))[:excess]:
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
        # 사용자 취소 요청 플래그 — 러너의 대기 루프가 매 틱 확인(check_cancel)해 즉시 빠져나온다.
        #   진행 중 작업을 중단할 수단이 전무해 잘못 시작한 태스크가 슬롯을 30분씩 붙들던 것(감사 확정)의 탈출구.
        self.cancel_requested = False
        # 하드 취소용 핸들 2종:
        #   _run_handle : 실제 RPA 코루틴 태스크(실행 중). 취소하면 브라우저 정리까지 돈다(선호).
        #   _guard_handle: _guarded_run 자체(큐 대기 중엔 _run_handle 이 아직 없어 이걸 취소해 슬롯 대기를 끊는다).
        self._run_handle = None
        self._guard_handle = None
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
            "cancel_requested": self.cancel_requested,
            "download_token": self.download_token,  # 저장은 하되, rpa-status 응답에선 라우터가 제거해 노출 안 함
        }


def get_task(task_id: str) -> Optional[dict]:
    return _rpa_tasks.get(task_id)


@asynccontextmanager
async def queued_slot():
    """rpa_slot + 대기 큐 카운팅 — _guarded_run 밖에서 슬롯을 기다리는 실행(여정 단계 등)이
    can_accept() 백프레셔에 잡히도록, 슬롯 대기 동안 _waiting 을 올린다(감사 지적: journey 큐 우회)."""
    global _active, _waiting
    _waiting += 1
    dequeued = False
    try:
        async with _get_sem():
            _waiting -= 1
            dequeued = True
            _active += 1
            try:
                yield
            finally:
                _active = max(0, _active - 1)
    finally:
        if not dequeued:  # 슬롯 획득 전 취소·예외 → 대기 카운트 반납
            _waiting = max(0, _waiting - 1)


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


def request_cancel(task_id: str) -> bool:
    """진행 중 태스크에 취소를 요청한다 — 러너 대기 루프가 다음 틱에 CancelledByUser 로 빠져나오고,
    그래도 안 멈추면 3초 유예 후 하드 취소로 asyncio.Task 를 취소한다. 반환: 취소를 받아들였는지.
    이미 종결(done/completed/error/cancelled)이면 False.

    ⚠️ 폴링 스토어(_rpa_tasks)는 update() 가 dict 스냅샷으로 덮으므로 취소 플래그를 걸 수 없다 →
       실행 중 실제 객체는 _live_tasks 에서 찾는다(감사 취소인프라 핵심)."""
    live = _live_tasks.get(task_id)
    snap = _rpa_tasks.get(task_id)
    if live is None and snap is None:
        return False
    status = getattr(live, "status", None) or (snap.get("status", "") if isinstance(snap, dict) else getattr(snap, "status", ""))
    if status in ("done", "completed", "error", "cancelled"):
        return False
    if live is None:
        # 살아있는 객체가 없으면(이미 종결됐거나 등록 전) 취소 대상 없음
        return False
    live.cancel_requested = True
    # 협조적 취소가 반응 없을 경우를 대비해 하드 취소를 예약(3초 유예 — 정리가 돌 시간).
    #   ⚠️ 캡처가 아니라 '발화 시점'에 핸들을 다시 읽는다 — 예약 당시 큐 대기(inner 없음)였다가 그 사이
    #      실행에 들어가 _run_handle 이 생겼을 수 있어서. 실행 중이면 inner(정리까지), 아직 큐면 guard(슬롯대기 끊기).
    async def _hard_cancel(tid=task_id):
        await asyncio.sleep(3)
        lt = _live_tasks.get(tid)
        if lt is None:
            return
        h = getattr(lt, "_run_handle", None) or getattr(lt, "_guard_handle", None)
        if h is not None and not h.done():
            h.cancel()
    _spawn_bg(_hard_cancel())
    live.update("running", "⏹ 중단 요청을 받았어요 — 자동화를 정리하는 중…")
    return True


async def _guarded_run(task: "RPATask", run_coro) -> None:
    """태스크를 동시성 상한·타임아웃·정리 안에서 실행한다. run_coro는 인자 없는 async 팩토리."""
    global _active, _waiting
    _waiting += 1
    task._guard_handle = asyncio.current_task()  # 큐 대기 중 하드 취소 대상(슬롯 대기를 끊음)
    register_live(task)  # 취소 대상 등록(슬롯 대기 중에도 [중단] 가능)
    if _active >= _MAX_CONCURRENT:
        task.update("queued", "대기 중… 앞의 자동화가 끝나면 자동으로 시작해요")
    dequeued = False
    try:
        async with _get_sem():
            _waiting -= 1
            dequeued = True
            _active += 1
            inner = None
            try:
                if getattr(task, "cancel_requested", False):
                    # 슬롯 대기(queued) 중 [중단] 요청됨 — 실행 전에 즉시 중단(큐에서 취소된 태스크가
                    #   뒤늦게 브라우저를 띄우는 것 방지). inner 를 만들지 않아 아래 정리는 무해.
                    task.update("cancelled", "자동화를 중단했어요. 필요하면 다시 시작할 수 있어요.")
                    return
                # RPA 코루틴을 별도 태스크로 돌린다 — wait_for 가 타임아웃 시 내부 취소 정리를 '무한' 기다리다
                #   슬롯을 영구 누수하던 결함(감사 :211) 회피. 하드 취소(request_cancel)도 이 inner 를 직접 취소.
                inner = asyncio.ensure_future(run_coro())
                task._run_handle = inner
                done, pending = await asyncio.wait({inner}, timeout=_TASK_TIMEOUT)
                if pending:
                    # 하드 타임아웃 — 취소를 요청하되, 정리(브라우저 종료)가 굳어도 최대 20초만 기다리고 슬롯 반납
                    inner.cancel()
                    await asyncio.wait({inner}, timeout=20)
                    raise asyncio.TimeoutError
                if inner.cancelled():
                    raise asyncio.CancelledError
                exc = inner.exception()
                if exc is not None:
                    raise exc
                # 러너가 종결 상태(done/error/cancelled)를 보고하지 않고 끝났으면(이른 return 등)
                #   비종결 좀비 레코드로 남아 퇴거 불가 + 프론트가 영구 폴링한다 → 정직하게 종결(가짜 '완료' 금지).
                if getattr(task, "status", "") not in ("done", "completed", "cancelled", "error"):
                    task.update("error", "자동화가 완료를 확인하지 못하고 끝났어요. 화면을 확인하고 필요하면 다시 시도해 주세요.")
            finally:
                # 정리가 20초 안에 안 끝난 orphan inner 는 백그라운드로 흘려보내되(강한참조 유지) 슬롯은 반납
                if inner is not None and not inner.done():
                    _bg_tasks.add(inner)
                    inner.add_done_callback(_bg_tasks.discard)
                task._run_handle = None
                _active = max(0, _active - 1)
    except asyncio.TimeoutError:
        # 이미 발급 완료(done)에 도달한 태스크는 error 로 덮어쓰지 않는다 — 유예 sleep 중 타임아웃이
        #   성공을 실패로 보고하던 결함(감사 확정) 방지. 미완 상태에서만 시간초과로 표기.
        if getattr(task, "status", "") not in ("done", "completed"):
            task.update("error", "시간이 초과돼 자동화를 종료했어요. 공식 사이트에서 이어서 진행해 주세요.")
    except asyncio.CancelledError:
        # 하드 취소(request_cancel 의 유예 취소 또는 외부 취소) — 종결 상태로 확정하고 좀비 방지.
        if getattr(task, "status", "") not in ("done", "completed"):
            task.update("cancelled", "자동화를 중단했어요. 필요하면 다시 시작할 수 있어요.")
    except Exception as e:  # noqa: BLE001 — 어떤 실패도 슬롯을 정상 반납해야 함
        # 협조적 취소(CancelledByUser)는 사용자 중단이므로 error 가 아니라 cancelled 로 정직히 표기.
        if type(e).__name__ == "CancelledByUser" or getattr(task, "cancel_requested", False):
            task.update("cancelled", "자동화를 중단했어요. 필요하면 다시 시작할 수 있어요.")
        else:
            task.update("error", f"자동화 오류: {str(e)[:200]}")
    finally:
        task._run_handle = None
        task._guard_handle = None
        unregister_live(task.task_id)  # 취소 레지스트리에서 제거(누수 방지)
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
    # 2026-07-11 확장 4종(AA020 실측: 즉시발급형·본인·무료) — gov24_rpa.DOC_CAPP와 단일소스 일치
    "국세 납세증명서": ("gov24", "정부24"),
    "출입국에 관한 사실증명": ("gov24", "정부24"),
    "병적증명서": ("gov24", "정부24"),
    "건강보험료 납부확인서": ("gov24", "정부24"),
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
            await run_work24_rpa(task, _info)

    _spawn_bg(_guarded_run(task, run_coro))
    return task_id


def start_demo_task(doc_name: str = "주민등록등본") -> str:
    """체험 모드 태스크 — 개인정보 없이 '실제 정부24 자동조작'을 스크린샷으로 보여주고 인증벽에서 정지.
    지원 서류 제한 없음(안내 페이지가 없으면 정부24 홈으로 폴백). 동시성 상한·타임아웃은 발급과 공유."""
    task_id = uuid.uuid4().hex
    task = RPATask(task_id, doc_name or "주민등록등본", "체험")
    _rpa_tasks[task_id] = task

    async def run_coro():
        from rpa.demo_rpa import run_demo_rpa
        await run_demo_rpa(task, doc_name or "주민등록등본")

    _spawn_bg(_guarded_run(task, run_coro))
    return task_id
