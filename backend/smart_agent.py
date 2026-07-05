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
        furl = getattr(fr, "url", "") or ""
        for it in res.get("items", []):
            it["frame"] = fr
            it["frame_url"] = furl  # 본인인증 위젯(iframe) URL 감지용
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
- '발급하기/문서출력/다음/동의/조회' 같은 진행 버튼을 찾아 목표로 나아가라.
- ⚠️ '취소·탈퇴·삭제·철회·해지·로그아웃' 등 파괴적/이탈 버튼은 절대 누르지 마라.
- ⚠️ '제출/신청하기/최종신청/결제/납부' 같은 **최종 제출** 버튼은 네가 누르지 말고 action="human_submit"으로
  사람에게 넘겨라(비가역·법적 행위는 사람이 확인). 발급 폼 작성까지만 하고 최종 제출은 사람 몫.
- 목표 서류의 발급 버튼이 화면에 안 보이면(처음 보는 서류일 때) 사이트의 '검색' 입력칸에
  action="search"로 서류명을 넣어 찾아라(fill 후 자동 Enter). 검색 결과에서 해당 서류를 클릭해 발급으로 이어간다.
- 같은 버튼을 반복해 누르지 마라(효과가 없으면 다른 요소나 wait/done을 택하라).
- 목표를 이룬 것으로 보이면(발급 완료/문서출력 화면) action="done".
- 팝업/광고/안내는 무시하거나 닫고 본류로 진행.

- 목록(번호)에 있는 요소는 반드시 idx로 지목(가장 정확). 목록에 없는데 화면(스크린샷)에만 보이는
  버튼/영역(캔버스·이미지 위젯 등)은 action="click_xy"로 그 지점의 화면 좌표(x,y)를 준다.

