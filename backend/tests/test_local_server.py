"""경량 로컬 에이전트(local_server) 테스트.

동일 출처 서빙 + RPA 라우트 + PNA 프리플라이트/헬스의 계약을 검증한다.
실제 브라우저는 띄우지 않는다(라우팅·게이팅·CORS/PNA 헤더만 확인).
"""
import pytest
from fastapi.testclient import TestClient

import local_server

client = TestClient(local_server.app)

GH = "https://biocode67.github.io"  # 허용 오리진(배포 웹 브릿지)
BAD = "https://evil.example.com"    # 비허용 오리진


def test_health_shape():
    r = client.get("/api/health")
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "local-agent"
    caps = j["capabilities"]
    assert caps["ai"] is False          # AI는 프론트 클라이언트 엔진이 담당
    assert isinstance(caps["rpa"], bool)  # 로컬 RPA 가용 여부


def test_pna_preflight_allowed_origin_returns_200():
    """크롬 PNA 프리플라이트: 허용 오리진이면 200 + Allow-Private-Network 헤더."""
    r = client.options("/api/health", headers={
        "Origin": GH,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
    })
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-private-network") == "true"
    assert r.headers.get("access-control-allow-origin") == GH


def test_pna_preflight_disallowed_origin_not_authorized():
    """비허용 오리진의 PNA 프리플라이트는 우리 200 숏서킷을 타지 않는다(허용 헤더 없음)."""
    r = client.options("/api/health", headers={
        "Origin": BAD,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
    })
    # 비허용 오리진엔 ACAO/PNA 허용 헤더가 붙지 않아야 함(브라우저가 차단)
    assert r.headers.get("access-control-allow-origin") != BAD
    assert r.headers.get("access-control-allow-private-network") != "true"


def test_rpa_supported_lists_docs():
    r = client.get("/api/documents/rpa-supported")
    assert r.status_code == 200
    docs = r.json()["supported"]
    assert "주민등록등본" in docs
    assert len(docs) >= 4


def test_rpa_status_unknown_task_404():
    assert client.get("/api/documents/rpa-status/nope-not-real").status_code == 404


def test_apply_status_unknown_task_404():
    assert client.get("/api/apply/status/nope-not-real").status_code == 404


def test_rpa_file_unknown_task_404():
    assert client.get("/api/documents/rpa-file/nope?t=x").status_code == 404


def test_rpa_issue_blocked_when_disabled(monkeypatch):
    """RPA 비활성(클라우드/미설정) 시 rpa-issue 는 503 으로 안내(공식 링크 폴백 유도)."""
    monkeypatch.setenv("RPA_ENABLED", "0")
    r = client.post("/api/documents/rpa-issue", json={"doc_name": "주민등록등본", "user_name": "홍길동"})
    assert r.status_code == 503


def test_apply_start_unsupported_service(monkeypatch):
    monkeypatch.setenv("RPA_ENABLED", "1")  # 게이트 통과시켜 '지원목록 밖' 분기를 정확히 검증
    r = client.post("/api/apply/start", json={"service_name": "존재하지않는서비스"})
    assert r.status_code == 400  # 지원목록 밖 → 400 (503 허용은 게이팅 회귀를 가려서 제거)


def test_apply_start_generalized_bokjiro_link_accepted(monkeypatch):
    """지원 6종 밖이어도 profile.apply_url이 복지로 딥링크면 신청 수락 — 청년월세지원 데모 신청경로.
    (브라우저는 안 띄우고 수락 게이팅만 검증 — start_apply_task 목킹)"""
    monkeypatch.setenv("RPA_ENABLED", "1")
    from rpa import manager
    monkeypatch.setattr(manager, "start_apply_task", lambda *a, **k: "fake-task-id")
    deep = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004661"
    r = client.post("/api/apply/start", json={
        "service_name": "청년월세지원", "user_name": "김청년", "profile": {"apply_url": deep},
    })
    assert r.status_code == 200, r.text
    assert r.json().get("task_id") == "fake-task-id"


def test_apply_start_generalized_rejects_non_bokjiro_link(monkeypatch):
    """지원 밖 + 복지로 아닌 링크(gov.kr 검색 등)면 400 — 아무 URL로나 신청창을 열지 않는다(오연결 방지)."""
    monkeypatch.setenv("RPA_ENABLED", "1")
    r = client.post("/api/apply/start", json={
        "service_name": "존재하지않는서비스", "user_name": "x",
        "profile": {"apply_url": "https://www.gov.kr/search?srhQuery=x"},
    })
    assert r.status_code == 400


