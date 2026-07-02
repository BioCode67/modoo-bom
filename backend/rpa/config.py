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
    """이 백엔드에서 RPA를 실행해도 되는지."""
    v = os.getenv("RPA_ENABLED", "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    if os.getenv("RPA_DISABLED", "").strip():
        return False
    # 클라우드로 감지되면 기본 비활성(개인정보 서버 유입 방지 + headed 불가)
    if any(os.getenv(m) for m in _CLOUD_MARKERS):
        return False
    # 로컬: Playwright(+브라우저)가 있어야 실제 RPA 가능
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        return False


def rpa_disabled_reason() -> str:
    """RPA 비활성 사유(사용자 안내용)."""
    return (
        "이 서버(클라우드 상시배포)에서는 서류 자동발급·자동신청 RPA를 실행하지 않습니다. "
        "본인인증(카카오/공동인증)과 개인정보 보호를 위해, RPA는 사용자 PC의 로컬 에이전트에서만 동작합니다. "
        "지금은 공식 신청 링크로 안내해 드립니다."
    )
