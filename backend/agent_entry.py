"""PyInstaller 진입점 — 모두봄 로컬 에이전트 단일 실행파일.

빌드된 exe를 더블클릭하면: 로컬 에이전트(localhost:8000) 기동 → 브라우저 자동 오픈.
프론트(dist-app)는 실행파일에 번들되어 동일 출처로 서빙된다 → CORS/권한 프롬프트 0.
"""
import os


def main():
    # 로컬 설치본 기본값: RPA 활성 + 시스템 크롬 사용(정부 사이트 안티매크로에 강함).
    os.environ.setdefault("RPA_ENABLED", "1")
    os.environ.setdefault("RPA_BROWSER_CHANNEL", "chrome")
    os.environ.setdefault("HOST", "127.0.0.1")
    os.environ.setdefault("PORT", "8000")
    # 브라우저 자동 오픈은 local_server.main()이 서버 준비 후 한 번만 처리(중복 오픈 방지).
    import local_server
    local_server.main()


if __name__ == "__main__":
    main()
