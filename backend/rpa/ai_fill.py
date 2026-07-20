"""🤖 AI 채움/파일럿(β) — 인지 → 계획 → 실행 → 점검 → 재계획 루프.

사용자 요청(2026-07-20): "LLM이 멀티모달처럼 웹페이지를 보고 분석/이해/판단해서 행동을
계획하고 점검해서 실천하게" — 규칙 엔진(1순위)이 못 해낸 일을 LLM이 이어받는 감독자 레이어.

루프 구조(최대 2라운드):
  ① 인지: 화면 구조 수집(라벨·타입·옵션·채움 여부) + (옵트인) 입력값을 CSS로 가린 마스킹
     스크린샷(RPA_AI_VISION=1, Gemini/Claude 멀티모달)
  ② 계획: LLM이 행동 JSON — fill(어느 칸에 어떤 값 키) · select(옵션 텍스트) ·
     click(허용목록 버튼, RPA_AI_CLICK=1 옵트인)
  ③ 실행: 로컬 Playwright — 실키 타이핑/IME 삽입/CDP fill 3단, 클릭은 허용·거부목록 검사
  ④ 점검: 지연 후 값 재검증 → 미완 키만 남기고 ⑤ 재계획 1회

프라이버시 계약(불변):
- 기본 모드는 **화면 구조만** 전송 — 사용자 값(이름·주민번호·전화번호)은 프롬프트 빌더가
  인자로 받지 않아 구조적으로 유출 불가(테스트 고정).
- 비전 모드(옵트인)도 input/select 값을 투명 처리한 **마스킹 스크린샷**만 전송. 단, 페이지
  본문에 이미 표시된 개인정보까지 지울 수는 없어 기본 꺼짐(RPA_AI_VISION=1 옵트인).
- 실행(값 입력·클릭)은 전부 로컬. 본인인증·최종 제출은 여전히 사람(HITL 불변) —
  클릭 행동은 제출/결제류를 거부목록으로 차단한다.

동작 조건: backend/.env 또는 환경변수의 GEMINI_API_KEY(GOOGLE_API_KEY) → GROQ_API_KEY →
ANTHROPIC_API_KEY 폴백(표준 urllib — 추가 의존성 0). RPA_AI_FILL=0 밸브. 키 없으면 무동작.
"""
import asyncio
import base64
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

# 클릭 행동 안전 가드 — 진행성 버튼만 허용, 비가역·위험 버튼은 어떤 경우에도 거부
_CLICK_ALLOW = re.compile(r"^(간편인증|인증요청|확인|다음|다음단계|검색|조회|닫기)$")
_CLICK_DENY = re.compile(r"제출|결제|삭제|탈퇴|해지|이체")

