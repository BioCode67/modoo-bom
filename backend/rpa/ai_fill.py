"""🤖 AI 채움(β) — LLM이 '발급 페이지 구조'를 읽고 어떤 칸에 어떤 값이 들어갈지 계획한다.

사용자 요청(2026-07-20): "AI가 발급 페이지를 보고 이해해서 넣어야 하는 정보를 입력하게" —
규칙 엔진(1순위)이 못 채운 칸에 한해 LLM이 보완하는 감독자 레이어.

프라이버시 계약(불변):
- LLM에는 **화면 구조만** 보낸다: 라벨·타입·placeholder·옵션 텍스트·채움 여부(불리언).
- 사용자 값(이름·주민번호·전화번호·주소)은 **절대 전송하지 않는다** — 프롬프트 빌더가
  값 자체를 인자로 받지 않아 구조적으로 유출이 불가능하다(테스트로 고정).
- 계획(어느 idx에 어떤 값 키)만 받아, 실제 입력은 로컬 Playwright 실키 타이핑이 수행한다.

동작 조건: API 키가 있어야 동작(GEMINI_API_KEY/GOOGLE_API_KEY → GROQ_API_KEY →
ANTHROPIC_API_KEY 순 폴백), RPA_AI_FILL=0 밸브로 전체 끔. 키 없으면 조용히 무동작 —
기존 규칙 엔진 흐름은 단 한 줄도 바뀌지 않는다(β·추가형).
"""
import asyncio
import json
import os
import re

# 값 키 사전 — LLM에는 이 '이름과 의미'만 간다(값은 로컬 보관)
VALUE_KEYS_DOC = {
    "name": "신청인 성명",
    "birth6": "주민등록번호 앞 6자리(생년월일)",
    "rrn7": "주민등록번호 뒤 7자리",
    "parent_name": "부 또는 모의 성명(추가정보확인)",
    "phone_head": "휴대폰 앞 3자리(010 등, 셀렉트일 수 있음)",
    "phone_tail": "휴대폰 나머지 번호",
    "sido": "주소 시/도",
    "sigungu": "주소 시/군/구",
}

# 화면 구조 수집 — 보이는 input/select만, 값은 '있는지 여부'만(내용 미수집), 요소에 idx 마킹
_COLLECT_JS = """() => {
    const out = [];
    let idx = 0;
    const rowLabel = (el) => {
        const tr = el.closest('tr, li, .form-group, dl, div');
        if (!tr) return '';
        const th = tr.querySelector('th, td, label, dt, strong');
        return th ? (th.innerText || '').trim().slice(0, 30) : '';
    };
    for (const el of document.querySelectorAll('input, select')) {
        const type = (el.type || el.tagName).toLowerCase();
        if (['hidden', 'submit', 'button', 'image', 'file', 'checkbox', 'radio'].includes(type)) continue;
        if (el.offsetParent === null) continue;
        const item = {
            idx: idx,
            tag: el.tagName.toLowerCase(),
            type: type,
            label: rowLabel(el),
            ph: (el.getAttribute('placeholder') || '').slice(0, 20),
            filled: !!(el.value && el.value.trim() && el.value.trim() !== '-'),
            ro: !!(el.readOnly || el.disabled),
        };
        if (el.tagName === 'SELECT') {
            item.options = [...el.options].slice(0, 20).map(o => (o.text || '').trim().slice(0, 16));
        }
        el.setAttribute('data-modoobom-ai', String(idx));
        out.push(item);
        idx += 1;
        if (idx >= 40) break;
    }
    return out;
}"""


_ENV_LOADED = False


