"""보조금24 ETL 순수 로직 테스트 — 네트워크 없이 정규화·매핑·병합만 검증.

픽스처는 '후보 키' 형태의 예시다(컨테이너에서 실API 스키마 실측 불가 — 정부망 차단).
실행 전 --probe 로 실제 키를 확인하는 절차가 모듈에 강제돼 있고,
이 테스트는 그 관용 매핑(_gpick)이 후보·대체 키 양쪽에서 동작함을 고정한다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "etl"))

from ingest_gov24 import _gpick, _region_of, normalize_row  # noqa: E402


_ROW = {
    "서비스ID": "SVC000001",
    "서비스명": "출산 축하금 지원",
    "서비스목적요약": "출산 가정의 경제적 부담 완화",
    "지원대상": "관내 출생아 부모",
    "선정기준": "신청일 기준 관내 주민등록",
    "지원내용": "출생아 1인당 100만원 지급",
    "신청방법": "주민센터 방문",
    "신청기한": "출생 후 60일 이내",
    "상세조회URL": "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/SVC000001",
    "소관기관명": "경기도 성남시",
    "전화문의": "031-000-0000",
}


def test_normalize_row_maps_core_fields():
    p = normalize_row(dict(_ROW))
    assert p["name"] == "출산 축하금 지원"
    assert "100만원" in p["benefit"]
    assert p["id"].startswith("LOC-B24")  # 경기도 소관 → 지자체(LOC) + B24 네임스페이스
    assert "신청기한: 출생 후 60일 이내" in p["application"]
    assert p["contact"] == "031-000-0000"


def test_gpick_uses_alternate_keys():
    row = {"서비스아이디": "X1", "서비스이름": "이름대체키"}
    assert _gpick(row, "서비스ID", "서비스아이디") == "X1"
    assert _gpick(row, "서비스명", "서비스이름") == "이름대체키"
    assert _gpick(row, "없는키") == ""


def test_region_detection_central_vs_local():
    assert _region_of("보건복지부") == ""
    assert _region_of("서울특별시 강남구") == "서울특별시"
    central = normalize_row({**_ROW, "소관기관명": "고용노동부"})
    assert central["id"].startswith("GOV-B24")


def test_missing_fields_stay_honest():
    """응답에 없는 필드는 요약/기본 안내로만 채우고 수치를 지어내지 않는다."""
    p = normalize_row({"서비스명": "이름만 있는 서비스"})
    assert p["name"] == "이름만 있는 서비스"
    assert "만원" not in p["benefit"]  # 금액 날조 없음
    assert p["required_docs"] == []