출력 형식(JSON):
{"action":"click|fill|search|goto|wait|human_auth|human_submit|done|click_xy","idx":<요소번호 또는 null>,"x":<click_xy일 때 가로px>,"y":<click_xy일 때 세로px>,"value":"<fill/search/goto일 때 값>","reason":"<한 문장>"}"""


# 파괴적·이탈 라벨 — 절대 자동 클릭 금지(취소·탈퇴·삭제·로그아웃 등)
_BLOCK = ("취소", "탈퇴", "삭제", "철회", "해지", "로그아웃", "로그 아웃", "닫기", "뒤로", "이전으로", "초기화")
# 최종 제출류 — 비가역·법적 행위라 사람이 직접 확인 후 눌러야(human-in-the-loop)
_SUBMIT = ("제출", "최종신청", "최종 신청", "신청완료", "신청 완료", "결제", "납부", "지급신청", "지급 신청")
# 자동 진행 OK인 안전 버튼(문서 발급·네비게이션). '확인'은 삭제확인 등 오탐 위험이라 제외.
_SAFE = ("문서출력", "간편인증", "발급하기", "발급받기", "발급", "조회하기", "조회", "다음", "동의")


def _clicked_count(history, lab: str) -> int:
    """history 전체에서 이 라벨을 클릭한 횟수(핑퐁·반복 클릭 감지용)."""
    key = (lab or "").strip()[:12]
    return sum(1 for h in history if key and key in h) if key else 0


def _bad_label(lab: str) -> bool:
    return any(b in lab for b in _BLOCK) or "비회원" in lab or "안내" in lab


def decide_heuristic(goal: str, url: str, elements, history) -> dict:
    """LLM 키가 없을 때의 규칙 기반 판단 — 라벨로 '진행 버튼'을 우선순위로 고른다(하드코딩 셀렉터 아님).
    안전장치: 파괴적 버튼(취소·탈퇴·삭제) 자동클릭 금지, 최종 제출은 사람에게(human_submit),
    같은 버튼을 2회 이상 누르면 건너뜀(핑퐁 방지). 흔한 발급 흐름은 스스로 따라간다."""
    labels = {e["idx"]: (e.get("label") or "") for e in elements}

    # ① 본인인증 화면 감지 → 사람에게. (a) 인증 위젯 iframe URL, (b) 이름/생년월일 입력칸 조합
    auth_frame = any(
        any(t in (e.get("frame_url") or "") for t in ("simpleCert", "oacx", "fincert", "yeskey"))
        for e in elements
    )
    if auth_frame or any("oacx" in (labels[i] or "").lower() for i in labels) \
       or any(("홍길동" in labels[i] or "생년월일" in labels[i]) for i in labels):
        return {"action": "human_auth", "reason": "본인인증 화면 감지 — 사람이 폰 인증"}

    def _pick(keywords):
        for kw in keywords:
            for e in elements:
                if e.get("kind") != "click":
                    continue
                lab = e.get("label") or ""
                if _bad_label(lab):
                    continue
                if kw in lab:
                    if _clicked_count(history, lab) >= 2:  # 핑퐁·반복 클릭 방지
                        continue
                    return e, kw
        return None, None

    # ② 안전 진행 버튼(문서 발급·네비게이션) → 자동 클릭
    e, kw = _pick(_SAFE)
    if e:
        return {"action": "click", "idx": e["idx"], "reason": f"'{kw}' 진행 버튼"}

    # ③ 최종 제출류만 남음 → 사람이 확인 후 제출(비가역·법적 행위, 대리 제출 안 함)
    e, kw = _pick(_SUBMIT + ("신청하기", "신청"))
    if e:
        return {"action": "human_submit", "idx": e["idx"],
                "reason": f"'{kw}'는 최종 제출 — 사람이 내용 확인 후 직접"}

    if any("완료" in labels[i] or "출력" in labels[i] for i in labels):
        return {"action": "done", "reason": "완료/출력 화면으로 보임"}

    # ④ 진행 버튼을 못 찾음 → '처음 보는 서류'일 수 있으니 사이트 검색으로 목표 서류를 찾아본다.
    #    실제로 search 액션을 실행한 적이 있을 때만 '검색함'으로 본다(단순 '통합검색' 클릭 라벨에 오판 방지).
    already_searched = any(h.startswith("search ") for h in history)
    if not already_searched:
        query = goal
        for w in ("발급", "신청", "받기", "떼기", "출력", "조회"):
            query = query.replace(w, "")
        query = query.strip()
        if query:
            for e in elements:
                lab = (e.get("label") or "")
                kind = e.get("kind") or ""
                is_search = ("검색" in lab or "search" in kind.lower()
                             or (("text-input" in kind or "search-input" in kind) and "검색" in lab))
                if is_search and ("input" in kind or "text" in kind):
                    return {"action": "search", "idx": e["idx"], "value": query,
                            "reason": f"처음 보는 서류 → 사이트 검색으로 '{query}' 찾기"}
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
    if a == "human_submit":
        # 최종 제출은 대리하지 않는다(비가역·법적 행위) — 화면을 사람에게 넘긴다.
        log("✋ 최종 제출 단계입니다. 내용을 확인하시고 '신청/제출'은 직접 눌러 주세요(대리 제출 안 함).")
        return "human_submit"
    el = find_el(elements, idx) if idx is not None else None
    if not el:
        page.wait_for_timeout(800)
        return "noop"
    loc = el["frame"].locator(f'[data-modoo-idx="{idx}"]').first
    try:
        if a == "search":  # 검색어 입력 후 Enter로 실제 검색 실행(처음 보는 서류 찾기)
            loc.fill(val, timeout=5000)
            loc.press("Enter")
            page.wait_for_timeout(1500)
            return "search"
        if a == "fill":
            loc.fill(val, timeout=5000)
        else:  # click(기본)
            loc.click(timeout=6000)
        page.wait_for_timeout(1200)
        return a or "click"
    except Exception as e:
        return f"실패({str(e)[:30]})"


def run_smart(goal: str):
    # 하이브리드: '아는 서류'는 실측 검증된 결정적 경로(local_agent)로 확실하게,
    # '처음 보는 서류/사이트'는 아래 LLM 관찰-판단-실행 루프로 스스로 찾아간다.
    # (데모 안정성 + 일반화 능력을 동시에. 검증 경로가 있으면 굳이 화면을 헤매지 않는다.)
    known = la.resolve_doc(goal)
    if known:
        log(f"'{known}'은 실측 검증된 서류 → 검증된 빠른 경로로 발급합니다(더 안정적).")
        la.run([known])
        return
    log(f"'{goal}'은 처음 보는 목표 → 화면을 읽어 스스로 발급 흐름을 찾습니다(지능형 모드).")

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
            # LLM 경로 안전망: 같은 버튼을 3번 이상 누르려 하면(집착·핑퐁) 멈춘다 — 휴리스틱엔 이미 가드 있음.
            if a == "click" and tgt and _clicked_count(history, tgt.get("label", "")) >= 3:
                log("같은 버튼을 반복해 눌러 멈춥니다(무한 반복 방지). 화면을 확인해 주세요.")
                break
            log(f"[{step}] {a} {('→ ' + tgt['label']) if tgt else ''} · {reason[:50]}")
            result = execute(action, page, elements, prof)
            history.append(f"{a} {(tgt['label'] if tgt else action.get('value',''))} → {result}")
            if result == "done":
                log("🎉 에이전트가 목표 완료를 판단했어요. 화면·다운로드 폴더를 확인하세요.")
                break
            if result == "human_submit":
                log("여기까지 자동으로 진행했어요. 최종 '신청/제출'은 직접 확인 후 눌러 주세요(비가역·법적 행위).")
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