def _load_env_file():
    """backend/.env를 직접 읽어 '없는 키만' 주입 — 데스크탑 경량 서버(local_server)는 dotenv를
    안 부르므로(사용자가 .env에 넣어둔 GEMINI_API_KEY가 안 보이던 실사용 원인) 무의존 파서로 보강.
    값은 로그·메시지에 절대 노출하지 않는다."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    try:
        import pathlib
        env_path = pathlib.Path(__file__).resolve().parents[1] / ".env"
        if not env_path.exists():
            return
        wanted = {"GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
                  "RPA_AI_FILL", "CLAUDE_MODEL"}
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k in wanted and v and k not in os.environ:
                os.environ[k] = v
    except Exception:
        pass


def _pick_provider():
    """사용 가능한 LLM 키 — 없으면 None(기능 전체 무동작). backend/.env 백스톱 로드 포함."""
    _load_env_file()
    g = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if g:
        return ("gemini", g)
    q = os.environ.get("GROQ_API_KEY")
    if q:
        return ("groq", q)
    a = os.environ.get("ANTHROPIC_API_KEY")
    if a and a.lower() != "mock":
        return ("anthropic", a)
    return None


def ai_fill_enabled() -> bool:
    """AI 채움 활성 여부 — RPA_AI_FILL=0 밸브 우선, 그다음 키 존재."""
    if os.environ.get("RPA_AI_FILL", "1") == "0":
        return False
    return _pick_provider() is not None


def build_prompt(fields: list, keys: list, page_hint: str = "") -> str:
    """LLM 프롬프트 — 화면 구조와 '값 키 이름'만 담는다.
    ⚠️ 프라이버시 계약: 이 함수는 사용자 값을 인자로 받지 않는다(구조적 유출 차단, 테스트 고정)."""
    kdoc = {k: VALUE_KEYS_DOC[k] for k in keys if k in VALUE_KEYS_DOC}
    return (
        "당신은 대한민국 정부 웹사이트 폼 자동입력 '계획기'입니다. 실제 값은 로컬 PC에서만 입력되며 당신은 값을 볼 수 없습니다.\n"
        f"화면: {page_hint or '발급/인증 폼'}\n"
        "아래 '요소 목록'에서 각 '값 키'가 입력될 요소를 고르세요. 확실한 매핑만 포함하고, filled=true(이미 입력됨)·ro=true(잠김) 요소는 제외하세요.\n"
        'JSON 한 개만 출력: {"plan": [{"idx": <요소 idx>, "key": "<값 키>"}]}\n'
        f"값 키(이름: 의미): {json.dumps(kdoc, ensure_ascii=False)}\n"
        f"요소 목록: {json.dumps(fields, ensure_ascii=False)}\n"
    )


def _http_json(url: str, payload: dict, headers: dict, timeout: int) -> dict:
    """표준 라이브러리만으로 JSON POST — venv-local·EXE 번들 어디서든 추가 의존성 0."""
    import urllib.request
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _ask_llm(prompt: str, timeout: int = 14) -> str:
    """가벼운 REST 직통 호출(SDK·requests 불필요 — 표준 라이브러리 urllib)."""
    prov = _pick_provider()
    if not prov:
        return ""
    kind, key = prov
    try:
        if kind == "gemini":
            d = _http_json(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}",
                {"contents": [{"parts": [{"text": prompt}]}],
                 "generationConfig": {"temperature": 0, "maxOutputTokens": 800}},
                {}, timeout,
            )
            return d["candidates"][0]["content"]["parts"][0]["text"]
        if kind == "groq":
            d = _http_json(
                "https://api.groq.com/openai/v1/chat/completions",
                {"model": "llama-3.3-70b-versatile", "temperature": 0,
                 "messages": [{"role": "user", "content": prompt}]},
                {"Authorization": f"Bearer {key}"}, timeout,
            )
            return d["choices"][0]["message"]["content"]
        if kind == "anthropic":
            d = _http_json(
                "https://api.anthropic.com/v1/messages",
                {"model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"),
                 "max_tokens": 800,
                 "messages": [{"role": "user", "content": prompt}]},
                {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout,
            )
            return d["content"][0]["text"]
    except Exception:
        return ""
    return ""


def _parse_plan(text: str) -> list:
    """응답에서 {"plan": [...]}만 관대하게 추출 — 잡담·마크다운 섞여도 견딤, 미지 키는 버림."""
    try:
        m = re.search(r"\{[\s\S]*\}", text or "")
        if not m:
            return []
        data = json.loads(m.group(0))
        out = []
        for it in (data.get("plan") or []):
            try:
                idx = int(it.get("idx"))
                key = str(it.get("key") or "")
                if key in VALUE_KEYS_DOC and idx >= 0:
                    out.append({"idx": idx, "key": key})
            except Exception:
                continue
        return out[:12]
    except Exception:
        return []


async def ai_fill(ctx, page, values: dict, page_hint: str = "", task=None) -> dict:
    """구조 수집 → LLM 계획 → 로컬 실키 타이핑 실행 → 지연 검증. 반환 {값키: 성공여부}.
    키 없음·LLM 실패·계획 없음 — 전부 빈 dict(호출부 흐름 무변화)."""
    result = {}
    want = {k: str(v) for k, v in (values or {}).items() if v}
    if not want or not ai_fill_enabled():
        return result
    try:
        fields = await ctx.evaluate(_COLLECT_JS)
    except Exception:
        return result
    if not fields:
        return result
    prompt = build_prompt([f for f in fields if not f.get("ro")], list(want.keys()), page_hint)
    try:
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, _ask_llm, prompt)
    except Exception:
        return result
    plan = _parse_plan(text)
    if not plan:
        return result
    if task is not None:
        try:
            task.update("running",
                        f"🤖 AI 채움(β): 화면을 읽고 {len(plan)}칸을 매핑했어요 — 값은 이 PC에서만 입력됩니다.")
        except Exception:
            pass
    for it in plan:
        key = it["key"]
        val = want.get(key)
        if not val:
            continue
        sel = f"[data-modoobom-ai='{it['idx']}']"
        try:
            info = await ctx.evaluate(
                "(s) => { const e = document.querySelector(s); if (!e) return null;"
                " return {tag: e.tagName.toLowerCase()}; }", sel)
            if not info:
                continue
            if info.get("tag") == "select":
                ok = await ctx.evaluate(
                    """(a) => { const e = document.querySelector(a.s); if (!e) return false;
                        const norm = (x) => String(x || '').replace(/\\s+/g, '');
                        const o = [...e.options].find(o => norm(o.text).includes(norm(a.v)) || (norm(a.v).includes(norm(o.text)) && norm(o.text).length >= 2));
                        if (!o) return false;
                        e.value = o.value; e.dispatchEvent(new Event('change', {bubbles: true})); return true; }""",
                    {"s": sel, "v": val})
                result[key] = bool(ok)
            else:
                loc = ctx.locator(sel)
                await loc.click()
                await page.keyboard.press("Control+a")
                await page.keyboard.press("Delete")
                if val.isascii():
                    await page.keyboard.type(val, delay=45)  # 숫자·영문은 실키(위젯 수용성 최고)
                else:
                    # 한글 등 비ASCII는 IME 확정 삽입 — 키 타이핑은 IME 없는 자동화 브라우저에서
                    # 자판 위치 영문(김상식→rlatkdtlr)이 돼버린다(실사용 확정)
                    await page.keyboard.insert_text(val)
                await asyncio.sleep(0.5)  # 위젯이 지울 시간을 준 '뒤' 검증(자기만족 금지)
                result[key] = bool(await ctx.evaluate(
                    "(s) => { const e = document.querySelector(s);"
                    " return !!(e && e.value && e.value.trim() && e.value.trim() !== '-'); }", sel))
        except Exception:
            result[key] = False
    return result
