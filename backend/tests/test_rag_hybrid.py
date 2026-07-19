"""RAG 하이브리드(RRF)·시딩 멱등성 회귀 테스트.

2026-07-19 확정 결함/개선 고정:
- 콜드스타트: PersistentClient에 색인이 있어도 매 부팅 전체 재임베딩(수 분 블록) → 건수 기반 스킵
- 검색 품질: 영어 최적 임베딩이 한국어 질의에서 무관 정책을 상위로 → BM25 주도 가중 RRF
"""
import os

import pytest

from rag.search import _rrf_merge


def _hit(pid, name, extra=None):
    d = {"id": pid, "name": name, "similarity_score": 0.5}
    d.update(extra or {})
    return d


def test_rrf_overlap_ranks_first():
    """양쪽 랭킹에 모두 잡힌 정책이 한쪽 1위보다 위로 온다."""
    bm25 = [_hit("A", "기초연금"), _hit("B", "노인일자리")]
    chroma = [_hit("C", "직업훈련"), _hit("A", "기초연금")]
    out = _rrf_merge(bm25, chroma, 3)
    assert out[0]["id"] == "A"


def test_rrf_bm25_weighted_above_chroma_at_same_rank():
    """같은 순위면 BM25 쪽(한국어 신호)이 임베딩 쪽보다 우선한다(가중 1.0 vs 0.6)."""
    bm25 = [_hit("K", "한국어매치")]
    chroma = [_hit("E", "영어임베딩매치")]
    out = _rrf_merge(bm25, chroma, 2)
    assert [p["id"] for p in out] == ["K", "E"]


def test_rrf_keeps_richer_item_and_caps_score():
    """중복 정책은 필드가 풍부한 쪽(benefit 등 포함)을 대표로, 점수는 1.0 상한."""
    bm25 = [_hit("A", "기초연금", {"benefit": "월 34만원", "eligibility": "65세+"})]
    chroma = [_hit("A", "기초연금")]
    out = _rrf_merge(bm25, chroma, 1)
    assert out[0]["benefit"] == "월 34만원"
    assert 0 < out[0]["similarity_score"] <= 1.0


def test_rrf_dedup_by_id():
    """동일 id는 한 번만 나온다."""
    bm25 = [_hit("A", "기초연금"), _hit("B", "b")]
    chroma = [_hit("A", "기초연금"), _hit("C", "c")]
    out = _rrf_merge(bm25, chroma, 5)
    assert [p["id"] for p in out].count("A") == 1
    assert len(out) == 3


class _FakeCollection:
    def __init__(self, count):
        self._count = count
        self.upserts = []

    def count(self):
        return self._count

    def upsert(self, **kw):
        self.upserts.append(kw)


class _FakeEmbedFn:
    def __call__(self, docs):
        return [[0.0] * 4 for _ in docs]


@pytest.fixture
def _fake_catalog(monkeypatch):
    catalog = [{"id": f"P{i}", "name": f"정책{i}"} for i in range(10)]
    import rag.seed_from_catalog as sfc
    monkeypatch.setattr(sfc, "load_catalog", lambda: list(catalog))
    monkeypatch.setattr(sfc, "policy_to_document", lambda p: p["name"])
    monkeypatch.setattr(sfc, "policy_to_metadata", lambda p: {"id": p["id"]})
    import chromadb.utils.embedding_functions as ef
    monkeypatch.setattr(ef, "DefaultEmbeddingFunction", _FakeEmbedFn)
    return catalog


def test_seed_skips_when_already_indexed(_fake_catalog, monkeypatch):
    """기존 색인 건수 ≥ 카탈로그면 재임베딩 없이 즉시 반환(콜드스타트 블록 방지)."""
    import rag.seed_from_catalog as sfc
    col = _FakeCollection(count=10)
    monkeypatch.setattr(sfc, "get_collection", lambda name=None: col)
    monkeypatch.delenv("RAG_RESEED", raising=False)
    assert sfc.seed_from_catalog() == 10
    assert col.upserts == []  # 임베딩·upsert가 아예 안 돌았다


def test_seed_reseeds_when_forced_or_stale(_fake_catalog, monkeypatch):
    """RAG_RESEED=1 이거나 색인이 부족하면 전체 시딩이 돈다."""
    import rag.seed_from_catalog as sfc
    stale = _FakeCollection(count=3)  # 카탈로그 10 > 색인 3 → 시딩
    monkeypatch.setattr(sfc, "get_collection", lambda name=None: stale)
    monkeypatch.delenv("RAG_RESEED", raising=False)
    assert sfc.seed_from_catalog() == 10
    assert stale.upserts, "부족 색인인데 시딩이 안 돌았다"

    full = _FakeCollection(count=10)
    monkeypatch.setattr(sfc, "get_collection", lambda name=None: full)
    monkeypatch.setenv("RAG_RESEED", "1")
    assert sfc.seed_from_catalog() == 10
    assert full.upserts, "RAG_RESEED=1인데 재시딩이 안 돌았다"
