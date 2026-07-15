"""복지 여정 오케스트레이션 — 여러 서류 발급 RPA + 복지 신청을 '순차'로 실행하고
진행상황을 하나로 합산한다. (사용자는 각 사이트에서 카카오 본인인증만; 나머지는 자동)

- 서류(doc): gov24 / nhis / work24 RPA 로 발급 후 PDF 자동 저장
- 신청(apply): 복지로 RPA 로 양식 자동작성 (최종 제출은 사용자 승인)
"""
import asyncio
import os
import secrets
import uuid
from datetime import datetime

# journey_id -> journey dict
_journeys: dict = {}
_MAX_JOURNEYS = max(20, int(os.getenv("RPA_MAX_JOURNEYS", "50")))  # 저장소 상한(좀비 누적 방지)
_JOURNEY_TERMINAL = ("completed", "error", "cancelled")


def _evict_journeys() -> None:
    """상한 초과 시 '끝난' 여정 중 가장 오래된 것부터 제거 — 장기 구동 데스크탑 에이전트의
    좀비 여정 무한 누적(감사 :13) 방지. 진행 중 여정은 절대 지우지 않는다(폴링 404 방지)."""
    if len(_journeys) <= _MAX_JOURNEYS:
        return
    removable = [(k, v) for k, v in _journeys.items() if v.get("status") in _JOURNEY_TERMINAL]
    excess = len(_journeys) - _MAX_JOURNEYS
    for k, _ in sorted(removable, key=lambda kv: kv[1].get("created_at", ""))[:excess]:
        _journeys.pop(k, None)


def request_journey_cancel(journey_id: str) -> bool:
    """진행 중 여정을 중단 요청 — 현재 단계 RPA에 취소를 전파(다음 단계 브라우저가 안 뜨게)하고,
    여정 루프가 다음 단계로 넘어가지 않게 플래그를 세운다(감사 :123). 반환: 요청 수락 여부."""
    from rpa.manager import get_task, request_cancel
    j = _journeys.get(journey_id)
    if j is None or j.get("status") in _JOURNEY_TERMINAL:
        return False
    j["cancel_requested"] = True
    # 현재 실행 중인 단계의 RPA 태스크에도 취소 전파(대기 루프가 CancelledByUser 로 빠져나옴)
    cur = j.get("current")
    for step in j.get("steps", []):
        if step.get("name") == cur and step.get("task_id"):
            request_cancel(step["task_id"])
            break
    return True


def active_journey_id():
    """진행 중(pending/running)인 여정 id 하나 반환(없으면 None) — 재클릭 중복시작 가드용(감사 :374)."""
    for jid, j in _journeys.items():
        if j.get("status") in ("pending", "running"):
            return jid
    return None


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
        "cancel_requested": False,
        "steps": steps,
        "total": len(steps),
        "done_count": 0,
        "saved_docs": [],
        "created_at": datetime.now().isoformat(),
        "download_token": secrets.token_urlsafe(18),  # 스크린샷·실명·경로 열람 인가(시작자에게만 반환)
    }
    _evict_journeys()  # 상한 초과 시 끝난 여정 퇴거(좀비 누적 방지)
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
    from rpa.manager import RPATask, _rpa_tasks, register_live, unregister_live
    from rpa.apply_rpa import run_apply_rpa
    from rpa.base import CancelledByUser
    j = _journeys[jid]
    j["status"] = "running"
    user_name = j["user_name"]
    cancelled = False

    from rpa.manager import queued_slot, _TASK_TIMEOUT
    try:
        for step in j["steps"]:
            # 여정 중단 요청 시 남은 단계는 시작하지 않는다(다음 단계 브라우저가 안 뜨게 — 감사 :123)
            if j.get("cancel_requested"):
                cancelled = True
                step["status"] = "cancelled"
                j["done_count"] += 1
                continue

            j["current"] = step["name"]
            step["status"] = "running"
            task = RPATask(uuid.uuid4().hex, step["name"], user_name)
            step["task_id"] = task.task_id
            _rpa_tasks[task.task_id] = task
            register_live(task)  # 여정 단계도 [중단] 대상으로 등록(_guarded_run 밖 실행이라 수동 등록)
            # 여정이 이미 취소 요청됐다면 방금 만든 task 에도 즉시 전파
            if j.get("cancel_requested"):
                task.cancel_requested = True
            try:
                # 슬롯 대기를 '관측 가능'하게 — 무기한 침묵 대기(감사 :132) 대신 대기 중임을 표시.
                #   queued_slot: 슬롯 대기 동안 _waiting 을 올려 can_accept() 백프레셔가 여정을 인지.
                task.update("queued", "대기열에서 차례를 기다리는 중… (다른 작업이 끝나면 시작해요)")
                async with queued_slot():
                    if step["kind"] == "doc":
                        await asyncio.wait_for(_run_step_doc(task, step["name"], user_info), timeout=_TASK_TIMEOUT)
                    else:  # apply
                        await asyncio.wait_for(run_apply_rpa(task, step["name"], {**profile, **user_info}), timeout=_TASK_TIMEOUT)
            except asyncio.TimeoutError:
                # 이미 발급 완료(done)를 타임아웃이 error 로 덮지 않도록 finally 에서 실제 결과로 재조정(감사 :142)
                if task.status not in ("done", "completed") and not (task.result or {}).get("saved_path"):
                    task.update("error", "시간 초과로 이 단계를 종료했어요.")
            except CancelledByUser:
                # 사용자가 여정/창을 닫음 — 이 단계와 여정을 중단으로 종결(감사 :123)
                cancelled = True
                j["cancel_requested"] = True
                if task.status not in ("done", "completed"):
                    task.update("cancelled", "여정을 중단했어요.")
            except Exception as e:
                if task.status not in ("done", "completed"):
                    task.update("error", str(e)[:200])
            finally:
                # 실제 task 결과로 단계를 확정 — 타임아웃/예외가 done+saved_path 를 유실시키지 않게(감사 :142)
                r = task.result or {}
                saved = r.get("saved_path")
                if step["kind"] == "doc" and saved and saved not in j["saved_docs"]:
                    step["saved_path"] = saved
                    j["saved_docs"].append(saved)
                st = task.status
                if st in ("done", "completed", "error", "cancelled"):
                    step["status"] = st
                else:
                    step["status"] = "done" if saved else "error"
                if step["status"] == "error" and not step.get("error"):
                    step["error"] = (task.current_step or "이 단계를 완료하지 못했어요.")[:200]
                unregister_live(task.task_id)  # 취소 레지스트리 정리
                _rpa_tasks[task.task_id] = task.to_dict()  # 항상 종결 스냅샷(비종결 좀비 레코드 방지)
                j["done_count"] += 1
    finally:
        # 코루틴이 어떻게 끝나든(정상·취소·예외) 여정은 반드시 종결 상태로 — 영구 'running' 좀비 방지(감사 :119)
        j["current"] = None
        ok = any(s["status"] in ("done", "completed") for s in j["steps"])
        if cancelled or j.get("cancel_requested"):
            j["status"] = "cancelled" if not ok else "completed"
        else:
            j["status"] = "completed" if (ok or not j["steps"]) else "error"
