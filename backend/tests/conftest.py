import importlib.util
import os
import sys

# Mock 모드 강제 설정 (ANTHROPIC_API_KEY 미설정 → is_mock_mode() == True)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["CHROMA_PERSIST_DIR"] = "/tmp/test_chroma_db"

# 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ── 부분 의존성 환경 방탄(감사·정직성) ──────────────────────────────────────────
# 문제: requirements.txt 전체가 아닌 '부분 의존성' 환경(개발 컨테이너 등)에서 무거운 선택적 의존성
#   (chromadb·langgraph·dotenv 등)이 없으면, 그 의존성을 import 하는 테스트 모듈 하나가 '수집 에러'로
#   전체 게이트를 Interrupted 시켜(~330 게이트 붕괴) 나머지 300여 테스트도 못 돌린다(이 세션에서 실측).
# 해결: 그 모듈만 '깨끗한 건너뜀'으로 만든다. ⚠️ 정직성 — ① 전체 의존성이 있으면 이 훅은 완전 무동작
#   (무손실·무오버헤드), ② '선택적'으로 명시한 의존성 부재일 때만 건너뛴다(진짜 로직 결함은 그대로 노출),
#   ③ 무엇을 왜 건너뛰는지 출력한다(조용한 truncation 금지).
_OPTIONAL_DEPS = {
    "chromadb", "langgraph", "langchain", "langchain_core", "langchain_anthropic",
    "langchain_google_genai", "langchain_groq", "langchain_community",
    "dotenv", "playwright", "multipart",
}
# 전체 의존성 환경이면(선택적 의존성이 전부 존재) 프로빙 자체를 하지 않는다 — CI·개발 게이트 무영향.
_ANY_OPTIONAL_MISSING = any(importlib.util.find_spec(d) is None for d in _OPTIONAL_DEPS)


def pytest_ignore_collect(collection_path, config):
    """선택적 무거운 의존성이 없어 import 조차 안 되는 테스트 모듈을 수집 에러 대신 조용히 건너뛴다.
    전체 의존성 환경에선 아무것도 건너뛰지 않는다(무손실)."""
    if not _ANY_OPTIONAL_MISSING:
        return None
    name = os.path.basename(str(collection_path))
    if not (name.startswith("test_") and name.endswith(".py")):
        return None
    stem = name[:-3]
    if stem in sys.modules:  # 이미 로드됨 — 정상 수집
        return None
    spec = importlib.util.spec_from_file_location(stem, str(collection_path))
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[stem] = module  # pytest 재import 시 캐시 히트(이중 실행 방지)
    try:
        spec.loader.exec_module(module)
        return None  # import 성공 → pytest 가 캐시된 모듈로 정상 수집
    except ModuleNotFoundError as exc:
        sys.modules.pop(stem, None)
        missing = (exc.name or "").split(".")[0]
        if missing in _OPTIONAL_DEPS:
            print(f"[conftest] {name} 수집 건너뜀 — 선택적 의존성 '{missing}' 미설치(부분 환경). "
                  f"전체 의존성(requirements.txt) 설치 시 정상 수집됩니다.")
            return True
        raise  # 선택적이 아닌 결함은 숨기지 않고 그대로 수집 에러로 드러낸다
    except Exception:
        sys.modules.pop(stem, None)
        return None  # 다른 예외는 pytest 정상 경로가 보고하게 둔다
