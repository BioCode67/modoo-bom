# -*- coding: utf-8 -*-
"""
모두봄 지능형 에이전트 (LLM-driven RPA) — 처음 보는 사이트 구조도 스스로 파악해 서류 발급.

기존 local_agent.py는 사이트별 셀렉터를 하드코딩해 '아는 사이트'만 됐다. 이 모듈은 한 단계 위:
  ┌ 관찰(Observe): 현재 페이지의 '상호작용 가능한 요소'를 접근성 트리처럼 번호 목록으로 추출
  ├ 판단(Reason):  목표 + 요소목록 + 히스토리를 LLM(Gemini/Claude)에 주고 다음 행동 1개를 받음
  └ 실행(Act):     Playwright(진짜 크롬+CDP, Mbuster 통과)로 클릭/입력/이동 → 반복

즉 browser-use·Skyvern류 '웹 에이전트'의 결정 계층을, 우리만의 'Mbuster 통과 실행 계층' 위에 얹었다.
셀렉터가 바뀌거나 처음 보는 정부/공공 사이트여도 LLM이 화면을 읽고 발급 흐름을 찾아간다.

본인인증(카카오 간편인증 등)은 감지되면 사람에게 넘긴다(비가역·법적 안전장치, 설계상 유지).
개인정보는 프롬프트에 최소만 담고 서버 저장/로깅하지 않는다.

⚠️ 결정 계층엔 LLM 키가 필요(GEMINI_API_KEY 무료 티어 권장). 없으면 규칙 힌트로 축소 동작.
실행:  run-agent-cdp.bat 로 크롬을 띄운 뒤  python smart_agent.py "주민등록등본 발급"
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright, Frame, Page

import local_agent as la  # 진짜 크롬 CDP 연결·프로필·PDF 저장 재사용
from agents.llm import get_chat_llm, active_provider

MAX_STEPS = 24


def log(msg: str):
    print(f"[스마트] {msg}", flush=True)


# ── 관찰: 상호작용 요소를 번호 목록으로 추출 ──────────────────────────────────
# 각 요소에 data-modoo-idx 임시 표식을 달아, LLM이 고른 번호를 그 표식으로 다시 클릭한다(재렌더에 견고).
_TAG_JS = r"""
(startIdx) => {
  const out = [];
  let i = startIdx;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed'); };
  const sel = 'a,button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[onclick],label';
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('alt') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!label && el.querySelector('img')) label = (el.querySelector('img').alt || '').slice(0, 40);
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const cur = (el.value || '').slice(0, 20);
      out.push({ idx: i, kind: tag === 'select' ? 'select' : (type || 'text') + '-input', label: label || '(입력칸)', value: cur, x: cx, y: cy });
    } else {
      if (!label) continue;
      out.push({ idx: i, kind: 'click', label, x: cx, y: cy });
    }
    el.setAttribute('data-modoo-idx', String(i));
    i++;
  }
  return { items: out, next: i };
}
"""


def observe(page: Page):
    """메인 + 같은 출처 iframe들의 상호작용 요소를 번호로 수집. (idx는 프레임 넘어 연속)"""
    elements = []  # {idx, kind, label, value, frame}
    frames = [page.main_frame] + [f for f in page.frames if f != page.main_frame]
    start = 1
    for fr in frames:
        try:
            res = fr.evaluate(_TAG_JS, start)
        except Exception:
            continue
        for it in res.get("items", []):
            it["frame"] = fr
            elements.append(it)
        start = res.get("next", start)
    return elements


def elements_text(elements) -> str:
    lines = []
    for e in elements[:80]:  # 토큰 절약: 상위 80개
        v = f" [현재값:{e['value']}]" if e.get("value") else ""
        lines.append(f"{e['idx']}. ({e['kind']}) {e['label']}{v}")
    return "\n".join(lines)


# ── 판단: LLM에게 다음 행동 1개를 받는다 ─────────────────────────────────────
_SYSTEM = """너는 한국 정부·공공 웹사이트에서 '민원 서류 발급/신청'을 대신 수행하는 브라우저 자동화 에이전트다.
현재 페이지의 '상호작용 가능한 요소 목록'(번호)과 목표를 보고, 목표에 한 걸음 다가가는 '다음 행동 1개'만 고른다.

규칙:
- 반드시 아래 JSON 하나만 출력. 설명 금지.
- 로그인 방식은 '간편인증'을 우선(공동/금융인증서보다 쉬움).
- 이름·생년월일·휴대폰을 넣는 '본인인증 창'이 보이면 action="human_auth" (사람이 폰 인증). 값을 대신 넣지 마라.
- '발급/신청/확인/다음/제출/문서출력' 같은 진행 버튼을 찾아 목표로 나아가라.
- 목표를 이룬 것으로 보이면(발급 완료/문서출력 화면) action="done".
- 팝업/광고/안내는 무시하거나 닫고 본류로 진행.

