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
    # ⚠️ 테스트 이식성(실측): 개발 PC의 backend/.env 에 실제 키가 있으면 _load_env_file 이 그 키를
    #    os.environ 에 주입해 위 delenv 를 무효화 → '키 없음' 게이트 테스트가 로컬에서만 깨졌다(실측).
    #    _ENV_LOADED 를 True 로 고정해 .env 재읽기를 막는다(테스트가 명시적으로 setenv 한 키만 반영).
    monkeypatch.setattr(af, "_ENV_LOADED", True, raising=False)
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


def test_deterministic_skips_other_person_fields():
    """🚫 다중 인물 신청서(신청인·배우자·대리인·자녀)에서 신청인 값이 '타인 칸'에 오입력되지 않는지.
    복지로 신청서 실측 위험 — '배우자 성명'이 신청인 '성명'보다 앞서 있어도 신청인 성명 칸을 골라야 한다."""
    fields = [
        {"idx": 0, "role": "textbox", "name": "배우자 성명", "filled": False, "ro": False},   # 타인 — 제외
        {"idx": 1, "role": "textbox", "name": "대리인 휴대폰", "filled": False, "ro": False}, # 타인 — 제외
        {"idx": 2, "role": "textbox", "name": "신청인 성명", "filled": False, "ro": False},   # 정답
        {"idx": 3, "role": "textbox", "name": "휴대폰 번호", "filled": False, "ro": False},    # 정답
    ]
    plan = af._deterministic_plan(fields, ["name", "phone_tail"])
    by_key = {p["key"]: p for p in plan}
    assert by_key["name"]["idx"] == 2        # '배우자 성명'(idx 0) 건너뛰고 '신청인 성명'
    assert by_key["phone_tail"]["idx"] == 3  # '대리인 휴대폰'(idx 1) 건너뛰고 신청인 휴대폰
    # 타인 칸만 존재하면(신청인 칸 없음) 아무것도 채우지 않는다(오입력보다 미입력이 안전)
    only_other = [{"idx": 0, "role": "textbox", "name": "자녀 성명", "filled": False, "ro": False}]
    assert af._deterministic_plan(only_other, ["name"]) == []


def test_do_fill_focus_fallback_when_click_intercepted():
    """🎯 오버레이가 클릭을 가로채도 JS 포커스 폴백으로 실키 입력이 진행되는지
    (efamily 휴대폰칸이 오버레이에 막혀 클릭 실패하던 실사용 교훈 — 포커스만 잡으면 키는 통함)."""
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
            raise RuntimeError("overlay intercepts pointer events")  # 클릭 차단 재현

        async def fill(self, v, timeout=None):
            typed.append(("fill", v))

    class _Ctx:
        async def evaluate(self, js, *args):
            return True  # JS 포커스 성공(activeElement 일치) + 지연 값일치 재검증 통과

        def locator(self, sel):
            return _Loc()

    class _Page:
        keyboard = _Kbd()

    ok = _run(af._do_fill(_Ctx(), _Page(), "[data-modoobom-ai='0']", "12345678"))
    assert ok is True
    assert ("type", "12345678") in typed        # 클릭 실패했지만 포커스 폴백으로 실키 입력됨
    assert ("press", "Control+a") in typed       # 포커스 확보 후 기존값 교체
    assert ("fill", "12345678") not in typed     # 첫 방법(type)에서 성공 → CDP fill까지 안 감


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


# ── 🧭 ai_pick_action (observe→decide→click, 내비게이션) — openclaw식 클릭 판단 ──
def _nav_ctx(fields, clicked):
    """가짜 ctx — evaluate 는 요소 목록(=_COLLECT_JS 결과)을 돌려주고, locator().click() 은 눌린 idx 기록."""
    import re as _re

    class _Loc:
        def __init__(self, sel):
            self.sel = sel
        async def click(self, timeout=None):
            m = _re.search(r"data-modoobom-ai='(\d+)'", self.sel)
            clicked.append(int(m.group(1)) if m else -1)

    class _Ctx:
        async def evaluate(self, js, *a):
            return fields
        def locator(self, sel):
            return _Loc(sel)

    return _Ctx()


