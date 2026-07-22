# -*- coding: utf-8 -*-
"""웹 에이전트의 '판단 계층' LLM 구성 — 프로젝트의 provider 키 관례를 그대로 재사용.

우선순위(agents/llm.py 와 동일): Gemini → Groq → Anthropic. 단 웹 에이전트는 화면(스크린샷)을
읽어야 하므로 **비전 지원 모델**을 선호한다(Gemini 2.5 Flash · Claude Sonnet 은 이미지 판독 가능).
Groq(텍스트 전용)만 있으면 비전 없이 텍스트 관찰로 축소 동작한다.

browser-use / 내장 루프 모두 langchain 챗 모델(.ainvoke/.invoke)을 쓴다. 키가 없으면 None →
호출부는 규칙 기반(휴리스틱)으로 폴백한다(에이전트가 멈추지 않게).
개인정보는 프롬프트에 최소만 담고 서버에 저장/로깅하지 않는다(프로젝트 전반 원칙).
"""
from __future__ import annotations

import os

# 비전(이미지 판독)을 지원하는 provider — 스크린샷 기반 판단에 쓸 수 있다.
_VISION_PROVIDERS = ("gemini", "anthropic")


def _model_for(provider: str, override: str | None) -> str:
    if override:
        return override
    return {
        # 웹 에이전트 기본은 비전 강한 2.5-flash(있으면 GEMINI_MODEL 존중)
        "gemini": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "groq": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "anthropic": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
    }[provider]


def select_provider(prefer_vision: bool = True) -> str | None:
    """키가 있는 provider 중 하나 선택. 비전이 필요하면 비전 지원 provider를 우선한다.

    agents/llm.py 의 available_providers()(우선순위·AI_PROVIDER 강제 존중)를 재사용한다.
    """
    try:
        from agents.llm import available_providers
    except Exception:  # noqa: BLE001 — 백엔드 밖에서 임포트되는 경우 방어
        return None
    provs = available_providers()
    if not provs:
        return None
    if prefer_vision:
        for p in provs:
            if p in _VISION_PROVIDERS:
                return p
    return provs[0]


def build_agent_llm(model: str | None = None, prefer_vision: bool = True, temperature: float = 0.0):
    """웹 에이전트용 langchain 챗 모델을 만든다(키/패키지 없으면 None).

    반환 객체는 browser-use 및 내장 루프가 그대로 쓸 수 있는 langchain BaseChatModel 이다.
    패키지 미설치·키 없음은 예외가 아니라 None 으로 축소(호출부는 휴리스틱 폴백).
    """
    provider = select_provider(prefer_vision=prefer_vision)
    if provider is None:
        return None
    name = _model_for(provider, model)
    timeout = int(os.getenv("LLM_TIMEOUT", "30"))
    retries = int(os.getenv("LLM_MAX_RETRIES", "1"))
    try:
        if provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=name, temperature=temperature,
                google_api_key=os.getenv("GEMINI_API_KEY"),
                timeout=timeout, max_retries=retries,
            )
        if provider == "groq":
            from langchain_groq import ChatGroq
            return ChatGroq(model=name, temperature=temperature, timeout=timeout, max_retries=retries)
        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=name, temperature=temperature, timeout=timeout, max_retries=retries)
    except Exception:  # noqa: BLE001 — 패키지 미설치/버전 충돌 → 폴백
        return None
    return None
