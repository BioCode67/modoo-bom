"""FastAPI REST 라우터"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from rag.search import search_policies
from rag.embedder import seed_chromadb
from mocks.gov24_api import issue_document, _doc_store
from agents.mock_responses import is_mock_mode

router = APIRouter(prefix="/api")


class SearchRequest(BaseModel):
    query: str
    n_results: int = 5


class DocRequest(BaseModel):
    doc_name: str
    user_name: str = "홍길동"
    birth_date: str = ""   # YYYYMMDD 또는 YYYY-MM-DD
    phone: str = ""        # 01012345678 또는 010-1234-5678
    carrier: str = ""      # SKT / KT / LGU+ / SKM / KTM / LGM


@router.get("/health")
async def health():
    """서버 상태 + 환경 정보 + capabilities(프론트 게이팅용) 반환.

    capabilities.ai  — AI provider 사용 가능(분석/추천/챗봇 활성)
    capabilities.rpa — 이 백엔드에서 실제 RPA 실행 가능(로컬 에이전트일 때만 true)
    프론트는 rpa=true일 때만 '자동발급/자동신청' 버튼을 노출한다(클라우드 오표시 방지).
    """
    from rag.search import rag_light, backend_label
    from rpa.config import rpa_enabled
    from agents.llm import active_provider, provider_label

    doc_count, chroma_ok = 0, False
    if not rag_light():
        try:
            from rag.chromadb_client import get_collection
            col = get_collection()
            doc_count = col.count()
            chroma_ok = True
        except Exception:
            chroma_ok = False
    else:
        try:
            from rag.catalog_loader import load_catalog
            doc_count = len(load_catalog())
            chroma_ok = True
        except Exception:
            chroma_ok = False

    ai_ok = active_provider() is not None
    return {
        "status": "ok",
        "service": "ModooBom API",
        "version": "0.3.0",
        "mode": "production" if ai_ok else "rule-based",
        "capabilities": {
            "ai": ai_ok,
            "rpa": rpa_enabled(),
            "ai_provider": provider_label(),
            "rag": backend_label(),
        },
        "rag": {
            "ok": chroma_ok,
            "document_count": doc_count,
            "seeded": doc_count >= 60,
        },
    }


@router.get("/health/ready")
async def readiness():
    """Kubernetes-style readiness probe"""
    return {"ready": True}


@router.post("/search")
async def search(req: SearchRequest):
    if is_mock_mode():
        # Mock 검색: 샘플 데이터에서 키워드 매칭
        from rag.sample_data import WELFARE_POLICIES
        results = [
            {**p, "similarity_score": 0.85, "document": p["eligibility"]}
            for p in WELFARE_POLICIES
            if req.query.lower() in (p["name"] + p["category"] + p["target"]).lower()
        ][:req.n_results] or [
            {**p, "similarity_score": 0.70, "document": p["eligibility"]}
            for p in WELFARE_POLICIES[:req.n_results]
        ]
        return {"policies": results, "count": len(results), "mode": "mock"}

    results = search_policies(req.query, req.n_results)
    return {"policies": results, "count": len(results), "mode": "production"}


@router.post("/documents/issue")
async def issue_doc(req: DocRequest):
    result = await issue_document(req.doc_name, req.user_name)
    return result


@router.get("/documents/view/{receipt_number}", response_class=HTMLResponse)
async def view_document(receipt_number: str):
    """발급된 Mock 서류를 HTML로 반환 (브라우저에서 직접 열기 / 인쇄)"""
    html = _doc_store.get(receipt_number)
    if not html:
        raise HTTPException(status_code=404, detail="서류를 찾을 수 없습니다. (만료되었거나 존재하지 않는 접수번호)")
    return HTMLResponse(content=html)


@router.post("/admin/seed")
async def seed_data():
    """ChromaDB 샘플 데이터 임베딩 (초기화용). Mock 모드에서는 스킵."""
    if is_mock_mode():
        return {"message": "Mock 모드 — 시딩 스킵", "mode": "mock", "count": 0}
    count = seed_chromadb()
    return {"message": f"{count}건 임베딩 완료", "mode": "production", "count": count}


@router.get("/admin/status")
async def db_status():
    from rag.chromadb_client import get_collection
    try:
        col = get_collection()
        return {
            "collection": "welfare_policies",
            "document_count": col.count(),
            "mode": "mock" if is_mock_mode() else "production",
        }
    except Exception as e:
        return {"error": str(e), "document_count": 0}


@router.get("/documents/rpa-supported")
async def rpa_supported_docs():
    """RPA 지원 서류 목록 반환"""
    from rpa.manager import SUPPORTED_DOC_NAMES
    return {"supported": SUPPORTED_DOC_NAMES}


@router.post("/documents/rpa-issue")
async def rpa_issue(req: DocRequest):
    """
    실제 브라우저 자동화로 서류 발급 시작.
    지원: 주민등록등본, 주민등록초본, 건강보험 자격득실확인서, 고용보험 피보험자격 이력내역서
    """
    from rpa.manager import start_rpa_task, SUPPORTED_DOC_NAMES
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if req.doc_name not in SUPPORTED_DOC_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 서류: {req.doc_name}\n지원 목록: {', '.join(SUPPORTED_DOC_NAMES)}",
        )
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date, "phone": req.phone, "carrier": req.carrier}
    task_id = start_rpa_task(req.doc_name, req.user_name, user_info)
    return {"task_id": task_id, "status": "started", "doc_name": req.doc_name}


@router.get("/documents/rpa-status/{task_id}")
async def rpa_status(task_id: str):
    """RPA 태스크 현재 상태 조회"""
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    if hasattr(task, "to_dict"):
        return task.to_dict()
    return task


class ApplyRequest(BaseModel):
    service_name: str
    user_name: str = "홍길동"
    profile: dict = {}


@router.get("/apply/supported")
async def apply_supported():
    """복지 신청 자동화 지원 서비스 목록"""
    from rpa.manager import SUPPORTED_SERVICE_NAMES
    return {"supported": SUPPORTED_SERVICE_NAMES}


@router.post("/apply/start")
async def apply_start(req: ApplyRequest):
    """복지 서비스 신청 RPA 시작"""
    from rpa.manager import start_apply_task, SUPPORTED_SERVICE_NAMES
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if req.service_name not in SUPPORTED_SERVICE_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 서비스: {req.service_name}\n지원 목록: {', '.join(SUPPORTED_SERVICE_NAMES)}",
        )
    task_id = start_apply_task(req.service_name, req.user_name, req.profile)
    return {"task_id": task_id, "status": "started", "service_name": req.service_name}


@router.get("/apply/status/{task_id}")
async def apply_status(task_id: str):
    """신청 RPA 태스크 상태 조회"""
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    if hasattr(task, "to_dict"):
        return task.to_dict()
    return task


class EstimateRequest(BaseModel):
    age: int = 0
    income_percentile: int = 100
    disability: bool = False
    disability_grade: str = ""
    has_children: bool = False
    children_ages: list[int] = []
    is_pregnant: bool = False
    household_type: str = ""
    employment_status: str = ""
    region: str = ""


@router.post("/estimate")
async def estimate_benefits(req: EstimateRequest):
    """프로필 기반 빠른 복지 혜택 금액 추정 (AI 없이 즉시 반환)"""
    from types import SimpleNamespace
    from rag.sample_data import WELFARE_POLICIES
    from agents.mock_responses import _check_policy

    profile = SimpleNamespace(
        age=req.age,
        income_percentile=req.income_percentile,
        disability=req.disability,
        disability_grade=req.disability_grade,
        has_children=req.has_children,
        children_ages=req.children_ages,
        is_pregnant=req.is_pregnant,
        household_type=req.household_type,
        employment_status=req.employment_status,
        region=req.region,
        name="사용자",
        gender="other",
        life_events=[],
    )

    eligible = []
    for policy in WELFARE_POLICIES:
        doc_text = (policy.get("document", "") + " " + policy.get("eligibility", "") +
                    " " + policy.get("target", ""))
        eligible_flag, reason, priority, confidence = _check_policy(
            doc_text, policy["name"], policy["id"], profile
        )
        if eligible_flag:
            eligible.append({
                "id": policy["id"],
                "name": policy["name"],
                "category": policy["category"],
                "reason": reason,
                "priority": priority,
                "confidence": confidence,
            })

    # ⚠️ 정렬 후 상위 10건 — 카탈로그 순서로 자르면 중요한 high 정책이 잘려나갈 수 있었음(프론트와 동일 정렬)
    _rank = {"high": 3, "medium": 2, "low": 1}
    eligible.sort(key=lambda e: (_rank.get(e["priority"], 0), e.get("confidence", 0)), reverse=True)

    return {
        "eligible_count": len(eligible),
        "policies": eligible[:10],
    }


@router.post("/journey/plan")
async def journey_plan(req: EstimateRequest):
    """AI 에이전트 '복지 여정' 계획 — 프로필 → 수혜 정책 → 발급할 서류 + 신청할 서비스(자동화 지원 표시) + 실행 순서.
    프론트/에이전트가 이 계획을 받아 서류 발급 RPA → 신청 RPA 를 순차 오케스트레이션한다."""
    from types import SimpleNamespace
    from rag.sample_data import WELFARE_POLICIES
    from agents.mock_responses import _check_policy
    from rpa.manager import SUPPORTED_DOC_NAMES, SUPPORTED_SERVICE_NAMES

    profile = SimpleNamespace(
        age=req.age, income_percentile=req.income_percentile, disability=req.disability,
        disability_grade=req.disability_grade, has_children=req.has_children, children_ages=req.children_ages,
        is_pregnant=req.is_pregnant, household_type=req.household_type, employment_status=req.employment_status,
        region=req.region, name="사용자", gender="other", life_events=[],
    )

    eligible, doc_set = [], {}
    for policy in WELFARE_POLICIES:
        doc_text = policy.get("document", "") + " " + policy.get("eligibility", "") + " " + policy.get("target", "")
        ok, reason, priority, conf = _check_policy(doc_text, policy["name"], policy["id"], profile)
        if not ok:
            continue
        docs = policy.get("required_docs", []) or []
        eligible.append({
            "id": policy["id"], "name": policy["name"], "category": policy["category"],
            "priority": priority, "reason": reason, "required_docs": docs,
            "apply_automatable": policy["name"] in SUPPORTED_SERVICE_NAMES,
            "apply_link": policy.get("application", ""),
        })
        for d in docs:
            slot = doc_set.setdefault(d, {"doc_name": d, "rpa_supported": d in SUPPORTED_DOC_NAMES, "needed_for": []})
            slot["needed_for"].append(policy["name"])

    documents = sorted(doc_set.values(), key=lambda x: (not x["rpa_supported"], -len(x["needed_for"])))
    applications = [e for e in eligible if e["apply_automatable"]]
    steps = (
        [{"phase": "서류발급", "auto": d["rpa_supported"], "label": f"{d['doc_name']} 발급",
          "detail": f"{len(d['needed_for'])}개 복지에 필요"} for d in documents]
        + [{"phase": "신청", "auto": True, "label": f"{a['name']} 온라인 신청", "detail": a["reason"]} for a in applications]
    )
    return {
        "eligible_count": len(eligible),
        "eligible_policies": eligible,
        "documents": documents,
        "applications": applications,
        "steps": steps,
        "auto_doc_count": sum(1 for d in documents if d["rpa_supported"]),
        "auto_apply_count": len(applications),
        "note": "카카오 본인인증(본인 휴대폰)과 신청 최종 제출 승인은 사용자가 직접 확인합니다.",
    }


class JourneyRunRequest(BaseModel):
    doc_names: list[str] = []
    service_names: list[str] = []
    user_name: str = "홍길동"
    birth_date: str = ""
    phone: str = ""
    carrier: str = ""
    profile: dict = {}


@router.post("/journey/run")
async def journey_run(req: JourneyRunRequest):
    """복지 여정 실행 — 지정된 서류들을 순차 발급(자동 저장)하고 신청까지 오케스트레이션.
    각 사이트에서 카카오 본인인증만 사용자가 하면 로그인·양식·발급·저장·신청은 자동."""
    from rpa.orchestrator import start_journey
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date,
                 "phone": req.phone, "carrier": req.carrier}
    jid = start_journey(req.doc_names, req.service_names, req.user_name, user_info, req.profile)
    return {"journey_id": jid, "status": "started",
            "docs": req.doc_names, "services": req.service_names}


@router.get("/journey/status/{journey_id}")
async def journey_status(journey_id: str):
    """여정 진행상황(단계별 상태 + 저장된 서류 경로) 조회."""
    from rpa.orchestrator import get_journey
    j = get_journey(journey_id)
    if j is None:
        raise HTTPException(status_code=404, detail="여정을 찾을 수 없습니다.")
    return j


@router.get("/admin/env")
async def env_check():
    """환경변수 상태 확인 (키 값은 마스킹)"""
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    claude_model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    return {
        "ANTHROPIC_API_KEY": f"{'set (' + anthropic_key[:10] + '...)' if anthropic_key else 'not set'}",
        "CLAUDE_MODEL": claude_model,
        "CHROMA_PERSIST_DIR": os.getenv("CHROMA_PERSIST_DIR", "./chroma_db"),
        "CORS_ORIGINS": os.getenv("CORS_ORIGINS", "http://localhost:5173"),
        "mock_mode": is_mock_mode(),
    }
