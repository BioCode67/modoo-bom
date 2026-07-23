"""🧠 Route memorization(경량) — Skyvern 'code caching' 아이디어의 우리판.

왜: 상위 RPA(Skyvern)의 핵심 성능 기법 — AI가 한 번 성공한 '지목'을 기억해 다음 실행에서 먼저
시도하면 빠르고(추론 생략) 결정론적이며, 실패하면 무효화하고 다시 학습한다.

우리 적용(보수적): 클릭 판단(ai_pick_action)에서 (사이트 host, 목표)별로 '성공한 버튼 라벨'을
기억한다. 다음 실행은 그 라벨을 먼저 시도 → 못 찾으면(사이트 변경 등) 무효화하고 결정론/LLM으로
다시 찾는다.

프라이버시(불변): 버튼 '라벨'만 저장한다 — 입력값·주민번호·이름 같은 개인정보는 절대 담지 않는다.
저장 파일은 사용자 PC 로컬(gitignore, docs_extra.json 과 같은 규약)이며, 손상/비정형은 조용히 무시한다.
env MODOOBOM_ROUTE_CACHE 로 경로 override(테스트·격리). RPA_ROUTE_CACHE=0 이면 전체 무동작.
"""
import json
import os
import pathlib
import threading

_LOCK = threading.Lock()


def _enabled() -> bool:
    return os.environ.get("RPA_ROUTE_CACHE", "1") != "0"


def _path() -> pathlib.Path:
    env = os.environ.get("MODOOBOM_ROUTE_CACHE", "")
    if env:
        return pathlib.Path(env)
    return pathlib.Path(__file__).resolve().parent / "route_cache.json"


def _key(site: str, goal: str) -> str:
    # 라벨 아닌 '어디서·무엇을' 만 키로 — 값/개인정보는 키에도 담기지 않는다.
    return f"{str(site or '').strip()}|{str(goal or '').strip()}"[:200]


def _load() -> dict:
    try:
        d = json.loads(_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save(d: dict) -> None:
    try:
        _path().write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass  # 저장 실패는 무해(다음 실행에 다시 학습) — 부팅/실행 불가침


def get_label(site: str, goal: str) -> str:
    """이 (사이트, 목표)에서 지난번 성공한 버튼 라벨 — 없으면 빈 문자열."""
    if not _enabled():
        return ""
    with _LOCK:
        rec = _load().get(_key(site, goal))
    if isinstance(rec, dict):
        lbl = rec.get("label")
        return str(lbl)[:40] if isinstance(lbl, str) else ""
    return ""


def remember(site: str, goal: str, label: str) -> None:
    """성공한 버튼 라벨을 기억 — 라벨만 저장(개인정보 없음). 인자 부실이면 무동작."""
    if not _enabled():
        return
    label = str(label or "").strip()
    if not (site and goal and label):
        return
    with _LOCK:
        d = _load()
        d[_key(site, goal)] = {"label": label[:40]}
        _save(d)


def forget(site: str, goal: str) -> None:
    """기억한 라벨이 더는 안 맞으면(클릭 실패·요소 사라짐) 무효화 — 다음엔 다시 학습한다."""
    if not _enabled():
        return
    with _LOCK:
        d = _load()
        if d.pop(_key(site, goal), None) is not None:
            _save(d)
