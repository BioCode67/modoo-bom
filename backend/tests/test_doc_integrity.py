# -*- coding: utf-8 -*-
"""발급물 무결성 게이트(_looks_valid_doc) — '발급 완료'인데 깨진 파일을 성공으로 보고하지 않는다."""
from rpa.base import _looks_valid_doc


def _mk(tmp_path, name: str, data: bytes):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_valid_pdf_passes(tmp_path):
    p = _mk(tmp_path, "등본.pdf", b"%PDF-1.7\n" + b"x" * 2048)
    assert _looks_valid_doc(p) is True


def test_valid_png_passes(tmp_path):
    p = _mk(tmp_path, "등본.png", b"\x89PNG\r\n\x1a\n" + b"x" * 2048)
    assert _looks_valid_doc(p) is True


def test_tiny_file_rejected(tmp_path):
    # 1KB 미만 — 잘린 저장(전송 중단·디스크 오류)을 성공으로 두지 않음
    p = _mk(tmp_path, "등본.pdf", b"%PDF-1.7\n tiny")
    assert _looks_valid_doc(p) is False


def test_wrong_header_rejected(tmp_path):
    # 확장자는 pdf인데 내용이 HTML(오류 페이지 저장 등) — 형식 위조 차단
    p = _mk(tmp_path, "등본.pdf", b"<html>session expired</html>" + b"x" * 2048)
    assert _looks_valid_doc(p) is False


def test_missing_file_rejected(tmp_path):
    assert _looks_valid_doc(tmp_path / "없음.pdf") is False


def test_valid_jpg_passes(tmp_path):
    # 촬영·등록 경로(서류함) 파일도 같은 게이트
    p = _mk(tmp_path, "임대차계약서_홍길동.jpg", b"\xff\xd8\xff\xe0" + b"x" * 2048)
    assert _looks_valid_doc(p) is True


def test_scanner_marks_corrupt_and_excludes_attach(tmp_path, monkeypatch):
    """서류함 스캐너 — 깨진 파일은 intact=False + 자동첨부 후보 제외(손상물 조용한 제출 방지)."""
    from rpa import base
    import local_server
    monkeypatch.setattr(base, "DOCS_DIR", tmp_path)
    _mk(tmp_path, "주민등록등본_홍길동.pdf", b"%PDF-1.7\n" + b"x" * 4096)   # 정상(방금 발급)
    _mk(tmp_path, "가족관계증명서_홍길동.pdf", b"partial")                    # 잘림(크래시)
    items = {i["display"]: i for i in local_server._scan_documents()}
    ok = items["주민등록등본_홍길동"]
    bad = items["가족관계증명서_홍길동"]
    assert ok["intact"] is True and ok["attach_candidate"] is True
    assert bad["intact"] is False and bad["attach_candidate"] is False
