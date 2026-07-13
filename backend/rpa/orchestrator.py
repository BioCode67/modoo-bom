"""복지 여정 오케스트레이션 — 여러 서류 발급 RPA + 복지 신청을 '순차'로 실행하고
진행상황을 하나로 합산한다. (사용자는 각 사이트에서 카카오 본인인증만; 나머지는 자동)

- 서류(doc): gov24 / nhis / work24 RPA 로 발급 후 PDF 자동 저장
- 신청(apply): 복지로 RPA 로 양식 자동작성 (최종 제출은 사용자 승인)
"""
import asyncio
import secrets
import uuid
from datetime import datetime

# journey_id -> journey dict
_journeys: dict = {}


def get_journey(journey_id: str):
    return _journeys.get(journey_id)


def journey_view(journey_id: str, t: str = ""):
    """여정 + '현재 진행 중 단계'의 라이브 메시지/스크린샷/상태를 병합해 반환(UI 표시용).
    각 단계는 실행 중 _rpa_tasks[task_id]에 라이브 RPATask가 있어 카카오 인증 안내 등 세부 메시지를 담는다.

    ⚠️ 인가(감사 확정): 정부 페이지 스크린샷(주민번호 가능)·실명·저장경로는 시작자 토큰(?t=) 일치 시에만 노출.
       download_token 자체는 어떤 경우에도 응답에 넣지 않는다."""
    from rpa.manager import get_task, token_ok
    j = _journeys.get(journey_id)
    if j is None:
        return None
    authorized = token_ok(t, j.get("download_token"))
    view = dict(j)
    view.pop("download_token", None)
    if not authorized:
        view.pop("user_name", None)
        view["saved_docs"] = ["(발급됨)" for _ in view.get("saved_docs", [])]  # 파일 경로(PII) 숨김, 개수만
    # 단계별 정보 병합 — 현재 단계는 라이브 메시지/스크린샷, 인가 시 각 단계의 다운로드 토큰(문서 회수용)도.
    cur = j.get("current")
    steps_view = []
    for step in j.get("steps", []):
        s = dict(step)
        # 미인가면 각 단계의 파일경로·서류종·실명·주소도 제거 — saved_docs만 가리고 steps[].saved_path가
        #   그대로 새던 것 차단(감사 4차 #11, redact_status와 동일 기준).
        if not authorized:
            for k in ("saved_path", "saved_docs", "user_name", "file_path", "download_path", "doc_name", "address", "birth_date", "phone", "screenshot_b64"):
                s.pop(k, None)
        tid = step.get("task_id")
        if tid:
            task = get_task(tid)
            if task is not None:
                d = task.to_dict() if hasattr(task, "to_dict") else dict(task)
                if step.get("name") == cur:
                    view["current_message"] = d.get("current_step") or ""
                    view["current_status"] = d.get("status") or ""
                    if authorized:
                        view["current_screenshot"] = d.get("screenshot_b64")
                if authorized and d.get("status") in ("done", "completed"):
                    # 발급 완료 단계만 문서 회수 토큰 노출(서버 RPA/원격에서 PDF 다운로드용)
                    s["download_token"] = d.get("download_token")
        steps_view.append(s)
    view["steps"] = steps_view
    return view


def _new_journey(doc_names, service_names, user_name) -> str:
    jid = uuid.uuid4().hex
    steps = (
        [{"kind": "doc", "name": d, "status": "pending", "task_id": None, "saved_path": None} for d in doc_names]
        + [{"kind": "apply", "name": s, "status": "pending", "task_id": None} for s in service_names]
    )
    _journeys[jid] = {
        "journey_id": jid,
        "user_name": user_name,
        "status": "pending",
        "current": None,
        "steps": steps,
        "total": len(steps),
        "done_count": 0,
        "saved_docs": [],
        "created_at": datetime.now().isoformat(),
        "download_token": secrets.token_urlsafe(18),  # 스크린샷·실명·경로 열람 인가(시작자에게만 반환)
    }
    return jid