def test_ai_pick_action_deterministic_pick():
    """결정론(무키) — want_texts 동의어를 양방향 부분일치로 잡아 올바른 버튼을 누른다.
    '문서 출력'(공백 변형)도 매칭, 개인정보성 링크('홍길동님')는 후보에서 제외된다."""
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "이전", "type": "button"},
        {"idx": 1, "role": "button", "text": "문서 출력", "type": "button"},
        {"idx": 2, "role": "link", "text": "홍길동님", "type": "link"},
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서 출력 단계", ["문서출력", "출력하기"]))
    assert ok is True
    assert clicked == [1]


def test_ai_pick_action_denylist_blocks_irreversible():
    """제출·결제 등 비가역 버튼은 결정론 후보에서부터 제외 — 어떤 want_texts 로도 누르지 않는다(HITL 불변)."""
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "제출", "type": "button"},
        {"idx": 1, "role": "button", "text": "결제하기", "type": "button"},
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "제출", ["제출", "결제"]))
    assert ok is False
    assert clicked == []


def test_ai_pick_action_llm_decides_when_deterministic_misses(monkeypatch):
    """LLM 계층(키+옵트인) — 결정론 동의어가 못 맞춘 라벨('증명서 인쇄')을 구조만 보고 골라 누른다."""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(af, "_ask_llm", lambda *a, **k: '{"idx": 2}')
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "이전", "type": "button"},
        {"idx": 1, "role": "button", "text": "닫기", "type": "button"},
        {"idx": 2, "role": "button", "text": "증명서 인쇄", "type": "button"},
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서를 인쇄해 저장", ["문서출력", "출력하기"]))
    assert ok is True
    assert clicked == [2]


def test_ai_pick_action_rejects_llm_denylisted_choice(monkeypatch):
    """LLM 환각 가드 — LLM 이 비가역 버튼(후보에서 이미 빠진) idx 를 골라도 실행하지 않는다."""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(af, "_ask_llm", lambda *a, **k: '{"idx": 0}')  # 위험 버튼 idx(환각)
    clicked = []
    fields = [
        {"idx": 0, "role": "button", "text": "제출", "type": "button"},
        {"idx": 1, "role": "button", "text": "닫기", "type": "button"},
    ]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "다음 단계", ["없는버튼"]))
    assert ok is False
    assert clicked == []


def test_ai_pick_action_mock_safe_without_key(monkeypatch):
    """Mock-safe — 키 없고 결정론도 못 맞추면 조용히 False. LLM 은 호출조차 안 한다(무동작 계약)."""
    monkeypatch.setattr(
        af, "_ask_llm",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("키 없이 LLM 호출됨")))
    clicked = []
    fields = [{"idx": 0, "role": "button", "text": "닫기", "type": "button"}]
    ok = _run(af.ai_pick_action(_nav_ctx(fields, clicked), "문서출력", ["문서출력"]))
    assert ok is False
    assert clicked == []


def test_nav_prompt_privacy_and_safe_labels():
    """프라이버시 — 개인정보성 라벨(이름+님·로그아웃)은 후보 제외, 프롬프트는 '값' 인자를 받지 않는다."""
    import inspect
    assert af._safe_button_label("홍길동님") == ""
    assert af._safe_button_label("로그아웃") == ""
    assert af._safe_button_label("마이페이지") == ""
    assert af._safe_button_label("문서출력") == "문서출력"
    p = af.build_nav_prompt("문서출력 단계로 진행", [{"idx": 1, "text": "문서출력"}])
    assert "문서출력" in p                                        # 버튼 라벨(구조)은 전달
    assert "values" not in inspect.signature(af.build_nav_prompt).parameters  # 값 인자 자체가 없음
