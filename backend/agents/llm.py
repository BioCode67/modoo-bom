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


_PRIORITY = ("gemini", "groq", "anthropic")


def _model_for(provider: str) -> str:
    return {
        "gemini": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "groq": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "anthropic": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
    }[provider]


def available_providers() -> list[str]:
    """키가 있는 provider를 우선순위(Gemini→Groq→Anthropic)대로. AI_PROVIDER 강제 시 그것만."""
    forced = os.getenv("AI_PROVIDER", "").strip().lower()
    if forced:
        name = "gemini" if forced == "google" else forced
        key = _PROVIDER_KEY.get(name)
        if key and _has_key(key):
            return [name]
        # 강제 지정했는데 키가 없으면 자동 감지로 폴백
    return [p for p in _PRIORITY if _has_key(_PROVIDER_KEY[p])]


def provider_label() -> str:
    """헬스체크/로그 표시용 — 주 provider + 폴백 체인."""
    provs = available_providers()
    if not provs:
        return "rule-based(폴백)"
    label = f"{provs[0]}:{_model_for(provs[0])}"
    if len(provs) > 1:
        label += " (+" + "→".join(provs[1:]) + " 폴백)"
    return label


def _build_provider(provider: str, temperature: float, max_tokens: int):
    """특정 provider의 LangChain 챗 모델 생성(패키지 미설치·키 문제 시 예외)."""
    # 무료 티어 LLM은 지연·오류가 잦다 → 타임아웃·재시도로 노드가 무한 대기하지 않게.
    timeout = int(os.getenv("LLM_TIMEOUT", "20"))
    retries = int(os.getenv("LLM_MAX_RETRIES", "1"))
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=_model_for("gemini"), temperature=temperature,
            max_output_tokens=max_tokens, google_api_key=os.getenv("GEMINI_API_KEY"),
            timeout=timeout, max_retries=retries,
        )
    if provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            model=_model_for("groq"), temperature=temperature,
            max_tokens=max_tokens, timeout=timeout, max_retries=retries,
        )
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=_model_for("anthropic"), temperature=temperature,
            max_tokens=max_tokens, timeout=timeout, max_retries=retries,
        )
    return None


class FallbackChatLLM:
    """여러 provider를 우선순위대로 시도 — 하나가 실패(쿼터 429·오류·패키지 미설치)하면
    자동으로 다음 provider로 넘어간다. 시연 중 Gemini 쿼터가 바닥나도 Groq로 이어져 끊기지 않음.
    호출부가 쓰는 .ainvoke()/.invoke() 인터페이스만 노출한다(전 provider 실패 시 예외 → 규칙 폴백)."""

    def __init__(self, temperature: float = 0.0, max_tokens: int = 1024):
        self.temperature = temperature
        self.max_tokens = max_tokens
        self._clients: dict = {}

    def _client(self, provider: str):
        if provider not in self._clients:
            try:
                self._clients[provider] = _build_provider(provider, self.temperature, self.max_tokens)
            except Exception as e:  # noqa: BLE001 (패키지 미설치 등 → 이 provider 스킵)
                from logging_config import get_logger
                get_logger("llm").warning("provider '%s' 빌드 실패 → 스킵: %s", provider, e)
                self._clients[provider] = None
        return self._clients[provider]

    async def ainvoke(self, messages):
        last = None
        for p in available_providers():
            client = self._client(p)
            if client is None:
                continue
            try:
                return await client.ainvoke(messages)
            except Exception as e:  # noqa: BLE001
                last = e
                from logging_config import get_logger
                get_logger("llm").warning("provider '%s' 호출 실패 → 다음 provider 시도: %s", p, str(e)[:200])
        raise last if last else RuntimeError("사용 가능한 AI provider 없음")

    def invoke(self, messages):
        last = None
        for p in available_providers():
            client = self._client(p)
            if client is None:
                continue
            try:
                return client.invoke(messages)
            except Exception as e:  # noqa: BLE001
                last = e
                from logging_config import get_logger
                get_logger("llm").warning("provider '%s' 호출 실패 → 다음 provider 시도: %s", p, str(e)[:200])
        raise last if last else RuntimeError("사용 가능한 AI provider 없음")


def get_chat_llm(temperature: float = 0.0, max_tokens: int = 1024):
    """폴백 지원 챗 모델 반환. 키가 하나도 없으면 None(호출부는 규칙기반 폴백).

    반환 객체는 .ainvoke()/.invoke() 호출 시 provider를 우선순위대로 시도한다.
    """
    if not available_providers():
        return None
    return FallbackChatLLM(temperature, max_tokens)
