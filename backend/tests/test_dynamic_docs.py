# -*- coding: utf-8 -*-
"""동적 서류 커버리지(docs_extra.json) — 병합 게이트·전파 검증.

정직성 계약: enabled=True + 코드 형식(영숫자 6~20) 통과분만 병합, 내장 서류는 항상 우선,
손상 파일은 부팅을 깨지 않고 무시. manager 지원목록·URL 맵·발급 라우팅(gov24)까지 전파.
"""
import importlib
import json
import sys


def test_load_extra_validation(tmp_path, monkeypatch):
    import rpa.gov24_rpa as g
    f = tmp_path / "docs_extra.json"
    f.write_text(json.dumps([
        {"name": "혼인관계증명서", "code": "97400000005", "enabled": True},
        {"name": "형식불량", "code": "abc!", "enabled": True},          # 코드 형식 위반 → 제외
        {"name": "꺼진서류", "code": "12345678", "enabled": False},      # 비활성 → 제외
        {"name": "주민등록등본", "code": "99999999999", "enabled": True},  # 내장 충돌 → 제외(내장 우선)
        "문자열항목",                                                     # 비정형 → 제외
    ], ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(g, "_EXTRA_DOCS_PATH", f)
    out = g._load_extra_docs()
    assert out == {"혼인관계증명서": "97400000005"}


def test_load_extra_broken_file_is_ignored(tmp_path, monkeypatch):
    import rpa.gov24_rpa as g
    f = tmp_path / "docs_extra.json"
    f.write_text("{손상된 JSON", encoding="utf-8")
    monkeypatch.setattr(g, "_EXTRA_DOCS_PATH", f)
    assert g._load_extra_docs() == {}  # 부팅 불가침 — 예외 없이 빈 병합


def test_reload_merges_into_supported_and_urls(tmp_path, monkeypatch):
    """env 지정 파일로 모듈을 새로 로드하면 DOC_CAPP·URL 맵·manager 지원목록에 전파된다."""
    f = tmp_path / "docs_extra.json"
    f.write_text(json.dumps([
        {"name": "혼인관계증명서", "code": "97400000005", "enabled": True},
    ], ensure_ascii=False), encoding="utf-8")
    saved = {k: sys.modules.get(k) for k in ("rpa.gov24_rpa", "rpa.manager")}
    try:
        monkeypatch.setenv("MODOOBOM_EXTRA_DOCS", str(f))
        for k in saved:
            sys.modules.pop(k, None)
        g2 = importlib.import_module("rpa.gov24_rpa")
        m2 = importlib.import_module("rpa.manager")
        assert g2.DOC_CAPP["혼인관계증명서"] == "97400000005"
        assert "혼인관계증명서" in g2.EXTRA_DOC_NAMES
        assert "97400000005" in g2.ISSUE_URLS["혼인관계증명서"]
        assert "97400000005" in g2.APPLY_FORM_URLS["혼인관계증명서"]
        # manager: gov24 일반 흐름으로 라우팅 + 지원목록 노출(여정·발급 시작 검증 통과)
        assert m2._SUPPORTED_DOCS["혼인관계증명서"] == ("gov24", "정부24")
        assert "혼인관계증명서" in m2.SUPPORTED_DOC_NAMES
        # 내장 서류는 그대로(덮어쓰기 없음)
        assert g2.DOC_CAPP["주민등록등본"] == "13100000015"
    finally:
        # 다른 테스트가 들고 있는 원본 모듈 객체 복원(스위트 오염 방지).
        # ⚠️ sys.modules만으론 부족 — import 시스템이 부모 패키지 속성(rpa.manager)도 새 모듈로
        #   바꿔놓아 'from rpa import manager'(패키지 속성)와 'from rpa.manager import ...'(sys.modules)가
        #   서로 다른 모듈을 보게 된다(실측: 토큰 게이트 테스트 13건 연쇄 오염) → 속성까지 원복.
        import rpa as _pkg
        for k, v in saved.items():
            if v is not None:
                sys.modules[k] = v
                setattr(_pkg, k.split(".")[1], v)
            else:
                sys.modules.pop(k, None)