- 목록(번호)에 있는 요소는 반드시 idx로 지목(가장 정확). 목록에 없는데 화면(스크린샷)에만 보이는
  버튼/영역(캔버스·이미지 위젯 등)은 action="click_xy"로 그 지점의 화면 좌표(x,y)를 준다.

출력 형식(JSON):
{"action":"click|fill|goto|wait|human_auth|done|click_xy","idx":<요소번호 또는 null>,"x":<click_xy일 때 가로px>,"y":<click_xy일 때 세로px>,"value":"<fill/goto일 때 값>","reason":"<한 문장>"}"""


def decide_heuristic(goal: str, url: str, elements, history) -> dict:
    """LLM 키가 없을 때의 규칙 기반 판단 — 라벨로 '진행 버튼'을 우선순위로 고른다(하드코딩 셀렉터 아님).
    LLM만큼 똑똑하진 않지만 흔한 발급 흐름(간편인증→인증→발급/신청→문서출력)은 스스로 따라간다."""
    labels = {e["idx"]: (e.get("label") or "") for e in elements}
    kinds = {e["idx"]: e.get("kind") for e in elements}
    # 본인인증 창(이름/생년월일 입력칸이 보이면) → 사람에게
    if any("oacx" in (e.get("label") or "").lower() for e in elements) or \
       any(k and "input" in k for k in kinds.values()) and any("인증" in url for _ in [0]) is False and \
       any(("이름" in labels[i] or "생년월일" in labels[i] or "홍길동" in labels[i]) for i in labels):
        # 인증 위젯 특유의 입력칸 조합이면 human_auth
        if any(("홍길동" in labels[i] or "생년월일" in labels[i]) for i in labels):
            return {"action": "human_auth", "reason": "본인인증 입력창 감지"}
    done_recent = sum(1 for h in history[-3:] if "→ click" in h)
    PRIORITY = ["문서출력", "간편인증", "발급하기", "민원신청하기", "신청하기", "회원 신청하기", "발급", "신청", "다음", "확인", "동의"]
    for kw in PRIORITY:
        for e in elements:
            if e.get("kind") != "click":
                continue
            lab = e.get("label") or ""
            if kw in lab and "비회원" not in lab and "안내" not in lab:
                # 직전에 똑같은 걸 눌렀으면 건너뜀(무한루프 방지)
                if history and f"{lab}".strip()[:12] in history[-1]:
                    continue
                return {"action": "click", "idx": e["idx"], "reason": f"'{kw}' 진행 버튼"}
    if done_recent == 0 and any("완료" in labels[i] or "출력" in labels[i] for i in labels):
        return {"action": "done", "reason": "완료/출력 화면으로 보임"}
    return {"action": "wait", "reason": "진행 버튼을 못 찾음(대기)"}


def decide(llm, goal: str, url: str, elements, history, screenshot: bytes | None = None) -> dict:
    hist = "\n".join(history[-6:]) if history else "(없음)"
    human_text = (
        f"목표: {goal}\n"
        f"현재 URL: {url}\n\n"
        f"지금까지 한 행동:\n{hist}\n\n"
        f"상호작용 가능한 요소:\n{elements_text(elements)}\n\n"
        f"(첨부된 화면 스크린샷도 참고해 판단하세요. DOM에 안 잡히는 캔버스·이미지 위젯은 화면을 보고 대응.)\n"
        f"다음 행동 1개를 JSON으로:"
    ) if screenshot else (
        f"목표: {goal}\n현재 URL: {url}\n\n지금까지 한 행동:\n{hist}\n\n"
        f"상호작용 가능한 요소:\n{elements_text(elements)}\n\n다음 행동 1개를 JSON으로:"
    )
    from langchain_core.messages import SystemMessage, HumanMessage
    if screenshot:
        import base64
        b64 = base64.b64encode(screenshot).decode()
        content = [
            {"type": "text", "text": human_text},
            {"type": "image_url", "image_url": f"data:image/jpeg;base64,{b64}"},
        ]
        msg = HumanMessage(content=content)
    else:
        msg = HumanMessage(content=human_text)
    try:
        resp = llm.invoke([SystemMessage(content=_SYSTEM), msg])
    except Exception:
        # 멀티모달(이미지) 미지원 모델이면 텍스트만으로 재시도
        resp = llm.invoke([SystemMessage(content=_SYSTEM), HumanMessage(content=human_text)])
    text = str(resp.content)
    # JSON 추출(코드펜스/잡텍스트 방어)
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e < 0:
        return {"action": "wait", "reason": "LLM 응답 파싱 실패"}
    try:
        return json.loads(text[s:e + 1])
    except Exception:
        return {"action": "wait", "reason": "JSON 파싱 실패"}


# ── 실행: 행동을 Playwright로 수행 ───────────────────────────────────────────
def find_el(elements, idx):
    for e in elements:
        if e["idx"] == idx:
            return e
    return None


def execute(action: dict, page: Page, elements, prof: dict) -> str:
    a = action.get("action")
    idx = action.get("idx")
    val = action.get("value", "")
    if a == "done":
        return "done"
    if a == "goto" and val:
        page.goto(val if val.startswith("http") else "https://www.gov.kr" + val, wait_until="domcontentloaded", timeout=45000)
        return "goto"
    if a == "wait":
        page.wait_for_timeout(1500)
        return "wait"
    if a == "click_xy":  # DOM에 없는 화면상 지점을 '진짜 클릭'(Playwright는 신뢰 클릭)
        try:
            page.mouse.click(float(action.get("x", 0)), float(action.get("y", 0)))
            page.wait_for_timeout(1200)
            return "click_xy"
        except Exception as e:
            return f"실패({str(e)[:30]})"
    if a == "human_auth":
        # 인증 정보 자동입력 시도(있으면 편의) 후, 사람에게 폰 인증을 넘긴다
        for fr in page.frames:
            try:
                if fr.locator("#oacx_name").count():
                    la.fill_auth(fr, prof)
                    break
            except Exception:
                pass
        log("📱 본인인증 화면입니다. '인증 요청'을 누르고 카카오톡에서 인증을 완료해 주세요. (대기)")
        return "human_auth"
    el = find_el(elements, idx) if idx is not None else None
    if not el:
        page.wait_for_timeout(800)
        return "noop"
    loc = el["frame"].locator(f'[data-modoo-idx="{idx}"]').first
    try:
        if a == "fill":
            loc.fill(val, timeout=5000)
        else:  # click(기본)
            loc.click(timeout=6000)
        page.wait_for_timeout(1200)
        return a or "click"
    except Exception as e:
        return f"실패({str(e)[:30]})"


def run_smart(goal: str):
    llm = get_chat_llm(temperature=0.0, max_tokens=400) if active_provider() else None
    mode = "LLM 지능형" if llm else "규칙 폴백(LLM 키 없음 — GEMINI_API_KEY 넣으면 훨씬 똑똑해져요)"
    log(f"판단 방식: {mode}")
    prof = la.load_profile()
    with sync_playwright() as pw:
        log("진짜 크롬 연결(CDP)…")
        browser = None
        for _ in range(10):
            try:
                browser = pw.chromium.connect_over_cdp(la.CDP_URL); break
            except Exception:
                time.sleep(1.5)
        if not browser:
            log("크롬 연결 실패 — run-agent-cdp.bat로 실행했는지 확인."); return
        page = la.get_page(browser)
        # 시작점: 정부24 로그인(목표에 URL이 없으면 기본 진입점). LLM이 이후를 판단.
        if "http" not in goal:
            page.goto("https://plus.gov.kr/login", wait_until="domcontentloaded", timeout=45000)
            la.wait_mbuster(page, 30)
        history = []
        for step in range(1, MAX_STEPS + 1):
            page.wait_for_timeout(600)
            elements = observe(page)
            if llm:
                shot = None
                try:
                    shot = page.screenshot(type="jpeg", quality=45)  # 에이전트의 '눈' — 캔버스/이미지 위젯 대응
                except Exception:
                    shot = None
                action = decide(llm, goal, page.url[:80], elements, history, shot)
            else:
                action = decide_heuristic(goal, page.url[:80], elements, history)
            a, reason = action.get("action"), action.get("reason", "")
            tgt = find_el(elements, action.get("idx"))
            log(f"[{step}] {a} {('→ ' + tgt['label']) if tgt else ''} · {reason[:50]}")
            result = execute(action, page, elements, prof)
            history.append(f"{a} {(tgt['label'] if tgt else action.get('value',''))} → {result}")
            if result == "done":
                log("🎉 에이전트가 목표 완료를 판단했어요. 화면·다운로드 폴더를 확인하세요.")
                break
            if result == "human_auth":
                if la.wait_logged_in(page, 180):
                    history.append("사람 인증 완료 → 로그인됨")
                    log("로그인 완료 — 계속 진행합니다.")
                else:
                    log("인증 완료를 확인 못했어요. 인증 끝내고 다시 실행해 주세요."); break
        else:
            log("최대 단계에 도달했어요. 화면을 확인해 주세요(부분 진행됐을 수 있음).")


if __name__ == "__main__":
    goal = " ".join(sys.argv[1:]) or "주민등록등본 발급"
    run_smart(goal)
