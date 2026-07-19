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


def test_maintenance_notice_detection():
    """정부24 '서비스 점검 중' 팝업을 특정 감지 — 외부기관 연계 서류(가족관계=대법원, 소득=홈택스)의
    야간·점검 시간 실패를 4분 헛돌지 않고 '앱 오류 아님·낮에 재시도'로 정직하게 전환(실사용 데모 제보)."""
    from rpa.gov24_rpa import _is_maintenance_notice
    # 실제 팝업 문구(사용자 스크린샷) + 공백 변형
    assert _is_maintenance_notice("안내\n서비스 점검 중입니다.\n닫기")
    assert _is_maintenance_notice("점검중입니다")
    assert _is_maintenance_notice("현재 서비스 점검 중 이니 잠시 후 이용하세요")
    # 연계기관(대법원 시스템 등) 점검 문구 변형도 감지
    assert _is_maintenance_notice("전자가족관계등록시스템 시스템 점검 중")
    assert _is_maintenance_notice("점검으로 인해 서비스를 이용할 수 없습니다")
    # 정상 발급 화면·빈 문자열은 오탐 없음(정상 흐름을 끊지 않음)
    assert not _is_maintenance_notice("발급 폼 로드 — 신청하기 진행")
    assert not _is_maintenance_notice("문서출력 처리완료")
    # ⚠️ '점검' 단독(정기 점검 안내문 등)은 오탐하지 않아야 한다 — 상태 못박는 구절만 매칭
    assert not _is_maintenance_notice("정기 점검 시간은 매일 새벽 3시입니다")
    assert not _is_maintenance_notice("서류를 점검하세요")
    assert not _is_maintenance_notice("")
    assert not _is_maintenance_notice(None)  # 방어적: None 안전


def test_privacy_masking_env_valve_and_result():
    """🔒 주민번호 뒷자리 비공개 선택 — RPA_PRIVACY_MASK=0 안전밸브로 끌 수 있고,
    폼에 옵션이 있으면 True(안내 노출)·없거나 실패면 False(무해 침묵)를 고정."""
    import asyncio, os
    from rpa.gov24_rpa import _select_privacy_masking

    class _Page:
        def __init__(self, result):
            self._r = result
        async def evaluate(self, _js):
            if isinstance(self._r, Exception):
                raise self._r
            return self._r

    def run(page):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_select_privacy_masking(page))
        finally:
            loop.close()

    assert run(_Page(2)) is True          # 옵션 클릭됨 → 안내 노출
    assert run(_Page(0)) is False         # 해당 옵션 없음 → 침묵(무해)
    assert run(_Page(RuntimeError("x"))) is False  # 평가 실패도 침묵
    os.environ["RPA_PRIVACY_MASK"] = "0"
    try:
        assert run(_Page(2)) is False     # 안전밸브: 끄면 시도 자체를 안 함
    finally:
        del os.environ["RPA_PRIVACY_MASK"]


def test_wallet_required_detection():
    """정부24 '전자문서지갑 발급 후 사용가능' 안내 감지 — 가족관계 등 전자문서지갑 선행 서류를
    점검과 구분해 정직 안내로 전환(실사용 제보: 가족관계 타일이 이 팝업)."""
    from rpa.gov24_rpa import _is_wallet_required, _wallet_msg
    assert _is_wallet_required("안내\n전자문서지갑 발급 후 사용가능합니다. 정부24 앱(APP)에서 로그인 후 발급 해주세요.")
    assert _is_wallet_required("전자문서지갑을 먼저 발급 후 이용하세요")
    # 무관한 화면은 오탐 없음
    assert not _is_wallet_required("발급 폼 로드 — 신청하기 진행")
    assert not _is_wallet_required("")
    assert not _is_wallet_required(None)
    m = _wallet_msg("가족관계증명서")
    assert "가족관계증명서" in m and "전자문서지갑" in m and "앱 오류 아님" in m


def test_maintenance_msg_names_service():
    """점검 안내 문구는 서류명을 넣고 '앱 오류 아님'을 명시한다(사용자 오해 방지)."""
    from rpa.gov24_rpa import _maintenance_msg
    m = _maintenance_msg("가족관계증명서")
    assert "가족관계증명서" in m and "앱 오류 아님" in m and "전자발급" in m


def test_maintenance_popup_text_gathers_and_skips_broken_frames():
    """_maintenance_popup_text: 보이는 팝업/모달 텍스트를 프레임 전체에서 합치고, 접근 불가
    (cross-origin) 프레임은 건너뛴다. → 점검 팝업이 연계기관 iframe 안에 떠도 감지되도록,
    동시에 '본문 보일러플레이트'가 아니라 팝업만 대상으로 해 오탐을 줄이는 수집을 고정."""
    import asyncio
    from rpa.gov24_rpa import _maintenance_popup_text, _is_maintenance_notice

    class _Frame:
        # 이 프레임의 '보이는 팝업' 텍스트(_maintenance_popup_text 의 JS 결과)를 흉내낸다.
        def __init__(self, popup=None, boom=False):
            self._popup, self._boom = popup, boom
        async def evaluate(self, _script):
            if self._boom:
                raise RuntimeError("cross-origin")  # 접근 불가 프레임
            return self._popup or ""

    class _Page:
        frames = [_Frame(""), _Frame(boom=True), _Frame("안내\n서비스 점검 중입니다.\n닫기")]

    loop = asyncio.new_event_loop()
    try:
        txt = loop.run_until_complete(_maintenance_popup_text(_Page()))
    finally:
        loop.close()
    assert "서비스 점검 중입니다" in txt          # iframe 팝업이 합쳐져 잡힘(깨진 프레임은 건너뜀)
    assert _is_maintenance_notice(txt)            # 팝업 텍스트로 점검 감지 성립


def test_wait_document_rendered_returns_when_content_present():
    """_wait_document_rendered: 문서 본문(텍스트/캔버스 등)이 감지되면 대기를 마치고 진행한다
    → 빈 PDF 저장 방지의 '본문 렌더 대기'가 실제로 콘텐츠를 기다리는지 고정(ready 경로)."""
    import asyncio
    from rpa.gov24_rpa import _wait_document_rendered

    class _Page:
        async def wait_for_load_state(self, _state, timeout=0):
            return None
        async def evaluate(self, _script):
            return True  # 본문이 이미 렌더됨

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_wait_document_rendered(_Page(), timeout_sec=1))  # 예외 없이 반환하면 통과
    finally:
        loop.close()
