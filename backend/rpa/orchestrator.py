"""복지 여정 오케스트레이션 — 여러 서류 발급 RPA + 복지 신청을 '순차'로 실행하고
진행상황을 하나로 합산한다. (사용자는 각 사이트에서 카카오 본인인증만; 나머지는 자동)

- 서류(doc): gov24 / nhis / work24 RPA 로 발급 후 PDF 자동 저장
- 신청(apply): 복지로 RPA 로 양식 자동작성 (최종 제출은 사용자 승인)
"""
import asyncio
import uuid
from datetime import datetime

# journey_id -> journey dict
_journeys: dict = {}


def get_journey(journey_id: str):
    return _journeys.get(journey_id)


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
    }
    return jid


def start_journey(doc_names, service_names, user_name, user_info, profile) -> str:
    """지원되는 서류/서비스만 골라 여정을 시작하고 journey_id 반환."""
    from rpa.manager import SUPPORTED_DOC_NAMES, SUPPORTED_SERVICE_NAMES
    docs = [d for d in (doc_names or []) if d in SUPPORTED_DOC_NAMES]
    svcs = [s for s in (service_names or []) if s in SUPPORTED_SERVICE_NAMES]
    jid = _new_journey(docs, svcs, user_name)
    # 강한 참조 보관(_spawn_bg)로 GC가 실행 중 여정을 취소하지 못하게 한다.
    from rpa.manager import _spawn_bg
    _spawn_bg(_run_journey(jid, user_info or {}, profile or {}))
    return jid


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
        await run_work24_rpa(task)


async def _run_journey(jid, user_info, profile):
    from rpa.manager import RPATask, _rpa_tasks
    from rpa.apply_rpa import run_apply_rpa
    j = _journeys[jid]
    j["status"] = "running"
    user_name = j["user_name"]

    from rpa.manager import rpa_slot, _TASK_TIMEOUT
    for step in j["steps"]:
        j["current"] = step["name"]
        step["status"] = "running"
        task = RPATask(uuid.uuid4().hex, step["name"], user_name)
        step["task_id"] = task.task_id
        _rpa_tasks[task.task_id] = task
        try:
            # 전체 동시성(_MAX_CONCURRENT)을 넘지 않도록 슬롯을 거치고, 멈춘 단계는 타임아웃으로 종료
            async with rpa_slot():
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
