"""경량 BM25 키워드 검색 — 임베딩/sentence-transformers 불필요(저메모리 배포용).

Render 무료(512MB)처럼 메모리가 빠듯한 환경에서 ChromaDB+신경망 임베딩을 올리면 OOM 위험이 있다.
이 모듈은 실데이터 카탈로그(policies.json)를 인메모리로 BM25 색인해, 외부 의존성 없이 검색한다.
한국어는 공백 토큰 + 문자 2-그램을 함께 써서 형태소 분석 없이도 부분일치를 잡는다.
"""
from __future__ import annotations
import json
import math
import re
from functools import lru_cache

from .catalog_loader import load_catalog, policy_to_document

_TOKEN_RE = re.compile(r"[0-9a-zA-Z]+|[가-힣]+")


def _tokenize(text: str) -> list[str]:
    toks: list[str] = []
    for run in _TOKEN_RE.findall((text or "").lower()):
        if run.isascii():
            toks.append(run)
        else:  # 한글: 단어 + 문자 2-그램(부분일치 대응)
            toks.append(run)
            for i in range(len(run) - 1):
                toks.append(run[i:i + 2])
    return toks


@lru_cache(maxsize=1)
def _index():
    """카탈로그 → (정책 리스트, 문서별 토큰빈도, df, avgdl). 최초 1회 계산 후 캐시."""
    catalog = load_catalog()
    docs_tf: list[dict] = []
    df: dict[str, int] = {}
    total_len = 0
    for p in catalog:
        toks = _tokenize(policy_to_document(p))
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        docs_tf.append(tf)
        total_len += len(toks)
        for t in tf:
            df[t] = df.get(t, 0) + 1
    avgdl = (total_len / len(catalog)) if catalog else 0.0
    return catalog, docs_tf, df, avgdl


def search_policies(query: str, n_results: int = 5, k1: float = 1.5, b: float = 0.75) -> list:
    """BM25 상위 n건을 embedder.search_policies와 동일한 형태로 반환."""
    catalog, docs_tf, df, avgdl = _index()
    if not catalog:
        return []
    N = len(catalog)
    q_tokens = set(_tokenize(query))
    scored: list[tuple[float, int]] = []
    for idx, tf in enumerate(docs_tf):
        dl = sum(tf.values()) or 1
        s = 0.0
        for t in q_tokens:
            f = tf.get(t)
            if not f:
                continue
            idf = math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / (avgdl or 1)))
        if s > 0:
            scored.append((s, idx))
    scored.sort(reverse=True)
    top = scored[:n_results]
    maxs = top[0][0] if top else 1.0
    out = []
    for s, idx in top:
        p = catalog[idx]
        out.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "category": p.get("category"),
            "target": p.get("target"),
            "benefit": p.get("benefit", ""),
            "eligibility": p.get("eligibility", ""),
            "department": p.get("department"),
            "renewal": p.get("renewal", ""),
            "required_docs": p.get("required_docs") or [],
            "application": p.get("application", ""),
            "document": policy_to_document(p),
            "similarity_score": round(s / maxs, 4) if maxs else 0.0,
        })
    return out
