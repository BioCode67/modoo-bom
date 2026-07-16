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
    # 로컬(1인) 사용: 신청 양식 검토 10분 + 로그인 대기까지 여유 있게 — 검토 중 타임아웃으로 창이 닫히지 않게
    os.environ.setdefault("RPA_TASK_TIMEOUT", "1800")
    # 자동첨부 후보 유효창(발급→신청 사이) — 기본 20분은 공용PC 교차유출 방어값. 개인 데스크탑(1인)은
    #   그 위험이 없고 시연 페이스가 느릴 수 있어 1시간으로 늘려, 먼저 발급/등록한 서류가 신청 때
    #   첨부 대상에서 빠지지 않게 한다.
    os.environ.setdefault("RPA_ATTACH_MAX_AGE", "3600")
    # 브라우저 자동 오픈은 local_server.main()이 서버 준비 후 한 번만 처리(중복 오픈 방지).
    import local_server
    local_server.main()


if __name__ == "__main__":
    main()
