"""🤖 AI 채움(β) 계약 테스트 — 프라이버시(값 미전송)·게이팅(키/밸브)·계획 파싱·실행 흐름."""
import asyncio
import json
import os

import pytest

from rpa import ai_fill as af


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "RPA_AI_FILL"):
        monkeypatch.delenv(k, raising=False)
    yield


def test_gating_no_key_disabled():
    # 키 없음 → 비활성(조용히 무동작) — 기존 규칙 엔진 흐름 무변화 계약
    assert af.ai_fill_enabled() is False


def test_gating_key_and_valve(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert af.ai_fill_enabled() is True
    monkeypatch.setenv("RPA_AI_FILL", "0")  # 밸브가 키보다 우선
    assert af.ai_fill_enabled() is False


def test_gating_mock_anthropic_key_ignored(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "mock")  # Mock 모드 키는 실호출 불가 — 비활성
    assert af.ai_fill_enabled() is False


def test_parse_plan_tolerant():
    # 마크다운·잡담 섞인 응답에서도 plan만 추출, 미지 키·음수 idx는 버림. 구형(action 없음)은 fill로 승격.
    text = '설명입니다.\n```json\n{"plan": [{"idx": 3, "key": "parent_name"}, {"idx": 1, "key": "없는키"}, {"idx": -1, "key": "rrn7"}]}\n```'
    assert af._parse_plan(text) == [{"action": "fill", "idx": 3, "key": "parent_name"}]
    assert af._parse_plan("json 아님") == []
    assert af._parse_plan("") == []
    # v2 행동 어휘 — click/select 파싱
    text2 = '{"plan": [{"action": "click", "idx": 5}, {"action": "select", "idx": 2, "key": "sido"}]}'
    assert af._parse_plan(text2) == [{"action": "click", "idx": 5},
                                     {"action": "select", "idx": 2, "key": "sido", "option": ""}]


def test_deterministic_semantic_match():
    """🧭 접근성 이름 결정론 매칭(LLM 없이) — 라벨 변형·동의어 흡수, 같은 이름 여럿이면 첫 미사용,
    filled/ro/이름없음/버튼은 제외. API 키 없이도 똑똑하게 칸을 찾는 핵심 계층."""
    fields = [
        {"idx": 0, "role": "textbox", "name": "성명", "filled": False, "ro": False},
        {"idx": 1, "role": "textbox", "name": "주민등록번호", "filled": False, "ro": False},   # 앞자리
        {"idx": 2, "role": "textbox", "name": "주민등록번호", "filled": False, "ro": False},   # 뒷자리(같은 이름)
        {"idx": 3, "role": "textbox", "name": "휴대폰 번호", "filled": False, "ro": False},
        {"idx": 4, "role": "combobox", "name": "시도 선택", "filled": False, "ro": False},
        {"idx": 5, "role": "button", "name": "간편인증"},                                      # 버튼 제외
        {"idx": 6, "role": "textbox", "name": "이메일", "filled": True, "ro": False},          # filled 제외
    ]
    plan = af._deterministic_plan(fields, ["name", "birth6", "phone_tail", "sido"])
    by_key = {p["key"]: p for p in plan}
    assert by_key["name"]["idx"] == 0 and by_key["name"]["action"] == "fill"
    assert by_key["birth6"]["idx"] == 1                       # 첫 '주민등록번호' textbox
    assert by_key["phone_tail"]["idx"] == 3                   # '휴대폰' 동의어 매칭
    assert by_key["sido"]["idx"] == 4 and by_key["sido"]["action"] == "select"  # combobox → select
    # 매칭 없는 키는 계획에 없음, 버튼·filled는 절대 안 잡힘
    assert all(p["idx"] != 5 and p["idx"] != 6 for p in plan)


def test_click_guard_allow_and_deny():
    # 클릭 안전 가드 — 진행성 버튼만 허용, 제출/결제류는 어떤 경우에도 거부(HITL 불변)
    assert af.click_text_allowed("간편인증")
    assert af.click_text_allowed("인증 요청")
    assert af.click_text_allowed("확인")
    assert not af.click_text_allowed("제출")
    assert not af.click_text_allowed("최종 제출")
    assert not af.click_text_allowed("결제하기")
    assert not af.click_text_allowed("신청하기")  # 허용목록 밖 — 골든패스(규칙 엔진)의 몫
    assert not af.click_text_allowed("")


def test_vision_and_click_default_off(monkeypatch):
    # 비전(마스킹 스크린샷)·클릭 행동은 옵트인 — 기본 꺼짐(프라이버시·HITL 보수 기본값)
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert af.vision_enabled() is False
    assert af.clicks_enabled() is False
    monkeypatch.setenv("RPA_AI_VISION", "1")
    monkeypatch.setenv("RPA_AI_CLICK", "1")
    assert af.vision_enabled() is True
    assert af.clicks_enabled() is True


def test_prompt_privacy_contract():
    """⚠️ 핵심 계약: 프롬프트 빌더는 사용자 '값'을 인자로 받지 않는다 — 구조·키 이름만.
    (값이 프롬프트에 들어갈 경로 자체가 없음을 시그니처+내용으로 고정)"""
    fields = [{"idx": 0, "tag": "input", "type": "text", "label": "추가정보확인", "filled": False, "ro": False}]
    p = af.build_prompt(fields, ["parent_name", "phone_tail"], "테스트 화면")
    assert "부 또는 모의 성명" in p and "휴대폰 나머지 번호" in p  # 키 '의미'는 전달
    assert "추가정보확인" in p                                        # 화면 구조는 전달
    import inspect
    assert "values" not in inspect.signature(af.build_prompt).parameters  # 값 인자 자체가 없음


def test_ai_fill_no_key_returns_empty_without_page_access():
    class _Boom:
        async def evaluate(self, *a):  # 키 없으면 페이지 접근조차 없어야 함
            raise AssertionError("키 없이 evaluate 호출됨")
    assert _run(af.ai_fill(_Boom(), _Boom(), {"parent_name": "테스트"})) == {}


def test_ai_fill_executes_plan_with_local_typing(monkeypatch):
    """LLM은 계획만, 입력은 로컬 타이핑 — 성공 판정은 '지연 후 값 존재' 재검증."""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(af, "_ask_llm", lambda *a, **k: json.dumps(
        {"plan": [{"idx": 2, "key": "parent_name"}]}))

    typed = []

    class _Kbd:
        async def press(self, key):
            typed.append(("press", key))
        async def type(self, text, delay=0):
            typed.append(("type", text))
        async def insert_text(self, text):
            typed.append(("insert", text))

    class _Loc:
        async def click(self, timeout=None):
            typed.append(("click", None))
        async def fill(self, v, timeout=None):
            typed.append(("fill", v))

    # ⚠️ role 없는(구형 shape) 필드라 결정론 계층은 스킵 → LLM 경로가 실행되는 계약을 검증.
    #    mock은 호출순서가 아닌 'JS 내용' 기반 dispatch(3계층 구조로 collect 호출이 늘어도 견고).
    class _Ctx:
        async def evaluate(self, js, *args):
            if "querySelectorAll('input, select" in js or "data-modoobom-ai" in js and "setAttribute" in js:
                return [{"idx": 2, "tag": "input", "type": "text", "label": "추가정보확인", "filled": False, "ro": False}]
            if "e.tagName.toLowerCase()" in js:   # 요소 정보(tag 조회)
                return {"tag": "input"}
            return True           # 지연 재검증 — 값 남음
        def locator(self, sel):
            assert "data-modoobom-ai='2'" in sel
            return _Loc()

    class _Page:
        keyboard = _Kbd()

    r = _run(af.ai_fill(_Ctx(), _Page(), {"parent_name": "김상식"}, page_hint="t"))
    assert r == {"parent_name": True}
    # 한글은 IME 확정 삽입(insert_text) — 키 타이핑은 IME 없는 브라우저에서 영타(rlatkdtlr)가 된다(실사용 확정)
    assert ("insert", "김상식") in typed
    assert ("type", "김상식") not in typed
    assert ("press", "Control+a") in typed      # 전체선택 후 교체('-' 잔값 제거)
