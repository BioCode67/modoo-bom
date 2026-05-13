"""정부24 API Mock — 주민등록등본 자동 발급 시뮬레이션"""
import asyncio
import random
import uuid
from datetime import datetime
from mocks.document_generator import generate_document

# receipt_number → HTML 문서 내용 저장소
_doc_store = {}  # dict[str, str]


_DOCUMENT_TEMPLATES = {
    "주민등록등본": {
        "doc_type": "주민등록등본",
        "issuing_org": "정부24 (행정안전부)",
        "description": "주민등록법에 따른 주민등록표 등본",
        "validity_days": 90,
        "issue_method": "정부24 공식 REST API",
    },
    "주민등록초본": {
        "doc_type": "주민등록초본",
        "issuing_org": "정부24 (행정안전부)",
        "description": "주민등록법에 따른 주민등록표 초본",
        "validity_days": 90,
        "issue_method": "정부24 공식 REST API",
    },
    "가족관계증명서": {
        "doc_type": "가족관계증명서",
        "issuing_org": "대법원 전자가족관계등록시스템",
        "description": "가족관계의 등록 등에 관한 법률에 따른 가족관계증명서",
        "validity_days": 90,
        "issue_method": "정부24 API 연계",
    },
    "건강보험 자격득실확인서": {
        "doc_type": "건강보험 자격득실확인서",
        "issuing_org": "국민건강보험공단",
        "description": "건강보험 가입자격 및 보험료 납부 이력 확인서",
        "validity_days": 30,
        "issue_method": "Mock (실제: 공단 온라인 발급)",
    },
    "고용보험 피보험자격 이력내역서": {
        "doc_type": "고용보험 피보험자격 이력내역서",
        "issuing_org": "고용노동부 고용24",
        "description": "고용보험 가입이력 및 피보험기간 확인서",
        "validity_days": 30,
        "issue_method": "Mock (실제: 고용24 온라인 발급)",
    },
}

# 가끔 발급 실패를 시뮬레이션하는 문서
_SOMETIMES_FAIL = {"건강보험 자격득실확인서", "고용보험 피보험자격 이력내역서"}


async def issue_document(doc_name: str, user_name: str = "홍길동") -> dict:
    """
    정부24 API Mock — 서류 발급 시뮬레이션.
    실제 구현에서는 정부24 REST API / Playwright RPA 사용.
    """
    await asyncio.sleep(random.uniform(0.5, 1.5))  # 네트워크 지연 시뮬레이션

    template = _DOCUMENT_TEMPLATES.get(doc_name)
    if not template:
        return {
            "success": False,
            "doc_name": doc_name,
            "error": "지원하지 않는 서류 유형",
        }

    # 일부 서류 발급 실패 시뮬레이션 (10% 확률)
    if doc_name in _SOMETIMES_FAIL and random.random() < 0.1:
        return {
            "success": False,
            "doc_name": doc_name,
            "error": "인증 세션 만료 — 사용자 재인증 필요",
            "fallback_url": f"https://www.gov.kr/search/document/{doc_name}",
        }

    issued_at = datetime.now().isoformat()
    receipt_number = f"GOV24-{uuid.uuid4().hex[:8].upper()}"

    # HTML 문서 생성 및 저장
    html_content = generate_document(doc_name, user_name)
    preview_url = None
    if html_content:
        _doc_store[receipt_number] = html_content
        preview_url = f"/api/documents/view/{receipt_number}"

    return {
        "success": True,
        "doc_name": doc_name,
        "receipt_number": receipt_number,
        "issued_for": user_name,
        "issued_at": issued_at,
        **template,
        "preview_url": preview_url,
        "download_url": f"/api/documents/download/{uuid.uuid4().hex}",
        "memo": "Mock 발급 — 실제 서비스에서는 정부24 공식 API 연동",
    }


async def issue_documents_batch(doc_names: list[str], user_name: str = "홍길동") -> list[dict]:
    """여러 서류를 병렬 발급"""
    tasks = [issue_document(name, user_name) for name in doc_names]
    results = await asyncio.gather(*tasks)
    return list(results)
