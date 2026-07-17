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


# ── 🗂 내 서류함(목록/삭제) — 발급·등록 서류의 가시화와 안전한 정리 ──

def test_documents_list_shows_docs_with_attach_flag(monkeypatch, tmp_path):
    """목록은 표시명(타임스탬프 제거)+자동첨부 후보 플래그를 준다 — 프론트/백엔드 판정 단일화."""
    import os, time
    from rpa import base
    d = tmp_path / "docs"; d.mkdir()
    (d / "주민등록등본_홍길동_2026-07-16_1010.pdf").write_bytes(b"%PDF new")
    old = d / "임대차계약서_홍길동_2026-07-01_0900.jpg"; old.write_bytes(b"\xff\xd8\xff")
    os.utime(old, (time.time() - 999999, time.time() - 999999))  # 오래됨 → 첨부창 밖
    (d / "무관한파일.txt").write_text("x")  # 관리 대상 아님 → 제외
    monkeypatch.setattr(base, "DOCS_DIR", d)
    monkeypatch.setenv("RPA_ATTACH_MAX_AGE", "1200")
    j = client.get("/api/documents/list").json()
    names = {x["filename"]: x for x in j["documents"]}
    assert "무관한파일.txt" not in names
    fresh = names["주민등록등본_홍길동_2026-07-16_1010.pdf"]
    assert fresh["display"] == "주민등록등본_홍길동" and fresh["attach_candidate"] is True
    stale = names["임대차계약서_홍길동_2026-07-01_0900.jpg"]
    assert stale["attach_candidate"] is False  # 오래된 파일은 자동첨부 후보 아님(교차사용자 방어와 일관)
    assert j["attach_window_sec"] == 1200 and j["documents"][0]["filename"] == fresh["filename"]  # 최신순


def test_documents_delete_removes_file(monkeypatch, tmp_path):
    from rpa import base
    d = tmp_path / "docs"; d.mkdir()
    f = d / "신분증_홍길동_2026-07-16_1010.pdf"; f.write_bytes(b"%PDF")
    monkeypatch.setattr(base, "DOCS_DIR", d)
    r = client.post("/api/documents/delete", json={"filename": f.name})
    assert r.status_code == 200 and r.json()["deleted"] is True
    assert not f.exists()


def test_documents_delete_rejects_traversal_and_foreign(monkeypatch, tmp_path):
    """경로 이탈(../, 절대경로)·관리 밖 확장자·심볼릭 이탈은 전부 거절 — 서류함 밖 파일 삭제 불가."""
    import os
    from rpa import base
    d = tmp_path / "docs"; d.mkdir()
    secret = tmp_path / "secret.pdf"; secret.write_bytes(b"%PDF secret")
    monkeypatch.setattr(base, "DOCS_DIR", d)
    for bad in ("../secret.pdf", "/etc/passwd", "..\\secret.pdf", "a/../b.pdf", ".hidden.pdf", "notes.txt", ""):
        r = client.post("/api/documents/delete", json={"filename": bad})
        assert r.status_code in (400, 403, 404), bad
    assert secret.exists()  # 폴더 밖 파일은 그대로
    # 심볼릭 링크로 폴더 밖을 가리키는 파일명 — realpath 검증이 걸러야 함
    link = d / "링크_2026-07-16_1010.pdf"
    try:
        os.symlink(secret, link)
        r = client.post("/api/documents/delete", json={"filename": link.name})
        assert r.status_code == 403 and secret.exists()
    except OSError:
        pass  # 심볼릭 미지원 파일시스템이면 스킵


def test_diag_has_tech_info_and_no_pii(monkeypatch, tmp_path):
    """진단(/api/_diag)은 기술 정보만 — 실명·서류명·토큰·스크린샷을 절대 싣지 않는다(redaction 하우스 규칙)."""
    from rpa import manager, base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    manager._rpa_tasks["dg1"] = {"status": "error", "download_token": "secret-tok",
                                 "screenshot_b64": "IMG", "user_name": "김복순",
                                 "doc_name": "기초생활수급자 증명서",
                                 "current_step": "브라우저를 실행할 수 없습니다 (기술 원인)"}
    try:
        r = client.get("/api/_diag")
        assert r.status_code == 200
        j = r.json()
        text = r.text
        assert j["version"] and j["platform"] and "tasks_by_status" in j
        assert j["tasks_by_status"].get("error", 0) >= 1
        assert "브라우저를 실행할 수" in j["last_error"]
        # PII·비밀 무포함
        for banned in ("김복순", "기초생활수급자", "secret-tok", "IMG", "user_name", "doc_name", "screenshot"):
            assert banned not in text, banned
    finally:
        manager._rpa_tasks.pop("dg1", None)


