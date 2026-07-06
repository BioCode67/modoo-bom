"""FastAPI REST 라우터"""
import hmac
import os
from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
from rag.search import search_policies
from rag.embedder import seed_chromadb
from mocks.gov24_api import issue_document, _doc_store
from agents.mock_responses import is_mock_mode

router = APIRouter(prefix="/api")


def require_admin(x_admin_token: str = Header(default="")):
    """관리자 엔드포인트 보호 — ADMIN_TOKEN 환경변수와 일치하는 헤더만 허용.
    ADMIN_TOKEN 미설정(로컬 개발)이면 관리 기능을 아예 비활성화(공개 배포 시 무인증 노출 방지)."""
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=404, detail="Not found")  # 미설정 시 존재하지 않는 것처럼
    # 상수시간 비교(타이밍 사이드채널 방지) — 다운로드 토큰(compare_digest)과 일관.
    if not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=401, detail="관리자 인증이 필요합니다.")
    return True


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    n_results: int = Field(default=5, ge=1, le=50)  # 상한으로 과도한 조회 방지(감사 반영)


class DocRequest(BaseModel):
    doc_name: str
    user_name: str = "홍길동"
    birth_date: str = ""   # YYYYMMDD 또는 YYYY-MM-DD
    phone: str = ""        # 01012345678 또는 010-1234-5678
    carrier: str = ""      # SKT / KT / LGU+ / SKM / KTM / LGM
    sido: str = ""         # 주민등록상 시도(예: 경상북도) — 회원정보 주소와 다를 때 자동 정정용
    sigungu: str = ""      # 주민등록상 시군구(예: 경산시)