# 🧠 의미 기반 인지 — 브라우저 접근성 트리처럼 '접근성 이름(accessible name)'을 WAI-ARIA accname
#   알고리즘으로 계산해 요소를 사람처럼 읽는다(2026 웹 에이전트 SOTA: Browser-Use/Stagehand/Playwright MCP).
#   ⚠️ 값(내용)은 절대 담지 않는다 — filled 는 '채워졌는가' 불리언만(프라이버시 계약).
#   한국 정부 폼의 <tr><th>라벨</th><td>입력</td></tr> 구조를 정확히 잡는 게 핵심(부모 전체 긁기 금지).
_COLLECT_JS = """() => {
    const txt = (n) => (n && (n.innerText || n.textContent) || '').replace(/\\s+/g, ' ').trim();
    // WAI-ARIA accessible name 계산(간이·견고) — 라벨을 사람이 보는 그대로.
    const accName = (el) => {
        const lb = el.getAttribute('aria-labelledby');
        if (lb) { const t = lb.split(/\\s+/).map(id => txt(document.getElementById(id))).filter(Boolean).join(' '); if (t) return t; }
        const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
        if (el.id) { try { const l = document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]'); if (l && txt(l)) return txt(l); } catch (e) {} }
        const wl = el.closest('label'); if (wl && txt(wl)) return txt(wl);
        const row = el.closest('tr'); if (row) { const th = row.querySelector('th'); if (th && txt(th)) return txt(th); }
        // 셀/행 앞쪽의 라벨성 텍스트(dt, .label, 바로 앞 형제)
        const cell = el.closest('td, li, dd, .form-group, div');
        if (cell) {
            const prev = cell.previousElementSibling;
            if (prev && (prev.tagName === 'TH' || prev.tagName === 'DT' || /label|tit|head/i.test(prev.className)) && txt(prev)) return txt(prev);
        }
        const ph = el.getAttribute('placeholder'); if (ph && ph.trim()) return ph.trim();
        const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
        return '';
    };
    const roleOf = (el) => {
        const r = el.getAttribute('role'); if (r) return r;
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'input') { const t = (el.type || 'text').toLowerCase();
            return ({checkbox:'checkbox', radio:'radio', button:'button', submit:'button', number:'spinbutton', tel:'textbox', password:'textbox'})[t] || 'textbox'; }
        return tag;
    };
    const out = [];
    let idx = 0;
    for (const el of document.querySelectorAll('input, select, textarea, button, a, [role=button], [role=checkbox], [role=radio]')) {
        const tag = el.tagName.toLowerCase();
        const type = (el.type || tag).toLowerCase();
        if (['hidden', 'image', 'file'].includes(type)) continue;
        if (el.offsetParent === null) continue;  // 보이는 것만
        const role = roleOf(el);
        const item = {idx: idx, role: role, name: accName(el).slice(0, 40)};
        if (['button', 'link'].includes(role) || type === 'submit' || type === 'button') {
            const t = txt(el) || (el.value || '').trim();
            if (!t) continue;
            item.text = t.slice(0, 24);
        } else if (['checkbox', 'radio'].includes(role)) {
            item.checked = !!el.checked;
            if (!item.name) continue;  // 이름 없는 라디오/체크는 스킵(오클릭 방지)
        } else {  // textbox/combobox/spinbutton 등 입력칸
            item.filled = !!(el.value && el.value.trim() && el.value.trim() !== '-');
            item.ro = !!(el.readOnly || el.disabled);
            if (tag === 'select') item.options = [...el.options].slice(0, 20).map(o => (o.text || '').trim().slice(0, 16));
        }
        // 하위호환: 기존 코드/테스트가 tag·type·label·ph 를 읽으므로 함께 채운다
        item.tag = tag; item.type = type; item.label = item.name;
        item.ph = (el.getAttribute('placeholder') || '').slice(0, 20);
        el.setAttribute('data-modoobom-ai', String(idx));
        out.push(item);
        idx += 1;
        if (idx >= 80) break;
    }
    return out;
}"""

# 비전용 마스킹 — 입력값·캐럿을 투명 처리(구조·라벨은 보임). 스크린샷 후 반드시 제거.
_MASK_ON_JS = """() => {
    if (document.getElementById('modoobom-mask')) return true;
    const st = document.createElement('style');
    st.id = 'modoobom-mask';
    st.textContent = 'input, select, textarea { color: transparent !important; caret-color: transparent !important; text-shadow: none !important; }';
    document.documentElement.appendChild(st);
    return true;
}"""
_MASK_OFF_JS = "() => { const s = document.getElementById('modoobom-mask'); if (s) s.remove(); return true; }"

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
                  "RPA_AI_FILL", "RPA_AI_VISION", "RPA_AI_CLICK", "CLAUDE_MODEL"}
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


def vision_enabled() -> bool:
    """마스킹 스크린샷 전송(멀티모달) — 옵트인 + 이미지 지원 제공자(Gemini/Claude)일 때만."""
    if os.environ.get("RPA_AI_VISION", "0") != "1":
        return False
    prov = _pick_provider()
    return bool(prov and prov[0] in ("gemini", "anthropic"))


def clicks_enabled() -> bool:
    """LLM 클릭 행동 — 옵트인(RPA_AI_CLICK=1). 켜져도 허용·거부목록 가드는 항상 적용."""
    return os.environ.get("RPA_AI_CLICK", "0") == "1"


def click_text_allowed(text: str) -> bool:
    """클릭 허용 판정 — 공백 제거 후 허용목록 정확 일치 + 거부목록 무포함(제출·결제류 차단)."""
    t = re.sub(r"\s+", "", str(text or ""))
    if not t or _CLICK_DENY.search(t):
        return False
    return bool(_CLICK_ALLOW.match(t))


