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

# 질의에서 변별력 없는 일반어 — 이게 랭킹을 오염시켜(모든 문서에 매칭) 핵심어를 묻는다.
_STOPWORDS = {
    "지원", "혜택", "복지", "정책", "사업", "서비스", "받을", "받고", "받는", "받을수", "있는",
    "있나", "있을까", "있어", "없어", "알려줘", "알려주세요", "싶어", "싶은", "해줘", "주세요",
    "관련", "대한", "무엇", "어떤", "어떻게", "도움", "가능", "필요", "정보", "저는", "제가",
    "수", "는데", "은데", "니까", "어서", "아서", "그리고", "그런데", "하는", "위한", "위해",
}

# 출처별 가중치 — 일반 질의에선 전국 단위(검증 시드·중앙부처)를 특정 지역 사업보다 우선.
# (강한 지역 키워드 매칭이면 s가 커서 지자체도 올라올 수 있어 지역 특화 질의는 보존)
def _source_weight(pid: str) -> float:
    p = str(pid or "")
    if p.startswith(("POL", "PRV", "HOU", "SUP", "FIN")):
        return 1.25  # 검증 시드(전국·정밀 텍스트)
    if p.startswith("GOV"):
        return 1.05  # 중앙부처
    if p.startswith("LOC"):
        return 0.72  # 지자체(특정 지역) — 일반 질의에선 후순위
    return 0.9


# 한국어 조사 — "장애가/소득은/주거를"처럼 붙으면 별개 토큰이 되어 검색을 오염시킨다.
# 3글자 이상 어절의 끝 조사만 제거해 어간을 얻는다(2글자 단어 '국가·평가·물가' 등은 보존).
_JOSA = set("은는가을를에의도만")


def _stem(run: str) -> str:
    if len(run) >= 3 and run[-1] in _JOSA:
        return run[:-1]
    return run


def _tokenize(text: str) -> list[str]:
    toks: list[str] = []
    for run in _TOKEN_RE.findall((text or "").lower()):
        if run.isascii():
            toks.append(run)
        else:  # 한글: 조사 제거한 어간 + 문자 2-그램(부분일치 대응)
            run = _stem(run)
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
    # 불용어 제거 후 질의 토큰. (전부 불용어면 원본 유지 — 빈 질의 방지)
    q_tokens = {t for t in _tokenize(query) if t not in _STOPWORDS} or set(_tokenize(query))
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
            scored.append((s * _source_weight(catalog[idx].get("id")), idx))
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
