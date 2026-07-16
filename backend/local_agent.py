# -*- coding: utf-8 -*-
"""
모두봄 로컬 에이전트 — '진짜 크롬 + CDP' 방식 정부24 서류 자동발급.

기존 실패 원인 두 가지를 근본 해결:
  1) Playwright 번들 크로미움은 정부24 Mbuster 안티매크로에 차단됨 → 사용자의 '진짜 크롬'을
     원격 디버깅으로 띄우고 CDP로 붙는다(navigator.webdriver=false → Mbuster 통과 실측 확인).
  2) 확장 debugger 좌표 클릭은 불안정 → Playwright 신뢰 클릭 + 프레임 API로 안정 자동화.

흐름(주민등록등본 기준):
  로그인 → 간편인증(카카오) 선택 → simpleCert iframe에 이름·생년월일·휴대폰·전체동의 자동입력
  → [📱 사용자가 '인증 요청' + 카카오 승인] → 로그인 완료 대기 → 발급 폼 → 신청 → 문서출력 → PDF 저장

개인정보(이름·생년월일·휴대폰)는 이 PC 안에서만 쓰이고 서버로 전송되지 않는다.
실행은 run-agent-cdp.bat 이 크롬을 띄우고 이 스크립트를 호출한다.
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Frame, Page

CDP_URL = os.environ.get("MODOO_CDP_URL", "http://127.0.0.1:9222")
HERE = Path(__file__).resolve().parent
PROFILE_PATH = HERE / "agent_profile.json"   # {name, birth(YYYYMMDD), phone(01012345678)} — gitignored, 로컬 전용
SAVE_DIR = Path(os.path.expanduser("~")) / "Desktop" / "모두봄서류"

# 서류별 정부24 안내페이지(AA020) — '발급하기'(AA040 폼)로 이어지는 서류만 포함.
# ⚠️ 실측(cdp-docs.mjs): AA020에 a[href*=AA040OfferMainFrm]가 있는 서류만 이 흐름으로 발급됨.
#    가족관계증명서(97400000004)·국민연금 가입자 증명서(14600000312)는 별도 발급 흐름이라
#    AA040 링크가 없어 제외(잘못 지원한다고 하지 않음 — 정직성). 필요 시 각 기관 경로로 후속 확장.
# ⚠️ 이 맵은 rpa/gov24_rpa.DOC_CAPP(async 단일 소스)와 CappBizCD가 일치해야 한다 — 데스크탑 CDP 경로와
#    서버 RPA 경로가 같은 서류를 같은 흐름으로 발급(test_smart_agent가 정합성 고정). '가족관계증명서'만 제외.
DOCS = {
    "주민등록등본": "13100000015",
    "주민등록초본": "13100000015",
    "장애인증명서": "14600000273",
    "소득금액증명": "12100000021",
    "지방세 납세증명서": "13100000056",
    "지방세 세목별 과세증명서": "13100000084",
    "기초생활수급자 증명서": "14600000280",
    "한부모가족 증명서": "10601000001",
    # ↓ 2026-07-11 AA020 실측 검증 4종(gov24_rpa와 동일) — 데스크탑 원-로그인 연쇄발급에도 확장(8→12종).
    #   즉시발급형·본인·무료. 건강보험료 납부확인서는 영숫자 CappBizCD(issue_url이 문자열 연결이라 무관).
    "국세 납세증명서": "12100000011",
    "출입국에 관한 사실증명": "12700000024",
    "병적증명서": "13000000016",
    "건강보험료 납부확인서": "SG4CADM2017",
}

def resolve_doc(name: str):
    """표기 변형 흡수(공백 무시 부분일치). 미지원이면 None."""
    if name in DOCS:
        return name
    n = (name or "").replace(" ", "")
    for k in DOCS:
        if n and (n in k.replace(" ", "") or k.replace(" ", "") in n):
            return k
    return None

def log(msg: str):
    print(f"[모두봄] {msg}", flush=True)

def issue_url(capp: str) -> str:
    return (f"https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD={capp}"
            f"&HighCtgCD=A01010001&tp_seq=01&Mcode=10200")

def load_profile() -> dict:
    if PROFILE_PATH.exists():
        try:
            return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    # 파일 없으면 대화형 입력(로컬에만 저장)
    log("본인인증 정보를 입력하세요(이 PC에만 저장, 서버 전송 없음).")
    name = input("  이름: ").strip()
    birth = input("  생년월일 8자리(예 19900101): ").strip()
    phone = input("  휴대폰 11자리(예 01012345678): ").strip()
    prof = {"name": name, "birth": birth, "phone": phone}
    try:
        PROFILE_PATH.write_text(json.dumps(prof, ensure_ascii=False), encoding="utf-8")
        log(f"저장됨: {PROFILE_PATH} (다음부터 자동)")
    except Exception:
        pass
    return prof

def get_page(browser) -> Page:
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    for p in ctx.pages:
        if "newtab" not in p.url and "devtools" not in p.url:
            return p
    return ctx.new_page()

def wait_mbuster(page: Page, secs: int = 40) -> bool:
    """Mbuster 보안 인터스티셜 통과 → 로그인 화면(간편인증 텍스트) 도달."""
    for _ in range(secs):
        try:
            if "간편인증" in (page.inner_text("body") or ""):
                return True
        except Exception:
            pass
        page.wait_for_timeout(1000)
    return False

def simplecert_frame(page: Page, secs: int = 20):
    for _ in range(secs):
        for f in page.frames:
            if "simpleCert" in f.url:
                return f
        page.wait_for_timeout(1000)
    return None

def fill_auth(frame: Frame, prof: dict) -> bool:
    """simpleCert iframe: 카카오톡 선택 + 이름·생년월일·휴대폰·전체동의 자동입력."""
    filled = False
    try:
        frame.locator("li", has_text="카카오톡").first.click(timeout=4000)
    except Exception:
        pass
    frame.wait_for_timeout(400)
    name = (prof.get("name") or "").strip()
    birth = "".join(ch for ch in str(prof.get("birth") or "") if ch.isdigit())
    phone = "".join(ch for ch in str(prof.get("phone") or "") if ch.isdigit())
    # 휴대폰 앞 3자리(01X) 뒤 자리만 입력칸에 채움 — 010뿐 아니라 011/016~019도 대응
    tail = phone[3:] if phone.startswith("01") and len(phone) >= 10 else phone
    for sel, val in [("#oacx_name", name), ("#oacx_birth", birth), ("#oacx_phone2", tail)]:
        if not val:
            continue
        try:
            frame.fill(sel, val, timeout=2500)
            filled = True
        except Exception:
            pass
    try:
        cb = frame.locator("#totalAgree")
        if cb.count() and not cb.is_checked():
            cb.check(timeout=2000)
    except Exception:
        pass
    return filled

def wait_logged_in(page: Page, secs: int = 180) -> bool:
    """카카오 폰 승인 후 로그인 완료 대기(로그아웃 링크/URL 전환 감지)."""
    for _ in range(secs):
        try:
            body = page.inner_text("body") or ""
            if "로그아웃" in body or "logout" in (page.url or "").lower():
                return True
        except Exception:
            pass
        page.wait_for_timeout(1000)
    return False

def save_pdf(page: Page, filename: str):
    """헤드리스가 아닌 진짜 크롬에서 현재 페이지를 CDP Page.printToPDF로 PDF 저장."""
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    out = SAVE_DIR / filename
    try:
        client = page.context.new_cdp_session(page)
        res = client.send("Page.printToPDF", {"printBackground": True})
        import base64
        out.write_bytes(base64.b64decode(res["data"]))
        log(f"📄 PDF 저장 완료: {out}")
        return True
    except Exception as e:
        log(f"PDF 저장 실패({e}) — 화면에서 Ctrl+P로 저장하세요.")
        return False

def do_login(page: Page, prof: dict) -> bool:
    """로그인 1회 — Mbuster 통과 → 간편인증 → 인증창 자동입력 → [사용자 카카오 승인] → 로그인 완료."""
    log("정부24 로그인 페이지 여는 중…")
    page.goto("https://plus.gov.kr/login", wait_until="domcontentloaded", timeout=45000)
    if not wait_mbuster(page):
        log("보안 확인이 오래 걸려요. 창을 확인해 주세요.")
    log("간편인증 선택…")
    try:
        page.locator("button.login-type", has_text="간편인증").first.click(timeout=8000)
    except Exception:
        log("'간편인증' 버튼을 찾지 못했어요. 화면에서 직접 눌러 주세요.")
    frame = simplecert_frame(page)
    if frame:
        ok = fill_auth(frame, prof)
        log("✅ 인증 정보 자동 입력 완료." if ok else "인증 창에 정보를 입력해 주세요.")
    log("📱 이제 화면의 '인증 요청'을 누르고 카카오톡에서 [인증하기]를 완료해 주세요. (대기 중…)")
    if not wait_logged_in(page):
        log("로그인 완료를 확인하지 못했어요. 인증을 끝내면 다시 실행해 주세요.")
        return False
    log("로그인 완료!")
    # 로그인 직후 '회원정보 재확인' 안내가 뜨면 건너뛰기(현재 정보 유지)
    try:
        body = page.inner_text("body") or ""
        if "회원정보" in body and "재확인" in body:
            for t in ["현재 정보 유지", "다음에 변경", "나중에", "유지"]:
                b = page.get_by_text(t, exact=False)
                if b.count():
                    b.first.click(timeout=3000)
                    page.wait_for_timeout(1500)
                    break
    except Exception:
        pass
    return True

def issue_one(page: Page, doc_name: str) -> bool:
    """로그인 상태에서 서류 1건 발급 → 문서출력 → PDF 저장. (로그인은 do_login에서 1회)"""
    capp = DOCS[doc_name]
    log(f"── '{doc_name}' 발급 시작 ──")
    page.goto(issue_url(capp), wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2500)
    # '발급하기'(= a[href*=AA040OfferMainFrm]) 신뢰 클릭. href가 상대경로라 goto 아닌 클릭으로 이동(실측).
    try:
        link = page.locator("a[href*='AA040OfferMainFrm']").first
        if link.count():
            try:
                link.click(timeout=6000)
            except Exception:
                href = link.get_attribute("href") or ""
                if href.startswith("/"):
                    href = "https://www.gov.kr" + href
                if href.startswith("http"):
                    page.goto(href, wait_until="domcontentloaded")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(2500)
    except Exception:
        pass
    if doc_name == "주민등록초본":  # 초본 유형 선택(등본은 기본값)
        try:
            lab = page.get_by_text("초본", exact=True)
            if lab.count():
                lab.first.click(timeout=2500)
        except Exception:
            pass
    log("발급 정보 확인 후 신청… (5초 후 자동 신청)")
    page.wait_for_timeout(5000)
    clicked = False
    for sel in ["#btnMinwonApply", "#btnApply"]:
        try:
            if page.locator(sel).count():
                page.locator(sel).first.click(timeout=4000)
                clicked = True
                break
        except Exception:
            pass
    if not clicked:
        try:
            page.get_by_text("신청하기", exact=False).first.click(timeout=4000)
            clicked = True
        except Exception:
            pass
    log("신청 제출 중… 전자서명 창이 뜨면 본인 확인해 주세요." if clicked else "화면의 '신청하기'를 눌러 주세요.")
    # 문서출력 → PDF(새 탭 popup 우선 저장)
    ymd = time.strftime("%Y%m%d")
    fname = f"모두봄_{doc_name}_{ymd}.pdf"
    saved = False
    for _ in range(120):
        try:
            if "문서출력" in (page.inner_text("body") or ""):
                ctx = page.context
                try:
                    with ctx.expect_page(timeout=6000) as pop:
                        page.get_by_text("문서출력", exact=False).first.click(timeout=3000)
                    newp = pop.value
                    newp.wait_for_load_state("domcontentloaded")
                    newp.wait_for_timeout(1500)
                    saved = save_pdf(newp, fname)
                except Exception:
                    page.wait_for_timeout(1500)
                    saved = save_pdf(page, fname)
                if saved:
                    break
        except Exception:
            pass
        page.wait_for_timeout(1000)
    if saved:
        log(f"🎉 '{doc_name}' 발급 완료! PDF: {SAVE_DIR / fname}")
    else:
        log(f"'{doc_name}' 발급이 진행 중… 완료되면 화면의 [문서출력]으로 저장하세요.")
    return saved

def run(doc_names):
    if isinstance(doc_names, str):
        doc_names = [doc_names]
    docs = []
    for n in doc_names:
        r = resolve_doc(n)
        if r and r not in docs:
            docs.append(r)
        elif not r:
            log(f"이 스크립트가 지원하는 정부24 서류가 아니에요(건너뜀): {n}")
    if not docs:
        log("발급할 정부24 서류가 없어요.")
        return
    prof = load_profile()
    with sync_playwright() as pw:
        log("진짜 크롬에 연결 중(CDP)…")
        # 크롬이 원격 디버깅으로 뜨는 데 시간이 걸릴 수 있어 최대 ~15초 재시도
        browser = None
        for attempt in range(10):
            try:
                browser = pw.chromium.connect_over_cdp(CDP_URL)
                break
            except Exception:
                if attempt == 0:
                    log("크롬 연결 대기 중… (run-agent-cdp.bat가 크롬을 띄웠는지 확인)")
                time.sleep(1.5)
        if browser is None:
            log("❌ 크롬에 연결하지 못했어요. run-agent-cdp.bat로 실행했는지, 9222 포트가 열렸는지 확인해 주세요.")
            return
        page = get_page(browser)
        if not do_login(page, prof):
            return
        # 한 번의 로그인으로 여러 서류를 연달아 발급(로그인 세션 재사용).
        # ⚠️ 한 서류에서 예외(타임아웃·탭 닫힘 등)가 나도 전체가 죽지 않고 다음 서류로 계속.
        ok_count = 0
        for i, d in enumerate(docs):
            if i > 0:
                log(f"다음 서류로 진행… (남은 {len(docs) - i}건)")
            try:
                if issue_one(page, d):
                    ok_count += 1
            except Exception as e:
                log(f"'{d}' 처리 중 문제가 있어 건너뜁니다({str(e)[:50]}). 나머지는 계속 진행해요.")
        log(f"끝! 총 {len(docs)}건 중 {ok_count}건 저장 완료. (바탕화면\\모두봄서류)")

def pick_docs_interactive():
    """인자가 없을 때 발급할 서류를 번호로 고르게 한다(여러 개는 쉼표). 기본=등본."""
    names = list(DOCS.keys())
    print("\n발급할 서류를 고르세요 (여러 개면 쉼표로, 예: 1,3). 그냥 Enter = 주민등록등본")
    for i, n in enumerate(names, 1):
        print(f"  {i}) {n}")
    sel = input("선택: ").strip()
    if not sel:
        return ["주민등록등본"]
    out = []
    for tok in sel.replace(" ", "").split(","):
        if tok.isdigit() and 1 <= int(tok) <= len(names):
            out.append(names[int(tok) - 1])
        elif tok:
            r = resolve_doc(tok)
            if r:
                out.append(r)
    return out or ["주민등록등본"]

if __name__ == "__main__":
    args = sys.argv[1:]
    run(args if args else pick_docs_interactive())
