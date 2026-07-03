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

# 서류별 정부24 안내페이지(AA020) — 발급 폼(AA040)로 이어진다. CappBizCD는 확장 background.js와 동일.
DOCS = {
    "주민등록등본": "13100000015",
    "주민등록초본": "13100000015",
    "가족관계증명서": "97400000004",
    "장애인증명서": "14600000273",
    "건강보험 자격득실확인서": None,   # 정부24 아님(별도) — 후속 확장
}

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
    tail = phone[3:] if phone.startswith("010") and len(phone) >= 10 else phone  # 010 뒤 8자리
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

def run(doc_name: str):
    capp = DOCS.get(doc_name)
    if not capp:
        log(f"현재 이 스크립트가 지원하는 정부24 서류가 아니에요: {doc_name}")
        return
    prof = load_profile()
    with sync_playwright() as pw:
        log("진짜 크롬에 연결 중(CDP)…")
        browser = pw.chromium.connect_over_cdp(CDP_URL)
        page = get_page(browser)

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
            return
        log("로그인 완료! 발급 페이지로 이동…")
        # 로그인 직후 '회원정보 재확인' 안내가 뜨면 건너뛰기(현재 정보 유지)
        try:
            if "회원정보" in (page.inner_text("body") or "") and "재확인" in (page.inner_text("body") or ""):
                for t in ["현재 정보 유지", "다음에 변경", "나중에", "유지"]:
                    b = page.get_by_text(t, exact=False)
                    if b.count():
                        b.first.click(timeout=3000)
                        page.wait_for_timeout(1500)
                        break
        except Exception:
            pass
        page.goto(issue_url(capp), wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        # 발급 폼으로: '발급하기'(= a[href*=AA040OfferMainFrm]) 링크를 신뢰 클릭.
        # ⚠️ href가 상대경로(/mw/AA040...)라 goto가 아니라 클릭으로 이동해야 함(실측 확인).
        try:
            link = page.locator("a[href*='AA040OfferMainFrm']").first
            if link.count():
                try:
                    link.click(timeout=6000)
                except Exception:
                    # 클릭이 안 되면 절대경로로 이동(origin 기준 해석)
                    href = link.get_attribute("href") or ""
                    if href.startswith("/"):
                        href = "https://www.gov.kr" + href
                    if href.startswith("http"):
                        page.goto(href, wait_until="domcontentloaded")
                page.wait_for_load_state("domcontentloaded")
                page.wait_for_timeout(2500)
        except Exception:
            pass
        # 초본이면 '초본' 유형 선택(등본은 기본값)
        if doc_name == "주민등록초본":
            try:
                lab = page.get_by_text("초본", exact=True)
                if lab.count():
                    lab.first.click(timeout=2500)
            except Exception:
                pass
        # 신청하기(Playwright 신뢰 클릭)
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
        log("신청 제출 중… 전자서명 창이 뜨면 본인 확인해 주세요." if clicked
            else "화면의 '신청하기'를 눌러 주세요.")
        # 문서출력 → PDF. 출력은 새 탭(popup)으로 열릴 수 있어 popup을 우선 저장.
        ymd = time.strftime("%Y%m%d")
        fname = f"모두봄_{doc_name}_{ymd}.pdf"
        saved = False
        for _ in range(120):  # 전자서명·처리에 시간이 걸릴 수 있어 최대 ~2분 대기
            try:
                body = page.inner_text("body") or ""
                if "문서출력" in body:
                    ctx = page.context
                    try:
                        with ctx.expect_page(timeout=6000) as pop:  # 새 탭으로 열리면 그 탭 저장
                            page.get_by_text("문서출력", exact=False).first.click(timeout=3000)
                        newp = pop.value
                        newp.wait_for_load_state("domcontentloaded")
                        newp.wait_for_timeout(1500)
                        saved = save_pdf(newp, fname)
                    except Exception:
                        # 새 탭이 아니면 현재 페이지 저장
                        page.wait_for_timeout(1500)
                        saved = save_pdf(page, fname)
                    if saved:
                        break
            except Exception:
                pass
            page.wait_for_timeout(1000)
        if saved:
            log(f"🎉 발급 완료! PDF 저장: {SAVE_DIR / fname}")
        else:
            log("발급이 진행 중이거나 [문서출력]을 기다리고 있어요. 완료되면 화면의 [문서출력]으로 저장하세요.")

if __name__ == "__main__":
    doc = sys.argv[1] if len(sys.argv) > 1 else "주민등록등본"
    run(doc)