def build_prompt(fields: list, keys: list, page_hint: str = "", allow_clicks: bool = False,
                 unfinished: list = None) -> str:
    """LLM 프롬프트 — 화면 구조와 '값 키 이름'만 담는다.
    ⚠️ 프라이버시 계약: 이 함수는 사용자 값을 인자로 받지 않는다(구조적 유출 차단, 테스트 고정)."""
    kdoc = {k: VALUE_KEYS_DOC[k] for k in keys if k in VALUE_KEYS_DOC}
    actions = '{"action":"fill","idx":N,"key":"값키"} 또는 {"action":"select","idx":N,"option":"옵션 텍스트"}'
    if allow_clicks:
        actions += ' 또는 {"action":"click","idx":N}(진행 버튼만 — 제출/결제류 금지)'
    extra = ""
    if unfinished:
        extra = (f"직전 행동 뒤 아직 값이 안 들어간 키: {json.dumps(unfinished, ensure_ascii=False)}.\n"
                 "요소 목록의 filled 상태가 바뀌었는지 관찰하고, 안 된 키만 다른 요소/방법으로 다시 계획하세요.\n")
    return (
        "당신은 한국 정부 웹사이트 자동화 에이전트입니다. 화면의 '접근성 트리'를 읽고 어떤 칸에 어떤 값을 넣을지 판단하세요.\n"
        "⚠️ 실제 값(이름·주민번호·전화번호)은 로컬 PC에서만 입력되며 당신에게 전달되지 않습니다. 당신은 '어디에 무엇을'만 정합니다.\n"
        f"화면 맥락: {page_hint or '발급/인증 폼'}\n"
        + extra +
        "각 요소는 role(textbox/combobox/checkbox/button)·name(접근성 라벨)·filled(입력됨)·ro(잠김)를 가집니다.\n"
        "판단 규칙: ① name이 값 키 의미와 맞는 textbox/combobox를 고른다 ② filled=true·ro=true는 건드리지 않는다 "
        "③ 주민번호 앞자리는 name='주민등록번호'인 첫 textbox, 생년월일 6자리(birth6)가 거기 들어간다 "
        "④ 휴대폰 뒷부분(phone_tail)은 name에 '휴대폰/핸드폰'이 있는 textbox ⑤ 시/도·시군구는 combobox(select)면 select 행동.\n"
        f"행동 형식: {actions}\n"
        'JSON 한 개만 출력(설명 금지): {"plan": [<행동>...]}\n'
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


def _ask_llm(prompt: str, timeout: int = 14, image_b64: str = "") -> str:
    """REST 직통 호출 — image_b64가 있으면 멀티모달(Gemini/Claude), Groq는 텍스트만."""
    prov = _pick_provider()
    if not prov:
        return ""
    kind, key = prov
    try:
        if kind == "gemini":
            parts = [{"text": prompt}]
            if image_b64:
                parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image_b64}})
            # 사용자 .env의 GEMINI_MODEL을 존중(챗 스택과 동일 규약) — 미설정 시 2.5-flash
            _gm = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
            d = _http_json(
                f"https://generativelanguage.googleapis.com/v1beta/models/{_gm}:generateContent?key={key}",
                {"contents": [{"parts": parts}],
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
            content = [{"type": "text", "text": prompt}]
            if image_b64:
                content.append({"type": "image",
                                "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}})
            d = _http_json(
                "https://api.anthropic.com/v1/messages",
                {"model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"),
                 "max_tokens": 800,
                 "messages": [{"role": "user", "content": content}]},
                {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout,
            )
            return d["content"][0]["text"]
    except Exception:
        return ""
    return ""


def _parse_plan(text: str) -> list:
    """응답에서 {"plan": [...]}만 관대하게 추출 — 구형 {"idx","key"}는 fill로 승격, 미지 항목은 버림."""
    try:
        m = re.search(r"\{[\s\S]*\}", text or "")
        if not m:
            return []
        data = json.loads(m.group(0))
        out = []
        for it in (data.get("plan") or []):
            try:
                action = str(it.get("action") or "fill")
                idx = int(it.get("idx"))
                if idx < 0:
                    continue
                if action == "fill":
                    key = str(it.get("key") or "")
                    if key in VALUE_KEYS_DOC:
                        out.append({"action": "fill", "idx": idx, "key": key})
                elif action == "select":
                    key = str(it.get("key") or "")
                    opt = str(it.get("option") or "")
                    if opt or key in VALUE_KEYS_DOC:
                        out.append({"action": "select", "idx": idx, "key": key, "option": opt})
                elif action == "click":
                    out.append({"action": "click", "idx": idx})
            except Exception:
                continue
        return out[:12]
    except Exception:
        return []


async def _masked_screenshot_b64(page) -> str:
    """입력값을 투명 처리한 마스킹 스크린샷(JPEG, base64) — 실패는 빈 문자열(텍스트 모드로 진행)."""
    try:
        await page.evaluate(_MASK_ON_JS)
        await asyncio.sleep(0.15)
        raw = await page.screenshot(type="jpeg", quality=55)
        return base64.b64encode(raw).decode("ascii")
    except Exception:
        return ""
    finally:
        try:
            await page.evaluate(_MASK_OFF_JS)
        except Exception:
            pass


async def _do_fill(ctx, page, sel: str, val: str) -> bool:
    """값 입력 3단 폴백(실키 → IME 삽입 → CDP fill) + 지연 재검증 — 자기만족 검증 금지."""
    loc = ctx.locator(sel)
    for method in ("type", "insert", "fill"):
        try:
            await loc.click(timeout=4000)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Delete")
            if method == "type":
                if val.isascii():
                    await page.keyboard.type(val, delay=45)
                else:
                    # 한글 등 비ASCII 키 타이핑은 IME 없는 브라우저에서 영타(김상식→rlatkdtlr)가 된다
                    await page.keyboard.insert_text(val)
            elif method == "insert":
                await page.keyboard.insert_text(val)
            else:
                await loc.fill(val, timeout=4000)
            await asyncio.sleep(0.5)
            # '값 일치' 검증 — 비어있지 않음만 보면 영타 오입력(rlatkdtlr)도 통과한다(실사용 확정).
            #   숫자 값은 포맷팅(하이픈 등) 관용, 그 외는 정확 일치. 비교는 브라우저 안에서만.
            ok = await ctx.evaluate(
                """(a) => { const e = document.querySelector(a.s); if (!e || !e.value) return false;
                    const t = e.value.trim(), v = String(a.v).trim();
                    if (/^[0-9]+$/.test(v)) return t.replace(/[^0-9]/g, '') === v;
                    return t === v; }""", {"s": sel, "v": val})
            if ok:
                return True
        except Exception:
            continue
    return False


async def _execute_plan(ctx, page, plan: list, want: dict, allow_clicks: bool) -> dict:
    """계획 실행 — 반환 {값키: 성공여부}. 클릭은 허용·거부목록 이중 가드."""
    result = {}
    for it in plan:
        sel = f"[data-modoobom-ai='{it['idx']}']"
        action = it.get("action")
        try:
            if action == "click":
                if not (allow_clicks and clicks_enabled()):
                    continue
                txt = await ctx.evaluate(
                    "(s) => { const e = document.querySelector(s);"
                    " return e ? (e.innerText || e.value || '').trim() : ''; }", sel)
                if not click_text_allowed(txt):
                    continue  # 허용목록 밖 — 어떤 경우에도 클릭하지 않는다(HITL·비가역 보호)
                await ctx.locator(sel).click(timeout=4000)
                await asyncio.sleep(0.8)
                continue
            key = it.get("key") or ""
            val = want.get(key)
            if action == "select":
                v = val or it.get("option") or ""
                if not v:
                    continue
                ok = await ctx.evaluate(
                    """(a) => { const e = document.querySelector(a.s); if (!e || e.tagName !== 'SELECT') return false;
                        const norm = (x) => String(x || '').replace(/\\s+/g, '');
                        const o = [...e.options].find(o => norm(o.text).includes(norm(a.v)) || (norm(a.v).includes(norm(o.text)) && norm(o.text).length >= 2));
                        if (!o) return false;
                        e.value = o.value; e.dispatchEvent(new Event('change', {bubbles: true})); return true; }""",
                    {"s": sel, "v": v})
                if key:
                    result[key] = bool(ok)
                continue
            if action == "fill" and val:
                info = await ctx.evaluate(
                    "(s) => { const e = document.querySelector(s); return e ? e.tagName.toLowerCase() : ''; }", sel)
                if info == "select":
                    ok = await ctx.evaluate(
                        """(a) => { const e = document.querySelector(a.s); if (!e) return false;
                            const norm = (x) => String(x || '').replace(/\\s+/g, '');
                            const o = [...e.options].find(o => norm(o.text).includes(norm(a.v)) || (norm(a.v).includes(norm(o.text)) && norm(o.text).length >= 2));
                            if (!o) return false;
                            e.value = o.value; e.dispatchEvent(new Event('change', {bubbles: true})); return true; }""",
                        {"s": sel, "v": val})
                    result[key] = bool(ok)
                else:
                    result[key] = await _do_fill(ctx, page, sel, val)
        except Exception:
            if it.get("key"):
                result[it["key"]] = False
    return result


# 🧭 결정론적 의미 매칭 — 접근성 이름(name)을 값 키 의도와 대조(생활어 동의어). LLM 없이도 동작.
#   한국 정부/인증 폼의 라벨 변형을 흡수(성명↔이름, 휴대폰↔핸드폰, 주민등록번호↔생년월일 등).
_INTENT_PATTERNS = {
    "name": ["성명", "이름", "신청인"],
    "birth6": ["주민등록번호", "생년월일", "주민번호"],
    "phone_tail": ["휴대폰", "핸드폰", "전화번호"],
    "parent_name": ["추가정보", "부성명", "모성명", "부모성명"],
    "sido": ["시도", "시·도", "특별시", "광역시", "주소"],
    "sigungu": ["시군구", "시·군·구", "군구"],
}


def _deterministic_plan(fields: list, keys) -> list:
    """접근성 이름 기반 결정론 계획 — LLM 없이 값 키↔요소를 매칭(같은 이름 여럿이면 문서순 첫 미사용).
    입력 role(textbox/combobox/spinbutton)만 대상, filled/ro/이름없음은 제외. 같은 idx 중복 금지."""
    plan = []
    used = set()
    _norm = lambda s: str(s or "").replace(" ", "")
    for key in keys:
        pats = _INTENT_PATTERNS.get(key)
        if not pats:
            continue
        for f in fields:
            if f.get("idx") in used or f.get("ro") or f.get("filled"):
                continue
            role = f.get("role")
            if role not in ("textbox", "combobox", "spinbutton"):
                continue
            nm = _norm(f.get("name"))
            if not nm or not any(_norm(p) in nm for p in pats):
                continue
            used.add(f["idx"])
            plan.append({"action": "select" if role == "combobox" else "fill", "idx": f["idx"], "key": key})
            break
    return plan


async def ai_fill(ctx, page, values: dict, page_hint: str = "", task=None,
                  allow_clicks: bool = False, rounds: int = 2) -> dict:
    """observe→act 에이전트: ① 접근성 이름 인지 ② 결정론 의미매칭 실행(LLM 불필요)
    ③ 남은 키는 LLM ReAct 루프(키 있을 때)로 계획→실행→점검→재계획. 반환 {값키: 성공여부}.
    값 없음이면 빈 dict(호출부 무변화). 결정론 계층 덕에 API 키 없이도 라벨 변형에 견고."""
    result = {}
    want = {k: str(v) for k, v in (values or {}).items() if v}
    if not want:
        return result

    # ── 계층 1: 결정론 의미매칭(무료·오프라인) — 접근성 이름으로 칸을 찾아 로컬 입력 ──
    try:
        fields0 = await ctx.evaluate(_COLLECT_JS)
    except Exception:
        fields0 = None
    if isinstance(fields0, list) and fields0:
        det = _deterministic_plan(fields0, list(want.keys()))
        if det:
            got0 = await _execute_plan(ctx, page, det, want, allow_clicks=False)
            result.update({k: v for k, v in got0.items() if v})

    # ── 계층 2: LLM ReAct(키 있을 때·남은 키만) — 결정론이 못 맞춘 어려운 폼 ──
    if all(result.get(k) for k in want):
        return result  # 결정론만으로 완료 — LLM 불필요
    if not ai_fill_enabled():
        return result  # 키 없음 — 결정론 결과까지만(그래도 예전보다 똑똑)
    unfinished = [k for k in want.keys() if not result.get(k)]
    for rnd in range(max(1, rounds)):
        try:
            fields = await ctx.evaluate(_COLLECT_JS)  # 인지(구조) — 라운드마다 신선하게 재수집
        except Exception:
            return result
        if not isinstance(fields, list) or not fields:
            return result
        img = ""
        if vision_enabled():
            img = await _masked_screenshot_b64(page)  # 인지(비전, 옵트인) — 값 마스킹 후 촬영
        prompt = build_prompt([f for f in fields if not f.get("ro")], unfinished, page_hint,
                              allow_clicks=allow_clicks and clicks_enabled(),
                              unfinished=unfinished if rnd > 0 else None)
        try:
            loop = asyncio.get_running_loop()
            text = await loop.run_in_executor(None, lambda: _ask_llm(prompt, 14, img))
        except Exception:
            return result
        plan = _parse_plan(text)
        if not plan:
            break
        if task is not None and rnd == 0:
            try:
                task.update("running",
                            f"🤖 AI 채움(β): 화면을 읽고 {len(plan)}개 행동을 계획했어요 — 값은 이 PC에서만 입력됩니다.")
            except Exception:
                pass
        got = await _execute_plan(ctx, page, plan, want, allow_clicks)
        result.update({k: v for k, v in got.items() if v or k not in result})
        unfinished = [k for k in want.keys() if not result.get(k)]
        if not unfinished:
            break  # 점검 통과 — 전 키 완료
    return result
