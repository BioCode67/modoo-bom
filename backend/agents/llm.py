"""AI 제공자 추상화 — 환경변수로 무료 티어 LLM을 자동 선택.

우선순위(키가 있는 것을 자동 선택): Google Gemini → Groq → Anthropic Claude.
아무 키도 없으면 None 을 반환 → 각 노드/챗봇은 규칙기반 폴백(mock_responses)으로 동작한다.
`AI_PROVIDER` 환경변수로 강제 지정 가능(gemini|groq|anthropic).

무료 티어 메모:
  - Gemini: aistudio.google.com 에서 무료 키 발급, 넉넉한 무료 쿼터. 기본 모델 gemini-2.5-flash
    (2.0-flash는 일부 신규 프로젝트에서 무료 할당량 0 → 2.5-flash로 기본값 상향). GEMINI_MODEL로 변경 가능.
  - Groq: console.groq.com 무료 키, 매우 빠름. 기본 모델 llama-3.3-70b-versatile.
개인정보는 프롬프트에 최소한만 담고 서버에 저장/로깅하지 않는다(호출 후 폐기).
"""
from __future__ import annotations
import os

_PROVIDER_KEY = {
    "gemini": "GEMINI_API_KEY",
    "google": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


def _has_key(env_name: str) -> bool:
    v = os.getenv(env_name, "").strip()
    return bool(v) and v.lower() != "mock"


def active_provider() -> str | None:
    """현재 사용할 provider 이름(없으면 None → 규칙기반 폴백)."""
    forced = os.getenv("AI_PROVIDER", "").strip().lower()
    if forced:
        key = _PROVIDER_KEY.get(forced)
        if key and _has_key(key):
            return "gemini" if forced == "google" else forced
        # 강제 지정했는데 키가 없으면 자동 감지로 폴백
    if _has_key("GEMINI_API_KEY"):
        return "gemini"
    if _has_key("GROQ_API_KEY"):
        return "groq"
    if _has_key("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


def provider_label() -> str:
    """헬스체크/로그 표시용."""
    p = active_provider()
    if not p:
        return "rule-based(폴백)"
    model = {
        "gemini": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "groq": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "anthropic": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
    }[p]
    return f"{p}:{model}"


def get_chat_llm(temperature: float = 0.0, max_tokens: int = 1024):
    """선택된 provider의 LangChain 챗 모델 반환. 키 없거나 패키지 미설치 시 None.

    호출부는 반환값이 None이면 규칙기반 폴백을 쓴다(항상 동작 보장).
    """
    provider = active_provider()
    # 무료 티어 LLM은 지연·오류가 잦다 → 타임아웃·재시도로 노드가 무한 대기하지 않게(호출부는 실패 시 규칙 폴백).
    timeout = int(os.getenv("LLM_TIMEOUT", "20"))
    retries = int(os.getenv("LLM_MAX_RETRIES", "1"))
    try:
        if provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                temperature=temperature,
                max_output_tokens=max_tokens,
                google_api_key=os.getenv("GEMINI_API_KEY"),
                timeout=timeout,
                max_retries=retries,
            )
        if provider == "groq":
            from langchain_groq import ChatGroq
            return ChatGroq(
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
                max_retries=retries,
            )
        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
                max_retries=retries,
            )
    except ImportError as e:
        from logging_config import get_logger
        get_logger("llm").warning("provider '%s' 패키지 미설치 → 규칙기반 폴백: %s", provider, e)
        return None
    return None
