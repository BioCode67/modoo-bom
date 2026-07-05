# -*- coding: utf-8 -*-
"""보안 회귀 테스트 — 출시 대비(감사 반영).

저장형 XSS/문서위조 차단, 관리자 엔드포인트 무인증 노출 차단을 고정한다."""
import os
import pytest
from fastapi import HTTPException

from mocks.document_generator import generate_document, _safe_name
from api.routes import require_admin


def test_safe_name_strips_script():
    # 스크립트/태그 주입 문자가 제거되고, 원본 이름은 보존된다.
    assert "<script" not in _safe_name("<script>alert(1)</script>")
    assert "홍길동" == _safe_name("홍길동")
    assert _safe_name("김<b>철수") == "김b철수"  # 태그 문자 제거
    assert _safe_name("") == "홍길동"  # 빈값 폴백


def test_issued_document_has_no_injected_script():
    html = generate_document("주민등록등본", "<script>fetch('//evil')</script>")
    assert html is not None
    assert "<script>fetch" not in html  # 원문 스크립트가 그대로 들어가지 않음
    assert "<script>" not in html.split("</head>")[-1]  # 본문에 주입 스크립트 없음


def test_admin_disabled_when_no_token(monkeypatch):
    # ADMIN_TOKEN 미설정이면 관리자 엔드포인트는 존재하지 않는 것처럼 404(무인증 노출 차단).
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    with pytest.raises(HTTPException) as ei:
        require_admin("")
    assert ei.value.status_code == 404


def test_admin_requires_matching_token(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret123")
    with pytest.raises(HTTPException) as ei:
        require_admin("wrong")
    assert ei.value.status_code == 401
    assert require_admin("secret123") is True


def test_rate_limit_targets_expensive_endpoints_only():
    from api.rate_limit import _limit_for
    assert _limit_for("/api/search") == 40
    assert _limit_for("/api/estimate") == 40
    assert _limit_for("/api/health") is None  # 헬스체크는 제한 없음
    assert _limit_for("/api/documents/rpa-issue") == 10


def test_search_request_bounds_n_results():
    from api.routes import SearchRequest
    from pydantic import ValidationError
    assert SearchRequest(query="노인").n_results == 5
    with pytest.raises(ValidationError):
        SearchRequest(query="노인", n_results=100000)  # 상한 초과 거부
    with pytest.raises(ValidationError):
        SearchRequest(query="")  # 빈 질의 거부
