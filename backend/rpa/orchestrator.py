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

# 타임아웃 후 20초 안에 정리되지 않은 단계 코루틴(orphan)의 강한참조 — GC 로 사라져 경고나 미정리
#   되지 않도록 붙잡아 두되, 슬롯은 이미 반납된 상태(감사 :190 슬롯 누수 방지 패턴, _guarded_run 과 동일).
_orphans: set = set()


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
    # 현재 실행 중인 단계의 RPA 태스크에 취소 전파 — 단계 이름은 중복될 수 있어(같은 서류 재시도 등)
    #   task_id 로 '지금 도는' 단계를 정확히 지목한다(이름 매칭은 동명 단계 오취소 위험, 감사 LOW).
    tid = j.get("current_task_id")
    if tid:
        request_cancel(tid)
    return True


def request_journey_skip(journey_id: str) -> bool:
    """진행 중 여정의 '현재 단계만' 건너뛰기 — 이 단계 RPA를 취소하되 여정은 다음 단계로 계속.

    전체 중단(request_journey_cancel)과 달리 cancel_requested 를 세우지 않는다.
    skip_step_task_id 에 '지금 도는' 단계의 task_id 를 기록해, 루프의 취소 예외 처리가
    (동명 단계·이후 단계 오스킵 없이) 이 취소가 '건너뛰기'였음을 식별한다. 반환: 요청 수락 여부."""
    from rpa.manager import request_cancel
    j = _journeys.get(journey_id)
    if j is None or j.get("status") in _JOURNEY_TERMINAL:
        return False
    tid = j.get("current_task_id")
    if not tid:
        return False  # 단계 시작 전(다음 단계 준비 중) — 건너뛸 '현재 단계'가 없다
    j["skip_step_task_id"] = tid
    ok = request_cancel(tid)
    if not ok:
        j["skip_step_task_id"] = None  # 이미 종결된 단계 — 스킵 플래그가 다음 단계를 오염하지 않게 회수
    return ok