def test_rpa_file_wrong_token_403():
    """완료된 태스크라도 잘못된/누락 토큰이면 문서 반환 거부(다운로드 인가)."""
    from rpa import manager
    manager._rpa_tasks["ft-badtok"] = {"status": "done", "download_token": "realsecret",
                                       "result": {"saved_path": __file__}}
    try:
        assert client.get("/api/documents/rpa-file/ft-badtok?t=WRONG").status_code == 403
        assert client.get("/api/documents/rpa-file/ft-badtok").status_code == 403  # 토큰 없음
    finally:
        manager._rpa_tasks.pop("ft-badtok", None)


def test_rpa_file_path_traversal_rejected():
    """저장 폴더(DOCS_DIR) 밖 경로는 올바른 토큰이어도 거부(경로 이탈 차단)."""
    import os
    from rpa import manager
    outside = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "win.ini")
    manager._rpa_tasks["ft-traverse"] = {"status": "done", "download_token": "tok",
                                         "result": {"saved_path": outside}}
    try:
        r = client.get("/api/documents/rpa-file/ft-traverse?t=tok")
        # 파일이 존재하면 commonpath 검사에서 403(폴더 밖), 없으면 404 — 어느 쪽도 문서 유출 없음
        assert r.status_code in (403, 404)
    finally:
        manager._rpa_tasks.pop("ft-traverse", None)


def test_rpa_status_strips_download_token():
    """rpa-status 응답에도 download_token(인가 비밀)이 노출되지 않아야 한다."""
    from rpa import manager
    manager._rpa_tasks["st-tok"] = {"status": "running", "download_token": "secret", "current_step": "x"}
    try:
        r = client.get("/api/documents/rpa-status/st-tok")
        assert r.status_code == 200
        assert "download_token" not in r.json()
    finally:
        manager._rpa_tasks.pop("st-tok", None)


def test_apply_status_strips_download_token():
    """apply-status 도 rpa-status 처럼 download_token(인가 비밀)을 응답에서 제거해야 한다."""
    from rpa import manager
    manager._rpa_tasks["fake-apply-tok"] = {"status": "done", "download_token": "secret-xyz", "current_step": "x"}
    try:
        r = client.get("/api/apply/status/fake-apply-tok")
        assert r.status_code == 200
        assert "download_token" not in r.json()
    finally:
        manager._rpa_tasks.pop("fake-apply-tok", None)


@pytest.mark.skipif(local_server._APP_DIR is None, reason="dist-app 미빌드")
def test_serves_frontend_when_built():
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")


@pytest.mark.skipif(local_server._APP_DIR is None, reason="dist-app 미빌드")
def test_api_not_shadowed_by_static_mount():
    """'/' 정적 마운트가 /api/* 를 가리지 않아야 한다 — 가리면 설치본에서 모든 API가 index.html로
    404되어 데모가 조용히 깨진다(마운트를 라우트보다 먼저 등록하는 리팩터 회귀 방지)."""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"  # 정적 index.html이 아니라 JSON API 응답
    assert "text/html" not in r.headers.get("content-type", "")


def test_status_screenshot_gated_by_token():
    """스크린샷(정부 페이지 — PII 가능)은 시작자 토큰(?t=) 일치 시에만 응답에 포함(감사 지적)."""
    from rpa import manager
    for tid, path in (("sc-doc", "/api/documents/rpa-status/sc-doc"), ("sc-apply", "/api/apply/status/sc-apply")):
        manager._rpa_tasks[tid] = {"status": "running", "download_token": "tok123",
                                   "screenshot_b64": "IMGDATA", "current_step": "x"}
        try:
            # 토큰 없음/불일치 → 스크린샷 제거(진행 상태·스텝은 그대로)
            d = client.get(path).json()
            assert "screenshot_b64" not in d and d["status"] == "running"
            assert "screenshot_b64" not in client.get(path + "?t=WRONG").json()
            # 시작자 토큰 일치 → 포함
            assert client.get(path + "?t=tok123").json()["screenshot_b64"] == "IMGDATA"
        finally:
            manager._rpa_tasks.pop(tid, None)


def test_rpa_file_delete_after_download(monkeypatch, tmp_path):
    """서버 RPA 모드(RPA_DELETE_AFTER_DOWNLOAD=1): 문서 전송 직후 서버 디스크에서 삭제(PII 무저장)."""
    import os
    from rpa import base, manager
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"%PDF-1.4 test")
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    monkeypatch.setenv("RPA_DELETE_AFTER_DOWNLOAD", "1")
    manager._rpa_tasks["del1"] = {"status": "done", "download_token": "tok",
                                  "result": {"saved_path": str(f)}}
    try:
        r = client.get("/api/documents/rpa-file/del1?t=tok")
        assert r.status_code == 200 and r.content.startswith(b"%PDF")
        assert not os.path.exists(f)  # 전송 후 삭제됨
    finally:
        manager._rpa_tasks.pop("del1", None)