def test_preflight_all_green(monkeypatch, tmp_path):
    """프리플라이트: 브라우저·정부사이트를 스텁하고 5항목 전부 정상일 때 ok=true + 항목별 결과."""
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)

    async def fake_browser():
        return True, "chrome"
    monkeypatch.setattr(local_server, "_browser_probe", fake_browser)
    monkeypatch.setattr(local_server, "_probe_site", lambda url, timeout=6.0: (True, "응답 200 · 0.3초"))

    r = client.get("/api/_preflight")
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] is True
    ids = [c["id"] for c in j["checks"]]
    assert ids == ["browser", "gov24", "bokjiro", "docs_dir", "disk"]
    assert all(c["ok"] for c in j["checks"])
    # 발급 폴더는 '이름만'(홈 경로 사용자명 미노출) — PII 무포함 원칙
    assert str(tmp_path.parent) not in r.text


def test_preflight_honest_failures_still_200(monkeypatch, tmp_path):
    """프리플라이트: 브라우저 파손·정부망 차단이어도 200 + 항목별 정직한 실패(전체 ok=false)."""
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)

    async def broken_browser():
        return False, "Executable doesn't exist"
    monkeypatch.setattr(local_server, "_browser_probe", broken_browser)
    monkeypatch.setattr(local_server, "_probe_site",
                        lambda url, timeout=6.0: (False, "timed out"))

    r = client.get("/api/_preflight")
    assert r.status_code == 200
    j = r.json()
    assert j["ok"] is False
    by_id = {c["id"]: c for c in j["checks"]}
    assert by_id["browser"]["ok"] is False and "Executable" in by_id["browser"]["detail"]
    assert by_id["gov24"]["ok"] is False and by_id["bokjiro"]["ok"] is False
    # 폴더·디스크는 실제로 점검되어 정상
    assert by_id["docs_dir"]["ok"] is True and by_id["disk"]["ok"] is True


def test_probe_site_http_error_counts_as_reachable(monkeypatch):
    """_probe_site: 403 같은 HTTP 오류 응답도 '서버가 응답함=연결 OK'로 본다(안티봇 403 오탐 방지)."""
    import urllib.error
    import urllib.request

    def raise_403(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", hdrs=None, fp=None)
    monkeypatch.setattr(urllib.request, "urlopen", raise_403)
    ok, detail = local_server._probe_site("https://www.gov.kr", timeout=1.0)
    assert ok is True and "403" in detail

    def raise_neterr(req, timeout=0):
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr(urllib.request, "urlopen", raise_neterr)
    ok, detail = local_server._probe_site("https://www.gov.kr", timeout=1.0)
    assert ok is False


def test_journey_skip_endpoint_unknown_false():
    """개별 단계 건너뛰기 — 미지/종결 여정엔 조용히 False(404 아님: 폴링과 같은 관용, 오동작 없음)."""
    r = client.post("/api/journey/skip/none-such")
    assert r.status_code == 200 and r.json() == {"skipped": False}


def test_static_cache_policy_prevents_stale_index():
    """정적 서빙 캐시 정책 — index.html은 no-cache(재빌드 즉시 반영), 해시 자산은 immutable.
    git pull 후 재빌드했는데 브라우저 휴리스틱 캐시가 옛 index.html을 쓰면 삭제된 해시 자산을
    참조해 흰 화면이 되는 배포 stale 사고 방지."""
    if local_server._APP_DIR is None:
        pytest.skip("dist-app 미빌드 환경")
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-cache"
    import glob as _g
    import os as _os
    assets = _g.glob(str(local_server._APP_DIR / "assets" / "*.js"))
    if not assets:
        pytest.skip("해시 자산 없음")
    r2 = client.get(f"/assets/{_os.path.basename(assets[0])}")
    assert r2.status_code == 200
    assert "immutable" in (r2.headers.get("cache-control") or "")


def test_shared_mode_disables_vault_endpoints(monkeypatch, tmp_path):
    """🔒 RPA_SHARED=1(터널/공유 배포) — 서류함 계열(목록·삭제·등록·폴더열기)이 403으로 꺼진다.
    무토큰 '본인 PC 전용' 설계가 다중 사용자 서버에 노출되면 서로의 서류 표시명(실명)을 보거나
    남의 파일을 지울 수 있는 문제 차단. 발급/신청 RPA 자체는 영향 없음."""
    from rpa import base
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    monkeypatch.setenv("RPA_SHARED", "1")
    assert client.get("/api/documents/list").status_code == 403
    assert client.post("/api/documents/delete", json={"filename": "x.pdf"}).status_code == 403
    assert client.post("/api/documents/open-folder").status_code == 403
    assert client.post("/api/documents/register", files={"file": ("a.pdf", b"%PDF", "application/pdf")},
                       data={"doc_name": "임대차계약서"}).status_code == 403
    # 기본(로컬 데스크탑)은 기존대로 동작
    monkeypatch.delenv("RPA_SHARED")
    assert client.get("/api/documents/list").status_code == 200