@router.get("/health")
async def health(debug: int = 0):
    """서버 상태 + 환경 정보 + capabilities(프론트 게이팅용) 반환.

    capabilities.ai  — AI provider 사용 가능(분석/추천/챗봇 활성)
    capabilities.rpa — 이 백엔드에서 실제 RPA 실행 가능(로컬 에이전트일 때만 true)
    프론트는 rpa=true일 때만 '자동발급/자동신청' 버튼을 노출한다(클라우드 오표시 방지).
    ?debug=1 이면 LLM 클라이언트가 실제로 빌드되는지 진단(패키지/버전 문제 확인용).
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

    # 전체 카탈로그 기대 건수 — 색인된 문서 수가 이에 근접해야 '제대로 시딩됨'으로 본다(감사 반영:
    # 과거 seeded=doc_count>=60은 sample 131건만 있어도 true라 5,061건 미색인을 못 잡았음).
    catalog_total = 0
    try:
        from rag.catalog_loader import load_catalog
        catalog_total = len(load_catalog())
    except Exception:
        pass
    # 상한(RAG_MAX_DOCS)이 있으면 기대 색인수는 min(전체, 상한). 그 80% 이상이면 시딩 정상으로 본다.
    _cap = int(os.getenv("RAG_MAX_DOCS", "0")) or None
    _expected = min(catalog_total, _cap) if (catalog_total and _cap) else catalog_total
    _seeded = doc_count >= max(60, int(_expected * 0.8)) if _expected else doc_count >= 60

    ai_ok = active_provider() is not None
    # RPA 처리 용량(다중 사용자 안전) — 프론트가 '지금 이용자 많음 → 무설치 안내' 폴백 판단에 사용
    rpa_capacity = None
    if rpa_enabled():
        try:
            from rpa.manager import capacity
            rpa_capacity = capacity()
        except Exception:
            rpa_capacity = None
    result = {
        "status": "ok",
        "service": "ModooBom API",
        "version": "0.3.0",
        "mode": "production" if ai_ok else "rule-based",
        "capabilities": {
            "ai": ai_ok,
            "rpa": rpa_enabled(),
            "rpa_capacity": rpa_capacity,
            "ai_provider": provider_label(),
            "rag": backend_label(),
        },
        "rag": {
            "ok": chroma_ok,
            "document_count": doc_count,
            "catalog_total": catalog_total,
            "seeded": _seeded,
        },
    }
    if debug:
        # LLM 클라이언트가 실제로 빌드되는지 + 핵심 패키지 버전(배포 진단용, 무비용 — 실제 호출은 안 함).
        info: dict = {}
        try:
            from agents.llm import get_chat_llm
            llm = get_chat_llm()
            info["llm_build"] = type(llm).__name__ if llm else None
        except Exception as e:  # noqa: BLE001
            info["llm_build_error"] = f"{type(e).__name__}: {e}"
        from importlib.metadata import version as _pkg_version, PackageNotFoundError
        for pkg in ("langchain_core", "langchain_google_genai", "langchain_groq", "langchain_anthropic"):
            # 일부 패키지(google_genai·anthropic)는 모듈 __version__를 노출하지 않아 "?"가 됐다.
            # 배포판 메타데이터(하이픈 이름)로 정확히 조회하고, 모듈 속성은 보조로만 사용.
            try:
                info[pkg] = _pkg_version(pkg.replace("_", "-"))
            except PackageNotFoundError:
                try:
                    info[pkg] = getattr(__import__(pkg), "__version__", "?")
                except Exception as e:  # noqa: BLE001
                    info[pkg] = f"import-fail: {type(e).__name__}"
        result["llm_debug"] = info
    return result


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
    """발급된 Mock 서류를 HTML로 반환 (브라우저에서 직접 열기 / 인쇄).
    사용자 입력(이름)은 생성 시점에 이미 정제되지만, 뷰 응답에도 강한 격리 헤더를 둔다:
    - CSP default-src 'none'(script 실행 원천 차단) + nosniff → 혹시 남은 주입도 무력화."""
    doc_html = _doc_store.get(receipt_number)
    if not doc_html:
        raise HTTPException(status_code=404, detail="서류를 찾을 수 없습니다. (만료되었거나 존재하지 않는 접수번호)")
    return HTMLResponse(content=doc_html, headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
    })


@router.post("/admin/seed")
async def seed_data(_: bool = Depends(require_admin)):
    """ChromaDB 샘플 데이터 임베딩 (초기화용). Mock 모드에서는 스킵. (관리자 토큰 필요)"""
    if is_mock_mode():
        return {"message": "Mock 모드 — 시딩 스킵", "mode": "mock", "count": 0}
    count = seed_chromadb()
    return {"message": f"{count}건 임베딩 완료", "mode": "production", "count": count}


@router.get("/admin/status")
async def db_status(_: bool = Depends(require_admin)):
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
    from rpa.manager import start_rpa_task, SUPPORTED_DOC_NAMES, can_accept
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동 발급 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 발급하실 수 있어요.")
    if req.doc_name not in SUPPORTED_DOC_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 서류: {req.doc_name}\n지원 목록: {', '.join(SUPPORTED_DOC_NAMES)}",
        )
    user_info = {"user_name": req.user_name, "birth_date": req.birth_date, "phone": req.phone,
                 "carrier": req.carrier, "sido": req.sido, "sigungu": req.sigungu}
    task_id = start_rpa_task(req.doc_name, req.user_name, user_info)
    # 다운로드 토큰은 '시작한 사람'에게만 여기서 반환(rpa-status엔 노출 안 함) → task_id 유출만으론 문서 못 받음
    from rpa.manager import get_task
    _t = get_task(task_id)
    token = getattr(_t, "download_token", "") if _t is not None and not isinstance(_t, dict) else (_t or {}).get("download_token", "")
    return {"task_id": task_id, "download_token": token, "status": "started", "doc_name": req.doc_name}


@router.get("/documents/rpa-status/{task_id}")
async def rpa_status(task_id: str):
    """RPA 태스크 현재 상태 조회. ⚠️ download_token은 응답에서 제거(파일 다운로드 인가 비밀 유출 방지)."""
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task.to_dict() if hasattr(task, "to_dict") else dict(task)
    d.pop("download_token", None)
    return d


@router.get("/documents/rpa-file/{task_id}")
async def rpa_file(task_id: str, t: str = ""):
    """RPA로 발급 완료된 문서(PDF/이미지)를 사용자 브라우저로 반환(다운로드).
    확장 없이 인증만 하면 '내 서류가 내 손에' 흐름을 완성한다 — 원격 사용자가 자기 문서를 받게 함.
    ⚠️ 개인 문서(주민번호 포함) 인가: 발급을 '시작한 사람'만 아는 download_token(?t=)이 일치해야 반환.
       task_id는 rpa-status URL·로그에 노출되므로 task_id만으로는 남의 문서를 받을 수 없다(다중 사용자 유출 차단).
       완료+저장된 태스크만, 저장 폴더 밖 경로 거절, 캐시 금지."""
    import hmac
    from rpa.manager import get_task
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    d = task if isinstance(task, dict) else task.to_dict()
    token = d.get("download_token") or ""
    if not t or not token or not hmac.compare_digest(str(t), str(token)):
        raise HTTPException(status_code=403, detail="다운로드 인가 토큰이 필요합니다.")
    result = d.get("result") or {}
    path = result.get("saved_path")
    if d.get("status") not in ("done", "completed") or not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="아직 발급이 완료되지 않았거나 저장된 문서가 없습니다.")
    # 경로 이탈 방지 — 저장 폴더(DOCS_DIR) 안의 파일만 허용
    from rpa.base import DOCS_DIR
    real = os.path.realpath(path)
    if os.path.commonpath([real, os.path.realpath(str(DOCS_DIR))]) != os.path.realpath(str(DOCS_DIR)):
        raise HTTPException(status_code=403, detail="허용되지 않은 파일 경로입니다.")
    media = "application/pdf" if real.lower().endswith(".pdf") else "image/png"
    return FileResponse(real, media_type=media, filename=os.path.basename(real), headers={
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    })


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
    from rpa.manager import start_apply_task, SUPPORTED_SERVICE_NAMES, can_accept
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동 신청 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 신청하실 수 있어요.")
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
    from rpa.manager import can_accept
    from rpa.config import rpa_enabled, rpa_disabled_reason
    if not rpa_enabled():
        raise HTTPException(status_code=503, detail=rpa_disabled_reason())
    if not can_accept():
        raise HTTPException(status_code=503, detail="지금 자동화 이용자가 많아요. 잠시 후 다시 시도하거나 공식 사이트에서 바로 진행하실 수 있어요.")
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
async def env_check(_: bool = Depends(require_admin)):
    """환경변수 상태 확인 (키 값은 노출하지 않고 set/not set 여부만). 관리자 토큰 필요."""
    try:
        from agents.llm import active_provider
        provider = active_provider() or "rule-based(mock)"
    except Exception:
        provider = "unknown"
    return {
        "active_provider": provider,  # 실제 사용 중인 제공자(Gemini/Groq/Anthropic/mock)
        "GEMINI_API_KEY": "set" if os.getenv("GEMINI_API_KEY") else "not set",
        "GROQ_API_KEY": "set" if os.getenv("GROQ_API_KEY") else "not set",
        "ANTHROPIC_API_KEY": "set" if os.getenv("ANTHROPIC_API_KEY") else "not set",
        "CHROMA_PERSIST_DIR": os.getenv("CHROMA_PERSIST_DIR", "./chroma_db"),
        "CORS_ORIGINS": os.getenv("CORS_ORIGINS", "http://localhost:5173"),
        "mock_mode": is_mock_mode(),
    }
