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
