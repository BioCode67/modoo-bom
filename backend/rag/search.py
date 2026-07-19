"""RAG 검색 디스패처 — 환경에 따라 ChromaDB(임베딩) 또는 경량 BM25 선택.

- 기본(로컬/충분한 메모리): ChromaDB + sentence-transformers 임베딩(의미 검색).
- 경량 모드(RAG_LIGHT=1 또는 클라우드 감지): BM25 키워드 검색(임베딩 미로드 → 저메모리).
  Render 무료 512MB 등에서 OOM을 피한다.

모든 소비처(policy_search 노드 · /api/search · 챗봇)는 이 모듈의 search_policies를 쓴다.
"""
from __future__ import annotations
import os

_CLOUD_MARKERS = ("RENDER", "DYNO", "K_SERVICE", "FLY_APP_NAME", "AWS_EXECUTION_ENV")


def rag_light() -> bool:
    """경량(BM25) 모드 여부."""
    v = os.getenv("RAG_LIGHT", "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    # 명시 설정이 없으면 클라우드에서 자동 경량화(메모리 보호)
    return any(os.getenv(m) for m in _CLOUD_MARKERS)


def backend_label() -> str:
    return "bm25(경량)" if rag_light() else "hybrid(bm25+임베딩 RRF)"


def _rrf_merge(bm25_hits: list, chroma_hits: list, n_results: int,
               k: int = 20, w_bm25: float = 1.0, w_chroma: float = 0.6) -> list:
    """가중 Reciprocal Rank Fusion — BM25 주도 + 임베딩 보강.

    ChromaDB 기본 임베딩(all-MiniLM-L6-v2)은 영어 최적화라 한국어 자연어 질의에서
    무관 정책을 상위로 올리는 게 실측됐다('기초연금 누가 받을 수 있어?' → 직업훈련생계비대부).
    BM25는 같은 질의에서 기초연금을 2위로 랭크 → 한국어 키워드 신호(BM25)를 주(1.0)로,
    임베딩 유사도는 보강(0.6)으로 융합한다. 양쪽에 모두 잡힌 정책이 자연히 최상위."""
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}
    for weight, hits in ((w_bm25, bm25_hits), (w_chroma, chroma_hits)):
        for rank, p in enumerate(hits):
            key = str(p.get("id") or p.get("name") or rank)
            scores[key] = scores.get(key, 0.0) + weight / (k + rank + 1)
            # 필드가 풍부한 쪽(bm25는 benefit·eligibility 포함)을 대표 항목으로 유지
            if key not in items or len(p) > len(items[key]):
                items[key] = p
    top = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:n_results]
    max_s = (w_bm25 + w_chroma) / (k + 1)  # 양쪽 1위를 동시에 차지했을 때
    out = []
    for key, s in top:
        p = dict(items[key])
        p["similarity_score"] = round(min(1.0, s / max_s), 4)
        out.append(p)
    return out


def search_policies(query: str, n_results: int = 5) -> list:
    if rag_light():
        from .bm25_search import search_policies as _bm25
        return _bm25(query, n_results)
    # 하이브리드: 임베딩(chromadb) + BM25 가중 RRF. BM25 실패 시 임베딩 단독 폴백.
    from .embedder import search_policies as _chroma
    chroma_hits = _chroma(query, n_results)
    try:
        from .bm25_search import search_policies as _bm25
        bm25_hits = _bm25(query, n_results)
    except Exception:
        bm25_hits = []
    if not bm25_hits:
        return chroma_hits
    return _rrf_merge(bm25_hits, chroma_hits, n_results)


def seed() -> tuple[int, str]:
    """시딩(경량 모드에선 임베딩 시딩 스킵 — BM25는 런타임 인메모리 색인).

    임베딩(ChromaDB) 모드는 **전체 공공데이터 카탈로그(약 5,061건)** 를 색인한다(감사 반영).
    과거엔 sample_data 131건만 임베딩해 RAG가 실데이터를 몰랐음 → seed_from_catalog로 교체.
    메모리 제약 배포는 RAG_MAX_DOCS로 상한(예: 800). 실패 시 sample_data로 폴백해 최소 동작 보장."""
    if rag_light():
        from .catalog_loader import load_catalog
        return len(load_catalog()), "bm25"
    try:
        from .seed_from_catalog import seed_from_catalog
        limit = int(os.getenv("RAG_MAX_DOCS", "0")) or None
        return seed_from_catalog(limit=limit), "chromadb(catalog)"
    except Exception as e:
        print(f"[rag.seed] 카탈로그 시딩 실패 → sample_data 폴백: {e}")
        from .embedder import seed_chromadb
        return seed_chromadb(), "chromadb(sample)"


def warmup() -> None:
    if rag_light():
        from .bm25_search import _index
        _index()  # 색인 미리 구축
        return
    from .embedder import warmup as _w
    _w()