def test_rpa_file_kept_by_default(monkeypatch, tmp_path):
    """로컬 앱 기본(env 미설정): 다운로드 후에도 파일 유지(내 PC 보관)."""
    import os
    from rpa import base, manager
    f = tmp_path / "doc2.pdf"
    f.write_bytes(b"%PDF-1.4 keep")
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    monkeypatch.delenv("RPA_DELETE_AFTER_DOWNLOAD", raising=False)
    manager._rpa_tasks["del2"] = {"status": "done", "download_token": "tok2",
                                  "result": {"saved_path": str(f)}}
    try:
        r = client.get("/api/documents/rpa-file/del2?t=tok2")
        assert r.status_code == 200
        assert os.path.exists(f)
    finally:
        manager._rpa_tasks.pop("del2", None)


def test_status_non_ascii_token_no_500():
    """?t= 에 비ASCII를 줘도 500이 아니라 정상 게이트(200, 스샷 제거) — hmac 비ASCII TypeError 방지."""
    from rpa import manager
    manager._rpa_tasks["na1"] = {"status": "running", "download_token": "tok",
                                 "screenshot_b64": "IMG", "user_name": "김복순", "current_step": "x"}
    try:
        for path in ("/api/documents/rpa-status/na1", "/api/apply/status/na1"):
            r = client.get(path, params={"t": "한글토큰불일치"})
            assert r.status_code == 200, path              # 500 아님(비ASCII로 TypeError 안 남)
            assert "screenshot_b64" not in r.json(), path  # 불일치라 스샷 제거
    finally:
        manager._rpa_tasks.pop("na1", None)


def test_status_redacts_pii_without_token():
    """토큰 없으면 실명·서류종·스크린샷 전부 제거(민감 서류종 노출 차단)."""
    from rpa import manager
    manager._rpa_tasks["pii1"] = {"status": "running", "download_token": "tok",
                                  "screenshot_b64": "IMG", "user_name": "김복순",
                                  "doc_name": "기초생활수급자 증명서", "current_step": "진행 중"}
    try:
        d = client.get("/api/documents/rpa-status/pii1").json()
        assert "user_name" not in d and "doc_name" not in d and "screenshot_b64" not in d
        assert d.get("status") == "running" and d.get("current_step") == "진행 중"  # 비민감 필드는 유지
        # 토큰 있으면 전부 노출
        d2 = client.get("/api/documents/rpa-status/pii1?t=tok").json()
        assert d2.get("user_name") == "김복순" and d2.get("screenshot_b64") == "IMG"
        assert "download_token" not in d2  # 토큰 자체는 어떤 경우에도 미노출
    finally:
        manager._rpa_tasks.pop("pii1", None)


# ── '내 서류함' 사용자 서류 등록(/api/documents/register) ──
#   자동발급 불가 서류(임대차계약서·신분증 등)를 발급 폴더에 발급물과 같은 이름 규칙으로 저장 →
#   복지 신청의 자동첨부가 함께 찾도록. multipart 파서 필요 → 미설치 환경은 스킵(실행환경엔 설치됨).

def test_register_document_saves_with_issue_naming(monkeypatch, tmp_path):
    """유효 업로드는 '서류명_이름_날짜' 규칙으로 저장되고 recent_issued_docs가 곧바로 찾는다(자동첨부 성립)."""
    pytest.importorskip("multipart")
    from rpa import base
    d = tmp_path / "모두봄서류"
    monkeypatch.setattr(base, "DOCS_DIR", d)
    r = client.post(
        "/api/documents/register",
        data={"doc_name": "임대차계약서", "user_name": "홍길동"},
        files={"file": ("lease.jpg", b"\xff\xd8\xff\xe0data", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["registered"] is True and j["filename"].startswith("임대차계약서_홍길동_")
    saved = d / j["filename"]
    assert saved.exists() and saved.suffix == ".jpg"
    assert any(n == "임대차계약서_홍길동" for n, _ in base.recent_issued_docs())  # 자동첨부 후보로 잡힘


def test_register_document_rejects_non_whitelisted_ext(monkeypatch, tmp_path):
    """실행파일 등 화이트리스트 밖 확장자는 400(발급 폴더 오염·오첨부 차단)."""
    pytest.importorskip("multipart")
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path / "docs")
    r = client.post(
        "/api/documents/register",
        data={"doc_name": "임대차계약서", "user_name": "홍길동"},
        files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
    )
    assert r.status_code == 400


def test_register_document_requires_doc_name(monkeypatch, tmp_path):
    """서류명이 비면 400 — 이름 없이 저장하면 자동첨부가 어떤 칸에 붙일지 모른다."""
    pytest.importorskip("multipart")
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path / "docs")
    r = client.post(
        "/api/documents/register",
        data={"doc_name": ""},
        files={"file": ("a.pdf", b"%PDF", "application/pdf")},
    )
    assert r.status_code == 400