def _consume_skip(j, task) -> bool:
    """이 단계의 취소가 '건너뛰기' 요청이었는지 확인하고 플래그를 소모한다(단계 task_id 일치 시에만)."""
    if j.get("skip_step_task_id") == task.task_id:
        j["skip_step_task_id"] = None
        return True
    return False


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
    from rpa.apply_rpa import SERVICE_APPLY_URLS, _valid_bokjiro_url
    docs = [d for d in (doc_names or []) if d in SUPPORTED_DOC_NAMES]
    # 서비스 수락 기준을 단건 신청(apply_start)과 정합화 — 하드코딩 6종만 받으면 청년월세지원처럼
    # 실측 검증 딥링크(SERVICE_APPLY_URLS)가 있는 서비스가 여정에서 조용히 탈락해 '발급→신청' 연쇄가 끊긴다.
    svcs = [s for s in (service_names or []) if s in SUPPORTED_SERVICE_NAMES or s in SERVICE_APPLY_URLS]
    # 그 밖의 서비스는 '단일 서비스 + 검증된 복지로 딥링크(profile.apply_url)'일 때만 일반화 수락 —
    # 여러 서비스에 같은 apply_url이 잘못 재사용되는 것 방지(resolve_apply_url 주의사항과 동일).
    if not svcs and service_names and len(service_names) == 1:
        cand = (profile or {}).get("apply_url") or (profile or {}).get("applyUrl")
        if _valid_bokjiro_url(cand):
            svcs = [service_names[0]]
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
            j["current_task_id"] = task.task_id  # 하드취소가 '지금 도는' 단계를 정확히 지목하도록(동명 단계 오취소 방지)
            _rpa_tasks[task.task_id] = task
            register_live(task)  # 여정 단계도 [중단] 대상으로 등록(_guarded_run 밖 실행이라 수동 등록)
            # 여정이 이미 취소 요청됐다면 방금 만든 task 에도 즉시 전파
            if j.get("cancel_requested"):
                task.cancel_requested = True
            inner = None
            try:
                # 슬롯 대기를 '관측 가능'하게 — 무기한 침묵 대기(감사 :132) 대신 대기 중임을 표시.
                #   queued_slot: 슬롯 대기 동안 _waiting 을 올려 can_accept() 백프레셔가 여정을 인지.
                task.update("queued", "대기열에서 차례를 기다리는 중… (다른 작업이 끝나면 시작해요)")
                task._guard_handle = asyncio.current_task()  # 큐 대기 중 하드취소 대상(슬롯 대기를 끊음)
                async with queued_slot():
                    if task.cancel_requested:
                        # 슬롯 대기 중 취소 — 건너뛰기면 이 단계만 접고 계속, 아니면 여정 전체 중단
                        if _consume_skip(j, task):
                            task.update("cancelled", "이 단계를 건너뛰었어요 — 다음 단계로 진행해요.")
                        else:
                            cancelled = True
                            j["cancel_requested"] = True
                            task.update("cancelled", "여정을 중단했어요.")
                    else:
                        coro = (_run_step_doc(task, step["name"], user_info) if step["kind"] == "doc"
                                else run_apply_rpa(task, step["name"], {**profile, **user_info}))
                        # ⚠️ wait_for 대신 asyncio.wait — 타임아웃 시 내부 취소 정리를 '무한' 기다리다 슬롯을
                        #   영구 누수하던 결함(감사 :190, _guarded_run 과 동일 패턴) 회피. inner 를 _run_handle
                        #   로 노출해 request_cancel 하드취소가 이 단계를 직접 취소할 수 있게 한다.
                        inner = asyncio.ensure_future(coro)
                        task._run_handle = inner
                        done, pending = await asyncio.wait({inner}, timeout=_TASK_TIMEOUT)
                        if pending:
                            inner.cancel()
                            await asyncio.wait({inner}, timeout=20)  # 정리는 최대 20초만 기다리고 슬롯 반납
                            raise asyncio.TimeoutError
                        if inner.cancelled():
                            raise asyncio.CancelledError
                        exc = inner.exception()
                        if exc is not None:
                            raise exc
            except asyncio.TimeoutError:
                # 이미 발급 완료(done)를 타임아웃이 error 로 덮지 않도록 finally 에서 실제 결과로 재조정(감사 :142)
                if task.status not in ("done", "completed") and not (task.result or {}).get("saved_path"):
                    task.update("error", "시간 초과로 이 단계를 종료했어요.")
            except asyncio.CancelledError:
                # 하드취소(request_cancel 유예 취소) — 건너뛰기면 이 단계만, 아니면 여정 전체 중단
                if _consume_skip(j, task):
                    if task.status not in ("done", "completed"):
                        task.update("cancelled", "이 단계를 건너뛰었어요 — 다음 단계로 진행해요.")
                else:
                    cancelled = True
                    j["cancel_requested"] = True
                    if task.status not in ("done", "completed"):
                        task.update("cancelled", "자동화를 중단했어요.")
            except CancelledByUser:
                # 협조적 취소(러너 대기 틱) — 건너뛰기 요청이면 이 단계만 접고 다음 단계로(감사 :123)
                if _consume_skip(j, task):
                    if task.status not in ("done", "completed"):
                        task.update("cancelled", "이 단계를 건너뛰었어요 — 다음 단계로 진행해요.")
                else:
                    cancelled = True
                    j["cancel_requested"] = True
                    if task.status not in ("done", "completed"):
                        task.update("cancelled", "여정을 중단했어요.")
            except Exception as e:
                if task.status not in ("done", "completed"):
                    task.update("error", str(e)[:200])
            finally:
                # 정리가 20초 안에 안 끝난 orphan inner 는 백그라운드로 흘려보내되(강한참조 유지) 슬롯은 반납
                if inner is not None and not inner.done():
                    _orphans.add(inner)
                    inner.add_done_callback(_orphans.discard)
                task._run_handle = None
                task._guard_handle = None
                # 실제 task 결과로 단계를 확정 — 타임아웃/예외가 done+saved_path 를 유실시키지 않게(감사 :142)
                r = task.result or {}
                saved = r.get("saved_path")
                if step["kind"] == "doc" and saved and saved not in j["saved_docs"]:
                    step["saved_path"] = saved
                    j["saved_docs"].append(saved)
                # 단계의 '진짜 성공' 여부 — status 는 미발급도 done(⚠️)일 수 있어 result.success 로 판정(감사 :226)
                step["success"] = bool(r.get("success"))
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
        j["current_task_id"] = None
        # ⚠️ 여정 성공은 '단계 status=done' 이 아니라 '단계의 진짜 성공(result.success)' 으로 판정 —
        #   미발급인데 done(⚠️)으로 끝난 단계까지 '완료'로 세던 오보(감사 :226) 방지.
        ok = any(s.get("success") for s in j["steps"])
        if cancelled or j.get("cancel_requested"):
            j["status"] = "cancelled" if not ok else "completed"
        else:
            j["status"] = "completed" if (ok or not j["steps"]) else "error"
