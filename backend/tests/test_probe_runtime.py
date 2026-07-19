# -*- coding: utf-8 -*-
"""앱 내 커버리지 실측([🔎 실측 확인]) — 런타임 리로드·API 계약.

날조 금지 계약을 테스트로 고정한다: ✅ 실측 통과만 등록, 실패·비대상은 그대로 보고(등록 0),
등록·해제는 재시작 없이 발급 코드맵(DOC_CAPP)·URL 3맵·지원목록(rpa-supported)에 반영.
"""
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def extra_sandbox(monkeypatch, tmp_path):
    """docs_extra.json 을 임시 파일로 격리 — 테스트 후 리로드로 원상복구(다른 테스트로 상태 누수 방지)."""
    from rpa import gov24_rpa, manager
    p = tmp_path / "docs_extra.json"
    monkeypatch.setattr(gov24_rpa, "_EXTRA_DOCS_PATH", p)
    monkeypatch.setenv("RPA_ENABLED", "1")
    yield p
    p.unlink(missing_ok=True)
    gov24_rpa.reload_extra_docs()
    manager.refresh_supported_docs()


def _write(p, name="혼인관계증명서", code="TESTCODE12"):
    p.write_text(json.dumps([{"name": name, "code": code, "enabled": True}], ensure_ascii=False), encoding="utf-8")


OK_ROW = {"name": "혼인관계증명서", "code": "TESTCODE12", "title": "혼인관계증명서 발급", "issue_btn": True,
          "verdict": "✅ 후보(코드·발급버튼 확인)", "note": ""}


def test_reload_adds_and_removes(extra_sandbox):
    """리로드 왕복 — 등록은 코드맵·URL 3맵·지원목록에 즉시, 해제도 즉시(내장 15종은 불변)."""
    from rpa import gov24_rpa, manager
    _write(extra_sandbox)
    assert gov24_rpa.reload_extra_docs() == ["혼인관계증명서"]
    assert gov24_rpa.DOC_CAPP["혼인관계증명서"] == "TESTCODE12"
    assert "TESTCODE12" in gov24_rpa.APPLY_FORM_URLS["혼인관계증명서"]
    assert "TESTCODE12" in gov24_rpa.ISSUE_URLS["혼인관계증명서"]
    assert "혼인관계증명서" in manager.refresh_supported_docs()
    extra_sandbox.unlink()
    assert gov24_rpa.reload_extra_docs() == []
    assert "혼인관계증명서" not in gov24_rpa.DOC_CAPP
    assert "혼인관계증명서" not in gov24_rpa.APPLY_FORM_URLS
    supported = manager.refresh_supported_docs()
    assert "혼인관계증명서" not in supported and "주민등록등본" in supported


def test_probe_api_registers_and_activates(extra_sandbox, monkeypatch):
    """성공 경로 — ✅ 행만 등록되고 재시작 없이 rpa-supported 에 β로 나타난다."""
    import local_server
    from rpa import probe as probe_mod
    monkeypatch.setattr(probe_mod, "probe_names", lambda names: ([dict(OK_ROW)], None))
    c = TestClient(local_server.app)
    j = c.post("/api/docs/probe", json={"doc_name": "혼인관계증명서"}).json()
    assert j["status"] == "ok" and j["registered"] == ["혼인관계증명서"]
    assert "혼인관계증명서" in j["supported"] and "혼인관계증명서" in j["beta"]
    sup = c.get("/api/documents/rpa-supported").json()
    assert "혼인관계증명서" in sup["supported"] and "혼인관계증명서" in sup["beta"]


def test_probe_api_honest_failure(extra_sandbox, monkeypatch):
    """실측 실패(정부망 차단 등)는 실패로 보고 — 아무것도 등록되지 않는다(날조 금지)."""
    import local_server
    from rpa import probe as probe_mod
    monkeypatch.setattr(probe_mod, "probe_names", lambda names: (None, "정부24 접속 실패: blocked"))
    j = TestClient(local_server.app).post("/api/docs/probe", json={"doc_name": "혼인관계증명서"}).json()
    assert j["status"] == "error" and "정부24" in j["message"]
    assert not extra_sandbox.exists()


def test_probe_api_not_supported_verdict(extra_sandbox, monkeypatch):
    """조사는 됐지만 ✅가 아니면(온라인 발급 비대상 등) 등록 0 + 판정 그대로 보고."""
    import local_server
    from rpa import probe as probe_mod
    row = {"name": "임대차계약서", "code": "", "title": "", "issue_btn": False,
           "verdict": "❌ 미발견", "note": "검색 결과에 민원 코드 링크 없음"}
    monkeypatch.setattr(probe_mod, "probe_names", lambda names: ([row], None))
    j = TestClient(local_server.app).post("/api/docs/probe", json={"doc_name": "임대차계약서"}).json()
    assert j["status"] == "not_supported" and j["registered"] == []
    assert j["rows"][0]["verdict"].startswith("❌")
    assert not extra_sandbox.exists()