def journey_token(journey_id: str) -> str:
    """여정 인가 토큰 조회 — 시작 응답으로 시작자에게만 전달(스크린샷·경로 열람 인가)."""
    j = _journeys.get(journey_id)
    return (j or {}).get("download_token", "") if j else ""


def start_journey(doc_names, service_names, user_name, user_info, profile):
    """지원되는 서류/서비스만 골라 여정을 시작. 반환: (journey_id, accepted_docs, accepted_services).

    ⚠️ 지원목록 밖 항목은 제외되는데, 이를 프론트에 알려주지 않으면 해당 카드가 '대기…' 스피너로
       영구 고정된다(감사 확정) → accepted 목록을 함께 반환해 프론트가 그것만 추적하게 한다."""
    from rpa.manager import SUPPORTED_DOC_NAMES, SUPPORTED_SERVICE_NAMES
    docs = [d for d in (doc_names or []) if d in SUPPORTED_DOC_NAMES]
    svcs = [s for s in (service_names or []) if s in SUPPORTED_SERVICE_NAMES]
    jid = _new_journey(docs, svcs, user_name)
    # 강한 참조 보관(_spawn_bg)로 GC가 실행 중 여정을 취소하지 못하게 한다.
    from rpa.manager import _spawn_bg
    _spawn_bg(_run_journey(jid, user_info or {}, profile or {}))
    return jid, docs, svcs


async def _run_step_doc(task, doc_name, user_info):
    from rpa.manager import _SUPPORTED_DOCS
    rpa_type = _SUPPORTED_DOCS[doc_name][0]
    if rpa_type == "gov24":
        from rpa.gov24_rpa import run_gov24_rpa
        await run_gov24_rpa(task, doc_name, user_info)  # 이름·생년월일·휴대폰 자동입력 + 주소(sido/sigungu) 자동정정에 필요
    elif rpa_type == "nhis":
        from rpa.nhis_rpa import run_nhis_rpa
        await run_nhis_rpa(task, user_info)
    elif rpa_type == "work24":
        from rpa.work24_rpa import run_work24_rpa
        await run_work24_rpa(task, user_info)  # 인증수단(auth_provider) 포함


async def _run_journey(jid, user_info, profile):
    from rpa.manager import RPATask, _rpa_tasks
    from rpa.apply_rpa import run_apply_rpa
    j = _journeys[jid]
    j["status"] = "running"
    user_name = j["user_name"]

    from rpa.manager import queued_slot, _TASK_TIMEOUT
    for step in j["steps"]:
        j["current"] = step["name"]
        step["status"] = "running"
        task = RPATask(uuid.uuid4().hex, step["name"], user_name)
        step["task_id"] = task.task_id
        _rpa_tasks[task.task_id] = task
        try:
            # 전체 동시성(_MAX_CONCURRENT)을 넘지 않도록 슬롯을 거치고, 멈춘 단계는 타임아웃으로 종료.
            # queued_slot: 슬롯 대기 중에도 _waiting 에 잡혀 can_accept() 백프레셔가 여정을 인지한다.
            async with queued_slot():
                if step["kind"] == "doc":
                    await asyncio.wait_for(_run_step_doc(task, step["name"], user_info), timeout=_TASK_TIMEOUT)
                    saved = (task.result or {}).get("saved_path")
                    step["saved_path"] = saved
                    if saved:
                        j["saved_docs"].append(saved)
                else:  # apply
                    await asyncio.wait_for(run_apply_rpa(task, step["name"], {**profile, **user_info}), timeout=_TASK_TIMEOUT)
            step["status"] = task.status if task.status in ("done", "error", "completed") else "done"
        except asyncio.TimeoutError:
            step["status"] = "error"
            step["error"] = "시간 초과로 이 단계를 종료했어요."
        except Exception as e:
            step["status"] = "error"
            step["error"] = str(e)[:200]
        finally:
            _rpa_tasks[task.task_id] = task.to_dict()
            j["done_count"] += 1

    j["current"] = None
    # 하나라도 성공(done/completed)이면 완료, 전부 실패면 error
    ok = any(s["status"] in ("done", "completed") for s in j["steps"])
    j["status"] = "completed" if (ok or not j["steps"]) else "error"
