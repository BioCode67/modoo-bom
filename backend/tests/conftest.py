import os
import sys

# Mock 모드 강제 설정
os.environ["OPENAI_API_KEY"] = "mock"
os.environ["CHROMA_PERSIST_DIR"] = "/tmp/test_chroma_db"

# 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