def test_probe_api_already_supported(extra_sandbox):
    """이미 지원하는 서류는 브라우저를 띄우지 않고 즉시 안내."""
    import local_server
    j = TestClient(local_server.app).post("/api/docs/probe", json={"doc_name": "주민등록등본"}).json()
    assert j["status"] == "already"


def test_probe_api_shared_blocked(extra_sandbox, monkeypatch):
    """🔒 공유(터널) 배포에선 403 — 커버리지 실측은 본인 PC 전용."""
    import local_server
    monkeypatch.setenv("RPA_SHARED", "1")
    r = TestClient(local_server.app).post("/api/docs/probe", json={"doc_name": "혼인관계증명서"})
    assert r.status_code == 403


def test_docs_probe_batch(extra_sandbox, monkeypatch):
    """일괄 실측(후보 칩 '한번에') — ✅만 등록, 나머지는 판정 그대로 보고."""
    import local_server
    from rpa import probe as probe_mod
    rows = [dict(OK_ROW),
            {"name": "장기요양인정서", "code": "", "title": "", "issue_btn": False,
             "verdict": "❌ 미발견", "note": "검색 결과에 민원 코드 링크 없음"}]
    monkeypatch.setattr(probe_mod, "probe_names", lambda names: (rows, None))
    j = TestClient(local_server.app).post(
        "/api/docs/probe", json={"doc_names": ["혼인관계증명서", "장기요양인정서"]}).json()
    assert j["status"] == "ok" and j["registered"] == ["혼인관계증명서"]
    assert len(j["rows"]) == 2 and "혼인관계증명서" in j["supported"]
    assert "장기요양인정서" not in j["supported"]


def test_docs_probe_candidates_endpoint(extra_sandbox):
    """후보 칩 목록 — 기본 후보 중 '아직 미지원'만(기지원 서류가 후보로 다시 뜨지 않게)."""
    import local_server
    j = TestClient(local_server.app).get("/api/docs/probe-candidates").json()
    assert isinstance(j["candidates"], list) and len(j["candidates"]) >= 5
    assert "주민등록등본" not in j["candidates"]


APPLY_OK_ROW = {"name": "경기 청년기본소득", "id": "WLF00012345",
                "url": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00012345",
                "title": "경기 청년기본소득", "verdict": "🟡 후보(ID·서비스 일치 확인)", "note": ""}


def test_apply_probe_candidate(extra_sandbox, monkeypatch):
    """자동신청 실측 — 🟡 후보는 candidate + 딥링크 반환, β 한계(첫 자동신청이 최종 검증)를 문구로 명시."""
    import local_server
    from rpa import probe as probe_mod
    monkeypatch.setattr(probe_mod, "probe_apply_names", lambda names: ([dict(APPLY_OK_ROW)], None))
    j = TestClient(local_server.app).post("/api/apply/probe", json={"service_name": "경기 청년기본소득"}).json()
    assert j["status"] == "candidate" and "wlfareInfoId=WLF00012345" in j["url"]
    assert j["wlfareInfoId"] == "WLF00012345" and "첫 자동신청" in j["message"]


def test_apply_probe_not_found(extra_sandbox, monkeypatch):
    """복지로 미등재·불일치는 등록 없이 정직 보고(공식 링크 폴백 안내)."""
    import local_server
    from rpa import probe as probe_mod
    row = {"name": "어촌뉴딜수당", "id": "", "url": "", "title": "",
           "verdict": "❌ 미발견", "note": "검색 결과에 wlfareInfoId 링크 없음"}
    monkeypatch.setattr(probe_mod, "probe_apply_names", lambda names: ([row], None))
    j = TestClient(local_server.app).post("/api/apply/probe", json={"service_name": "어촌뉴딜수당"}).json()
    assert j["status"] == "not_found" and "공식 링크" in j["message"]


def test_apply_probe_error_and_shared(extra_sandbox, monkeypatch):
    """접속 실패는 error로(날조 금지) · 공유 배포는 403(본인 PC 전용)."""
    import local_server
    from rpa import probe as probe_mod
    monkeypatch.setattr(probe_mod, "probe_apply_names", lambda names: (None, "복지로 접속 실패: blocked"))
    c = TestClient(local_server.app)
    j = c.post("/api/apply/probe", json={"service_name": "아무수당"}).json()
    assert j["status"] == "error" and "복지로" in j["message"]
    monkeypatch.setenv("RPA_SHARED", "1")
    assert c.post("/api/apply/probe", json={"service_name": "아무수당"}).status_code == 403
