import os
import sys

# Mock 모드 강제 설정 (ANTHROPIC_API_KEY 미설정 → is_mock_mode() == True)
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["CHROMA_PERSIST_DIR"] = "/tmp/test_chroma_db"

# 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
