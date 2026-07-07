"""RPA 실행 게이팅 — 로컬 에이전트 전용.

서류 자동발급/자동신청 RPA는 (1) 카카오/공동인증 본인인증을 위해 headed 브라우저가 필요하고,
(2) 사용자의 개인정보(생년월일·연락처 등)를 다루므로 **사용자 PC의 로컬 에이전트에서만** 실행한다.
클라우드 상시배포(Render 등)에서는 자동 비활성화 → 개인정보가 서버로 유입되지 않는다.

개인정보 원칙: 프로필/인증정보는 메모리에서만 사용하고 서버에 저장·로깅하지 않는다.
발급된 본인 서류는 로컬 에이전트가 도는 사용자 PC에만 저장된다(서버 아님).
"""
from __future__ import annotations
import os

# 클라우드 플랫폼이 주입하는 대표 환경변수(있으면 서버 실행으로 간주)
_CLOUD_MARKERS = ("RENDER", "DYNO", "K_SERVICE", "FLY_APP_NAME", "AWS_EXECUTION_ENV")


def rpa_enabled() -> bool:
    """이 백엔드에서 RPA를 실행해도 되는지 — **명시적 opt-in(RPA_ENABLED=1)일 때만 True (fail-closed)**.

    ⚠️ 보안: 과거엔 클라우드 마커가 없으면 playwright 설치만으로 기본 활성(fail-open)이라, 마커 목록에
    없는 호스트(순수 VM·Azure·Railway·마커 없는 도커 등)에 main.py 를 배포하면 RPA 엔드포인트가 공개
    HTTPS 서버에서 켜져, 배포 웹(CORS 허용)이 이름·생년월일·연락처를 서버로 보내고 서버가 headed
    브라우저를 띄우려 하는 개인정보/격리 위반이 발생할 수 있었다.
    → 이제 **명시적 RPA_ENABLED=1** 이 없으면 무조건 False. 로컬 앱(run-local-app.bat·agent_entry·
    local_server.main)은 항상 RPA_ENABLED=1 을 설정하므로 데스크탑 자동발급은 그대로 동작한다.
    """
    v = os.getenv("RPA_ENABLED", "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        # 명시 활성이라도 playwright 미설치면 실제 RPA 불가 → False(launch 단계 크래시 대신 정직한 게이팅).
        try:
            import playwright  # noqa: F401
            return True
        except ImportError:
            return False
    # 그 외(미설정·0/false·RPA_DISABLED·클라우드 마커)는 모두 비활성 — fail-closed.
    return False


def rpa_disabled_reason() -> str:
    """RPA 비활성 사유(사용자 안내용)."""
    return (
        "이 서버(클라우드 상시배포)에서는 서류 자동발급·자동신청 RPA를 실행하지 않습니다. "
        "본인인증(카카오/공동인증)과 개인정보 보호를 위해, RPA는 사용자 PC의 로컬 에이전트에서만 동작합니다. "
        "지금은 공식 신청 링크로 안내해 드립니다."
    )
