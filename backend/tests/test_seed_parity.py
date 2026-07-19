"""프론트 시드(policies.ts, 2026 검증본) ↔ 백엔드 미러(sample_data.py) 패리티 고정.

2026-07-19 실측: 백엔드 미러가 2025 수치(국취제 50만·청년월세 12개월·문화누리 13만 등)에
머물러 60건이 어긋나 있었다 — 클라우드 챗/RAG 답변이 낡은 금액을 말하게 되는 실결함.
프론트가 공식 출처 검증을 받는 단일 진실이므로, 이름이 정확히 일치하는 정책은
benefit 문구가 반드시 같아야 한다(공백 무시). 새 드리프트가 생기면 이 테스트가 막는다.
"""
import re
from pathlib import Path

from rag.sample_data import WELFARE_POLICIES

_TS_PATH = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "data" / "policies.ts"


def _frontend_benefits() -> dict:
    ts = _TS_PATH.read_text(encoding="utf-8")
    fe = {}
    for m in re.finditer(r"name: '([^']+)',[\s\S]{0,400}?benefit: '([^']*)'", ts):
        fe.setdefault(m.group(1), m.group(2))
    return fe


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def test_frontend_backend_benefit_parity():
    fe = _frontend_benefits()
    assert len(fe) >= 100, "policies.ts 파싱 실패(구조 변경?) — 정규식 갱신 필요"
    drift = [
        (p["name"], p["benefit"], fe[p["name"]])
        for p in WELFARE_POLICIES
        if p["name"] in fe and _norm(p["benefit"]) != _norm(fe[p["name"]])
    ]
    assert not drift, (
        "프론트↔백엔드 benefit 드리프트 — sample_data.py를 프론트 검증본으로 맞추세요:\n"
        + "\n".join(f"· {n}\n   BE: {b[:80]}\n   FE: {f[:80]}" for n, b, f in drift[:10])
    )


def test_backend_has_no_stale_2025_figures():
    """과거 회귀가 재발하기 쉬운 대표 수치 스팟체크(2026 공식 검증값)."""
    by_name = {p["name"]: p for p in WELFARE_POLICIES}
    checks = [
        ("국민취업지원제도 I 유형", "월 60만원"),        # 2026 인상(50→60)
        ("기초연금", "349,700"),                        # 2026 기준연금액
        ("첫만남이용권", "출생 후 2년"),                 # 사용기한 1년→2년
        ("긴급복지지원 생계지원", "78만원"),             # 1인 783,000
    ]
    for name, needle in checks:
        p = by_name.get(name)
        if p is None:
            continue  # 이름 개편 시 파리티 테스트가 잡는다
        blob = p["benefit"] + p.get("eligibility", "") + p.get("renewal", "")
        assert needle in blob, f"{name}: 2026 검증값 '{needle}' 누락 — 낡은 수치 회귀 의심"


def test_ws_enrich_keeps_non_seed_fields():
    """시드에 없는 정책(GOV- 등)의 benefit/application이 보강 과정에서 지워지지 않는다."""
    from api.websocket import enrich_from_seed

    out = enrich_from_seed([
        {"id": "GOV-WLF999", "name": "공공데이터 정책", "benefit": "월 10만원", "application": "https://x"},
        {"id": "POL-001", "name": "기초연금", "benefit": ""},
    ])
    assert out[0]["benefit"] == "월 10만원" and out[0]["application"] == "https://x"
    assert "349,700" in out[1]["benefit"]  # 시드 항목은 시드 값으로 보강
