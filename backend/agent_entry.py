"""PyInstaller 진입점 — 모두봄 로컬 에이전트 단일 실행파일.

빌드된 exe를 더블클릭하면: 로컬 에이전트(localhost:8000) 기동 → 브라우저 자동 오픈.
프론트(dist-app)는 실행파일에 번들되어 동일 출처로 서빙된다 → CORS/권한 프롬프트 0.
"""
import os
import sys
import threading
import time
import webbrowser


def _open_browser_when_ready():
    """서버가 뜨면 기본 브라우저로 앱을 연다(최대 15초 대기)."""
    import urllib.request
    port = os.environ.get("PORT", "8000")
    url = f"http://127.0.0.1:{port}/"
    for _ in range(30):  # 최대 ~15초
        try:
            urllib.request.urlopen(url + "api/health", timeout=1)
            webbrowser.open(url)  # 서버가 실제로 떴을 때만 연다(죽은 페이지 오픈 방지)
            return
        except Exception:
            time.sleep(0.5)
    # 15초 내 안 뜨면 브라우저를 열지 않는다 — 콘솔 배너의 URL로 안내되며, 창을 열어봤자 연결 거부 화면만 뜬다.
    print(f"[모두봄] 서버 기동이 지연되고 있어요. 잠시 후 브라우저에서 {url} 을 직접 열어보세요.")


def main():
    # 로컬 설치본 기본값: RPA 활성 + 시스템 크롬 사용(정부 사이트 안티매크로에 강함).
    os.environ.setdefault("RPA_ENABLED", "1")
    os.environ.setdefault("RPA_BROWSER_CHANNEL", "chrome")
    os.environ.setdefault("HOST", "127.0.0.1")
    os.environ.setdefault("PORT", "8000")
    threading.Thread(target=_open_browser_when_ready, daemon=True).start()
    import local_server
    local_server.main()


if __name__ == "__main__":
    main()
