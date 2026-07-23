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
    // 🌑 shadow DOM 관통 수집(2026 웹에이전트 SOTA: browser-use/Stagehand는 shadow root를 뚫는다).
    //   실측: 신형 정부/인증 위젯이 web component(open shadow root)로 렌더돼 document.querySelectorAll
    //   만으론 입력·버튼을 못 봤다. open shadow root를 재귀로 함께 훑어 요소를 인덱싱한다(closed는 불가).
    const SEL = 'input, select, textarea, button, a, [role=button], [role=checkbox], [role=radio]';
    const collectEls = (root, acc, depth) => {
        for (const el of root.querySelectorAll(SEL)) acc.push(el);
        if (depth < 5) for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) collectEls(el.shadowRoot, acc, depth + 1); }
        return acc;
    };
    for (const el of collectEls(document, [], 0)) {
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
            item.ro = !!(el.readOnly || el.disabled);
            if (tag === 'select') {
                item.options = [...el.options].slice(0, 20).map(o => (o.text || '').trim().slice(0, 16));
                // ⚠️ select는 placeholder 옵션('시도 선택' 등)이 기본이라 value가 truthy여도 '미선택'이다.
                //   selectedIndex>0 이고 선택 텍스트에 '선택'이 없을 때만 filled(실제 옵션 골라짐).
                const sel = el.options[el.selectedIndex];
                const st = sel ? (sel.text || '').trim() : '';
                item.filled = el.selectedIndex > 0 && st && !/선택|choose|select/i.test(st);
            } else {
                item.filled = !!(el.value && el.value.trim() && el.value.trim() !== '-');
            }
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

# 🌑 shadow DOM 관통 querySelector — 인덱싱된 요소(data-modoobom-ai)가 open shadow root 안에 있어도
#   찾는다. perception(_COLLECT_JS)이 shadow까지 인덱싱하므로, 값 검증·포커스·select 처리도 같은 관통이
#   필요하다(안 그러면 shadow 요소 채움이 '검증 실패'로 false negative). closed shadow root는 접근 불가.
_DQ = ("const dq=(s,r)=>{r=r||document;let e=r.querySelector(s);if(e)return e;"
       "const hs=r.querySelectorAll('*');for(let i=0;i<hs.length;i++){if(hs[i].shadowRoot){"
       "e=dq(s,hs[i].shadowRoot);if(e)return e;}}return null;};")

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


async def _mask_all_frames(page, js: str) -> None:
    """마스킹 스타일을 메인 문서뿐 아니라 '모든 자식 프레임'에 적용/해제한다.
    ⚠️ page.screenshot 은 iframe 까지 합성하므로, 폼이 프레임(복지로 fincert 등)에 있으면 메인만
       마스킹해선 입력값이 그대로 찍혔다(감사 확정 MED — '마스킹 스크린샷만 전송' 계약 위반)."""
    for fr in [page] + list(getattr(page, "frames", None) or []):
        try:
            await fr.evaluate(js)
        except Exception:
            pass


async def _masked_screenshot_b64(page) -> str:
    """입력값을 투명 처리한 마스킹 스크린샷(JPEG, base64) — 실패는 빈 문자열(텍스트 모드로 진행).
    전 프레임 마스킹(자식 iframe 입력값까지) 후 촬영, 촬영 뒤 반드시 전 프레임 마스킹 해제."""
    try:
        await _mask_all_frames(page, _MASK_ON_JS)
        await asyncio.sleep(0.15)
        raw = await page.screenshot(type="jpeg", quality=55)
        return base64.b64encode(raw).decode("ascii")
    except Exception:
        return ""
    finally:
        await _mask_all_frames(page, _MASK_OFF_JS)


async def _do_fill(ctx, page, sel: str, val: str) -> bool:
    """값 입력 3단 폴백(실키 → IME 삽입 → CDP fill) + 지연 재검증 — 자기만족 검증 금지.
    포커스 확보는 locator 클릭 우선, 오버레이가 클릭을 가로채면 JS 포커스로 폴백한다
    (efamily 휴대폰칸이 오버레이에 막혀 클릭 실패하던 실사용 교훈 — 포커스만 잡으면 키 입력은 통함).

    ⚠️ 키보드는 반드시 ctx 가 속한 '그 페이지'의 것을 쓴다(감사 확정 MED): ctx 가 프레임/팝업인데
       원본 page.keyboard 로 타이핑하면 포커스는 ctx 에 잡고 키는 원본 페이지의 다른 칸에 들어가
       정상 기입값을 지우거나 이름을 엉뚱한 곳에 쓰던 갭 — ctx→소유 페이지 키보드로 정합화."""
    loc = ctx.locator(sel)
    kb = getattr(ctx, "keyboard", None) or getattr(getattr(ctx, "page", None), "keyboard", None) or page.keyboard
    for method in ("type", "insert", "fill"):
        try:
            if method == "fill":
                await loc.fill(val, timeout=4000)  # CDP fill은 자체 포커스 — 오버레이 무관
            else:
                # 실키 타이핑은 포커스가 필요 — 클릭 실패 시 JS 포커스로 폴백(클릭 못 해도 키는 포커스에 들어감)
                try:
                    await loc.click(timeout=3000)
                except Exception:
                    focused = await ctx.evaluate(
                        "(s) => { " + _DQ + " const e = dq(s); if (!e) return false;"
                        " e.focus(); return e.getRootNode().activeElement === e; }", sel)
                    if not focused:
                        continue  # 포커스조차 못 잡으면 키 입력은 무의미 — 다음 방법(CDP fill)으로
                await kb.press("Control+a")
                await kb.press("Delete")
                if method == "type" and val.isascii():
                    await kb.type(val, delay=45)
                else:
                    # 한글 등 비ASCII 키 타이핑은 IME 없는 브라우저에서 영타(김상식→rlatkdtlr)가 된다
                    await kb.insert_text(val)
            await asyncio.sleep(0.5)
            # '값 일치' 검증 — 비어있지 않음만 보면 영타 오입력(rlatkdtlr)도 통과한다(실사용 확정).
            #   숫자 값은 포맷팅(하이픈 등) 관용, 그 외는 정확 일치. 비교는 브라우저 안에서만.
            ok = await ctx.evaluate(
                "(a) => { " + _DQ + """ const e = dq(a.s); if (!e || !e.value) return false;
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
                    "(s) => { " + _DQ + " const e = dq(s);"
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
                    "(a) => { " + _DQ + """ const e = dq(a.s); if (!e || e.tagName !== 'SELECT') return false;
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
                    "(s) => { " + _DQ + " const e = dq(s); return e ? e.tagName.toLowerCase() : ''; }", sel)
                if info == "select":
                    ok = await ctx.evaluate(
                        "(a) => { " + _DQ + """ const e = dq(a.s); if (!e) return false;
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
#   pref: 이 의도가 선호하는 role — 같은 이름 요소가 여럿일 때(휴대폰 행의 앞자리 select vs 뒷자리
#   input) 값에 맞는 타입을 우선 고른다. 전화 뒷부분·이름·생년월일은 textbox, 시도/시군구는 combobox.
_INTENT_PATTERNS = {
    "name": (["성명", "이름", "신청인"], "textbox"),
    "birth6": (["주민등록번호", "생년월일", "주민번호"], "textbox"),
    "phone_tail": (["휴대폰", "핸드폰", "전화번호"], "textbox"),
    "phone_head": (["휴대폰", "핸드폰", "통신"], "combobox"),
    "parent_name": (["추가정보", "부성명", "모성명", "부모성명"], "textbox"),
    "sido": (["시도", "시·도", "특별시", "광역시", "주소"], "combobox"),
    "sigungu": (["시군구", "시·군·구", "군구"], "combobox"),
}

# 🚫 '타인 지시어' — 접근성 이름에 아래 말이 들어간 칸은 후보에서 제외한다.
#   복지로 신청서는 한 화면에 신청인·대리인·배우자·보호자·자녀 섹션이 함께 있어, '성명' 부분일치만으로
#   고르면 신청인 값이 배우자/대리인 칸에 잘못 들어갈 수 있다(실측 위험). 신청인 값(name/birth6/phone)은
#   명백한 '다른 사람' 칸을 건너뛴다. ⚠️ '세대주'는 신청인 본인인 경우가 흔해 제외하지 않는다(과잉 배제 방지).
_INTENT_NEG = {
    "name": ("대리인", "배우자", "보호자", "담당자", "상담", "부성명", "모성명", "자녀", "아동", "가구원"),
    "birth6": ("대리인", "배우자", "보호자", "자녀", "아동", "가구원"),
    # ⚠️ 전화도 이름·생년월일과 동일 원칙(감사 확정): 신청인 휴대폰이 이미 채워졌을 때 '배우자/자녀 휴대폰'
    #    빈 칸으로 흘러 신청인 번호가 타인 칸에 들어가던 갭 — 사람 지시어를 name/birth6 수준으로 맞춘다.
    "phone_tail": ("대리인", "배우자", "보호자", "담당자", "상담", "자녀", "아동", "가구원", "기관", "회사", "직장"),
    "phone_head": ("대리인", "배우자", "보호자", "담당자", "상담", "자녀", "아동", "가구원", "기관", "회사", "직장"),
}


def _deterministic_plan(fields: list, keys, preused=None) -> list:
    """접근성 이름 기반 결정론 계획 — LLM 없이 값 키↔요소를 매칭. 같은 이름 여럿이면 '선호 role' 우선
    → 문서순. 입력 role(textbox/combobox/spinbutton)만, filled/ro/이름없음/중복 idx/타인 칸 제외.
    preused: 앞선 전용 패스(쪼갠 휴대폰 등)가 이미 쓴 idx — 여기서 중복 처리하지 않는다."""
    plan = []
    used = set(preused or ())
    _norm = lambda s: str(s or "").replace(" ", "")
    for key in keys:
        spec = _INTENT_PATTERNS.get(key)
        if not spec:
            continue
        pats, pref = spec
        neg = _INTENT_NEG.get(key, ())

        def _is_applicant_field(f, _pats=pats, _neg=neg):
            # 이 의도의 '신청인' 칸인가 — 이름 패턴 일치 + 타인 지시어(배우자·대리인·가구원 등) 없음
            nm = _norm(f.get("name"))
            if not nm or not any(_norm(p) in nm for p in _pats):
                return False
            if _neg and any(_norm(n) in nm for n in _neg):
                return False
            return True

        # ⚠️ 의도 단위 멱등(감사 확정 HIGH): 이 의도의 '신청인' 칸이 이미 채워져 있으면(하드코딩 셀렉터가
        #    먼저 성공한 정상 케이스 등) 같은 패턴에 걸리는 '다음 빈 칸'(가구원·배우자 성명·배우자 휴대폰 등)
        #    으로 값을 흘리지 않는다 — 칸 단위 멱등('filled 제외')만으론 못 막던 신청인 값 오입력을 차단.
        if any(f.get("filled") and _is_applicant_field(f) for f in fields):
            continue
        cands = [f for f in fields
                 if f.get("idx") not in used and not f.get("ro") and not f.get("filled")
                 and f.get("role") in ("textbox", "combobox", "spinbutton")
                 and _is_applicant_field(f)]
        if not cands:
            continue
        # 선호 role 우선(문서순 안정) — phone_tail은 textbox, 시도는 combobox를 먼저 집는다
        cands.sort(key=lambda f: 0 if f.get("role") == pref else 1)
        f = cands[0]
        used.add(f["idx"])
        plan.append({"action": "select" if f.get("role") == "combobox" else "fill", "idx": f["idx"], "key": key})
    return plan


def _split_phone_plan(fields: list, want: dict):
    """📱 '휴대폰 가운데 자리 + 마지막 자리(+확인 재입력)'로 쪼개진 폼 대응(복지로 신청서 실측, 2026-07-21).

    배경: phone_tail(8자리)을 '휴대폰'이 든 첫 textbox 하나에 통째로 넣던 결정론 매칭은, 복지로처럼
    휴대폰이 [가운데 4][마지막 4]로 쪼개진 폼에서 8자리를 4자리 칸에 쏟아 넣고 마지막 칸은 비워
    필수입력이 채워지지 않았다(흐름 기록으로 실측 확인). 여기서 앞부분/뒤4자리로 나눠 각 칸에 채운다.
    '확인' 재입력 칸(이름에 휴대폰+가운데/마지막 포함)까지 같이 채운다. 유선 '전화번호'·타인(배우자·가구원)
    칸은 제외. 쪼개진 구조가 아니면 [](기존 단일 phone_tail 경로 유지). 반환: (plan, used_idx, vals)."""
    tail = re.sub(r"[^0-9]", "", str(want.get("phone_tail") or ""))
    if len(tail) < 7:
        return [], set(), {}
    mid, last = tail[:-4], tail[-4:]   # 010→4+4, 011→3+4 모두 안전(뒤 4자리 고정)
    _norm = lambda s: str(s or "").replace(" ", "")
    _OTHERS = ("배우자", "대리인", "보호자", "자녀", "아동", "가구원", "세대원", "기관", "회사", "직장")
    plan, used = [], set()
    has_mid = has_last = False
    for f in fields:
        if f.get("ro") or f.get("filled") or f.get("role") != "textbox":
            continue
        nm = _norm(f.get("name"))
        if ("휴대폰" not in nm and "핸드폰" not in nm) or any(o in nm for o in _OTHERS):
            continue  # 유선 전화번호·타인 칸 제외 — 신청인 휴대폰만
        if "가운데" in nm or "중간" in nm:
            plan.append({"action": "fill", "idx": f["idx"], "key": "__phone_mid"}); used.add(f["idx"]); has_mid = True
        elif "마지막" in nm or "끝" in nm:
            plan.append({"action": "fill", "idx": f["idx"], "key": "__phone_last"}); used.add(f["idx"]); has_last = True
    if not (has_mid and has_last):
        return [], set(), {}   # 쪼개진 폼 아님 — 기존 경로가 처리
    return plan, used, {"__phone_mid": mid, "__phone_last": last}


def _plan_respects_intent(plan: list, fields: list) -> list:
    """LLM 계획(idx 기반)을 실행 전 '타인 칸 가드'로 거른다 — 계층②(LLM)에도 _INTENT_NEG 적용.
    LLM이 배우자/대리인 성명 칸의 idx로 name 을 채우려 하면(환각·유사 라벨 혼동) 그 행동을 버린다."""
    _norm = lambda s: str(s or "").replace(" ", "")
    name_by_idx = {f.get("idx"): _norm(f.get("name")) for f in (fields or [])}
    out = []
    for it in plan:
        key = it.get("key") or ""
        neg = _INTENT_NEG.get(key, ())
        if neg:
            nm = name_by_idx.get(it.get("idx"), "")
            if nm and any(_norm(n) in nm for n in neg):
                continue  # 신청인 값(name/birth6/phone)을 타인 칸에 넣는 계획 — 실행 안 함
        out.append(it)
    return out


def _prompt_fields(fields: list, allow_clicks: bool) -> list:
    """프롬프트에 실을 요소만 남긴다 — 클릭 비활성(일반 채움) 시 버튼·링크는 제외(불필요 + innerText PII 차단).
    ⚠️ '홍길동님' 같은 마이페이지 링크 텍스트가 프롬프트로 새던 것(감사 확정 MED)을 구조적으로 막는다."""
    out = []
    for f in (fields or []):
        if f.get("ro"):
            continue
        role = f.get("role")
        is_action = role in ("button", "link") or "text" in f
        if is_action and not allow_clicks:
            continue  # fill/select 에는 버튼·링크가 불필요 — 프롬프트에서 제거(콘텐츠 경유 PII 차단)
        out.append(f if allow_clicks else {k: v for k, v in f.items() if k != "text"})
    return out


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
        # 📱 쪼개진 휴대폰 폼(가운데/마지막 + 확인 재입력) 전용 패스 — 8자리를 한 칸에 쏟던 오채움을
        #    앞부분/뒤4자리로 나눠 각 칸에 정확히 채운다(복지로 신청서 실측). 아니면 no-op(기존 경로).
        sp_plan, sp_used, sp_vals = _split_phone_plan(fields0, want)
        if sp_plan:
            got_sp = await _execute_plan(ctx, page, sp_plan, sp_vals, allow_clicks=False)
            result["phone_tail"] = bool(got_sp.get("__phone_mid") and got_sp.get("__phone_last"))
            want.pop("phone_tail", None)  # 쪼갠 칸이 담당 — 단일 phone_tail 경로로 재오염 금지
        det = _deterministic_plan(fields0, list(want.keys()), preused=sp_used)
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
        _ac = allow_clicks and clicks_enabled()
        prompt = build_prompt(_prompt_fields(fields, _ac), unfinished, page_hint,
                              allow_clicks=_ac,
                              unfinished=unfinished if rnd > 0 else None)
        try:
            loop = asyncio.get_running_loop()
            text = await loop.run_in_executor(None, lambda: _ask_llm(prompt, 14, img))
        except Exception:
            return result
        # ⚠️ LLM 계획도 타인 칸 가드를 통과시킨다(결정론 계층에만 있던 _INTENT_NEG를 LLM 계층에도 적용)
        plan = _plan_respects_intent(_parse_plan(text), fields)
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


# ── 🧭 observe → decide → click (내비게이션) — openclaw/browser-use식 SOTA를 '클릭 판단'에 적용 ──
#   ai_fill 이 '어느 칸에 무엇을 채울지'를 접근성 트리로 판단하듯, 여기선 '어느 버튼을 눌러야
#   목표에 도달하는지'를 같은 방식(클릭 가능 요소를 인덱싱해 라벨만 LLM에 전달)으로 판단한다.
#   왜 필요한가: 정부24 발급 흐름의 '문서출력·다음·발급' 클릭이 하드코딩 라벨(click_by_text)이라
#   사이트가 문구를 바꾸면 끊긴다 → 결정론 실패 시 self-heal 폴백으로 자연 복구.
#
#   프라이버시(불변): 버튼/링크의 '라벨'만 전송한다 — 입력값·문서 내용·개인정보는 담지 않는다.
#   ⚠️ '문서 화면이 다 떴는가'(발급물 렌더 판정)는 여기에 넣지 않는다 — 그 화면은 실명·주민번호를
#      그대로 담아, 스크린샷을 클라우드로 보내면 PII 유출이다. 렌더 판정은 브라우저 안(로컬)에서만
#      하는 결정론 픽셀 안정 검사(gov24_rpa._wait_document_rendered)가 담당한다.
_NAV_DENY = re.compile(r"제출|결제|삭제|탈퇴|해지|이체|취소|납부|송금")


def _safe_button_label(text: str) -> str:
    """클릭 후보의 '안전한' 라벨만 남긴다 — 마이페이지 '홍길동님·환영' 등 개인정보성 텍스트는 제외.
    (프롬프트로 나가는 것은 순수 버튼 문구여야 한다 — 이름이 라벨에 섞이는 링크는 후보에서 뺀다)."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t:
        return ""
    if re.search(r"[가-힣]{2,4}\s*님|환영|로그아웃|마이\s*페이지", t):
        return ""  # 개인정보성/계정 링크 — 내비게이션 후보 아님
    return t[:24]


def build_nav_prompt(goal: str, buttons: list) -> str:
    """내비게이션 판단 프롬프트 — 목표와 '클릭 가능 요소 라벨'만 담는다(값·개인정보 미포함)."""
    return (
        "당신은 한국 정부 웹사이트 자동화 에이전트입니다. 아래는 지금 화면에서 '클릭 가능한 요소'의 라벨 목록입니다.\n"
        f"목표: {goal}\n"
        "이 목표로 나아가려면 어느 요소를 눌러야 합니까? 제출·결제·삭제·취소 같은 '비가역/위험' 버튼은 절대 고르지 마세요.\n"
        "맞는 요소가 없으면 idx 를 -1 로 답하세요.\n"
        '설명 없이 JSON 하나만 출력: {"idx": N}\n'
        f"요소 목록: {json.dumps(buttons, ensure_ascii=False)}\n"
    )


async def _click_idx(ctx, idx) -> bool:
    """인덱싱된 요소를 '자가 치유(self-healing)' 클릭 — 성공하면 True.

    UiPath Healing Agent·BrowserStack식 복원력(실측 67% 실패 스텝 자가복구): 일시 실패
    (오버레이 가림·스크롤 밖·detached 요소)에 대비해 단계적으로 재시도한다 —
      ① 일반 클릭 → ② 화면에 들여(scroll into view) 재클릭 → ③ JS 합성 클릭(포인터 인터셉트 우회).
    짧은 지수 백오프. 3단계 모두 실패하면 False(상위가 다른 후보로 폴백)."""
    sel = f"[data-modoobom-ai='{idx}']"
    loc = ctx.locator(sel)
    for attempt in range(3):
        try:
            if attempt == 0:
                await loc.click(timeout=4000)
            elif attempt == 1:
                try:
                    await loc.scroll_into_view_if_needed(timeout=2000)  # 가림/스크롤 밖 해소 후 재시도
                except Exception:
                    pass
                await loc.click(timeout=4000)
            else:
                ok = await ctx.evaluate(
                    "(s) => { " + _DQ + " const e = dq(s); if (!e) return false; e.click(); return true; }", sel)
                if not ok:
                    return False  # 요소 자체가 사라짐(detached·제거) — 영구 실패, 재시도 무의미
            await asyncio.sleep(0.6)
            return True
        except Exception:
            await asyncio.sleep(0.35 * (attempt + 1))  # 지수(짧은) 백오프 — 일시 실패 완화
    return False


async def page_signature(ctx) -> str:
    """같은-페이지 진행 검증용 '지문' — URL + 요소 수 + 본문 길이(값·개인정보 미포함).
    행동 전/후 비교로 '실제로 화면이 바뀌었나'를 판정한다(Agent-E change-observer). ⚠️ 새 창을
    여는 행동엔 쓰지 말 것(같은 페이지는 안 변해 오판) — 호출부가 같은-페이지 진행에만 사용."""
    try:
        return await ctx.evaluate(
            "() => location.href + '|' + document.querySelectorAll('*').length + '|'"
            " + (document.body ? document.body.innerText.length : 0)")
    except Exception:
        return ""


async def act_and_verify(do_action, verify=None, attempts: int = 2) -> bool:
    """🔁 행동→검증→재시도 — CUA/Claude computer-use('행동 후 스크린샷으로 됐는지 확인')·Agent-E
    change-observer의 핵심 신뢰성 기법. '클릭은 됐지만 아무 일도 안 일어남'을 잡아 재시도/폴백하게 한다.

    do_action(): 코루틴 — 행동 실행(bool 반환 권장). verify(): 코루틴 → bool(기대한 변화가 실제로
    생겼는가). verify 가 None 이면 do_action 성공만으로 판정. 실패 시 짧은 백오프 후 최대 attempts 회."""
    for i in range(max(1, attempts)):
        try:
            acted = await do_action()
        except Exception:
            acted = False
        if verify is None:
            if acted:
                return True
        else:
            try:
                if await verify():
                    return True
            except Exception:
                pass
        await asyncio.sleep(0.4 * (i + 1))
    return False


def _match_score(bn: str, wn: str) -> int:
    """의미 접지(grounding) 점수화 — '첫 일치'가 아니라 정확일치>시작일치>부분일치로 오클릭을 줄인다
    (OSCAR/browser-use식 라벨 접지). bn/wn 은 공백 제거 정규화된 라벨."""
    if not bn or not wn:
        return 0
    if bn == wn:
        return 100
    if bn.startswith(wn) or wn.startswith(bn):
        return 60
    if wn in bn:
        return 45
    if bn in wn and len(bn) >= 2:
        return 40
    return 0


async def ai_pick_action(ctx, goal: str, want_texts: list = None, task=None, site: str = "", verify=None) -> bool:
    """🧭 목표(goal)에 맞는 버튼을 '화면을 이해해' 눌러 준다 — 클릭했으면 True.

    3계층(상위 RPA 성능 기법을 안전·Mock-safe·프라이버시 보존으로 적용):
      ⓪ 경로 기억(Skyvern route memorization): site 가 주어지면 (site,goal)의 '지난 성공 라벨'을 최우선
         후보로 먼저 시도 → 빠르고 일관됨. 안 맞으면 무효화(forget)하고 아래로.
      ① 결정론(무료·오프라인): want_texts(동의어)를 라벨 점수화(_match_score, 정확>시작>부분)로 지목.
      ② LLM(키+RPA_AI_FILL, 옵트인): 결정론이 못 찾으면 클릭 가능 요소를 인덱싱해 라벨만 보내고
         '어느 버튼이 goal 인가'를 판단(browser-use/Stagehand식 observe→decide).
    성공 시 클릭한 라벨을 route_cache 에 기억(다음 실행 가속). 안전: 제출/결제/삭제/취소 등은 결정론·
    LLM 양쪽에서 거부(_NAV_DENY), 개인정보성 라벨은 후보 제외. 프라이버시: 버튼 라벨만 전송·저장."""
    want_texts = list(want_texts or [])
    try:
        from rpa import route_cache
    except Exception:
        route_cache = None
    try:
        fields = await ctx.evaluate(_COLLECT_JS)
    except Exception:
        return False
    if not isinstance(fields, list) or not fields:
        return False
    _norm = lambda s: re.sub(r"\s+", "", str(s or ""))
    # 클릭 가능 요소만 정리(버튼·링크·submit) — 안전 라벨 + 거부목록 제외
    buttons = []
    for f in fields:
        role = f.get("role")
        if role not in ("button", "link") and f.get("type") not in ("submit", "button"):
            continue
        label = _safe_button_label(f.get("text") or f.get("name"))
        if not label or _NAV_DENY.search(_norm(label)):
            continue
        buttons.append({"idx": f.get("idx"), "text": label})
    cached = route_cache.get_label(site, goal) if (route_cache and site) else ""
    if not buttons:
        if cached and route_cache:
            route_cache.forget(site, goal)  # 후보 없음 — 옛 기억 무효화
        return False

    def _remember(lbl):
        if route_cache and site and lbl:
            route_cache.remember(site, goal, lbl)

    # ⓪+① 결정론 — 경로 기억 라벨을 최우선으로, want_texts 동의어를 라벨 점수화로 지목
    for wt in ([cached] if cached else []) + want_texts:
        wn = _norm(wt)
        if not wn:
            continue
        best, best_score = None, 0
        for b in buttons:
            sc = _match_score(_norm(b["text"]), wn)
            if sc > best_score:
                best, best_score = b, sc
        if best is not None and best_score > 0:
            if await _click_idx(ctx, best["idx"]):
                if verify is not None:
                    try:
                        if not await verify():
                            continue  # 클릭했지만 기대한 변화 없음 → 다음 후보로 자기수정
                    except Exception:
                        pass
                _remember(best["text"])
                return True
    # 경로 기억 라벨이 후보 어디에도 없으면(사이트 문구 변경 등) 무효화 — 다음엔 다시 학습
    if cached and route_cache and not any(_match_score(_norm(b["text"]), _norm(cached)) > 0 for b in buttons):
        route_cache.forget(site, goal)

    # ② LLM — 구조만 보고 판단(키 있을 때·옵트인)
    if not ai_fill_enabled():
        return False
    prompt = build_nav_prompt(goal, buttons)
    try:
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, lambda: _ask_llm(prompt, 12, ""))
    except Exception:
        return False
    m = re.search(r"\{[\s\S]*\}", text or "")
    if not m:
        return False
    try:
        idx = int(json.loads(m.group(0)).get("idx"))
    except Exception:
        return False
    if idx < 0:
        return False
    # LLM 이 고른 idx 도 거부목록 재검(환각으로 제출/결제를 고르는 것 차단)
    lbl = next((b["text"] for b in buttons if b["idx"] == idx), "")
    if not lbl or _NAV_DENY.search(_norm(lbl)):
        return False
    if task is not None:
        try:
            task.update("running", f"🧭 AI가 화면을 읽고 '{lbl}' 단계로 진행해요(값·개인정보는 전송하지 않아요).")
        except Exception:
            pass
    if await _click_idx(ctx, idx):
        if verify is not None:
            try:
                if not await verify():
                    return False  # LLM 선택 클릭이 화면을 바꾸지 못함 — 실패로 정직 보고
            except Exception:
                pass
        _remember(lbl)
        return True
    return False


async def ai_pick_action_deep(page, goal: str, want_texts: list = None, task=None,
                              site: str = "", verify=None) -> bool:
    """🪟 프레임 관통(unified cross-frame) observe→decide→click — 목표 버튼을 메인 페이지에서 못 찾으면
    자식 프레임(iframe)까지 훑어 클릭한다(browser-use/Stagehand의 cross-frame 트리 파리티).

    실측 배경(2026-07-23): plus.gov.kr 로그인 위젯이 메인 프레임 light DOM에 안 잡힘(shadow는 관통 완료,
    iframe 케이스 대비). 신형 정부/인증 폼은 콘텐츠가 프레임에 나뉘는 일이 잦다. 메인 우선이라 프레임이
    없거나 메인에 버튼이 있으면 기존 ai_pick_action과 100% 동일(순수 확장)."""
    if await ai_pick_action(page, goal, want_texts, task, site, verify):
        return True
    main = getattr(page, "main_frame", None)
    for fr in list(getattr(page, "frames", None) or []):
        if fr is main:
            continue
        try:
            # 프레임엔 task 알림·site 캐시를 넘기지 않는다(메인에서 이미 처리·중복 방지). verify 는 유지.
            if await ai_pick_action(fr, goal, want_texts, None, "", verify):
                return True
        except Exception:
            continue
    return False
