"""RPA 공통 기반 — 브라우저 세션, 스크린샷, 카카오 로그인 감지"""
import asyncio
import base64
import os
import pathlib
import sys
from datetime import datetime
from typing import Optional, Callable


# ── 상태변경 엔드포인트 CSRF 방어(감사 5차 확정) ──────────────────────────────
#   session_reset 등 '파일 삭제' 엔드포인트가 인가 없이 열려, 크로스오리진 CSRF(브라우저)나
#   공개 터널 직접호출(비브라우저)로 피해자 PC의 발급 서류가 삭제될 수 있었다.
#   브라우저는 크로스오리진 POST에 Origin을 반드시·위조불가로 붙이므로, Origin 화이트리스트로 차단한다.
_CANONICAL_ALLOWED_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://biocode67.github.io",
]


def allowed_origins() -> list:
    """정상 프론트 오리진 + CORS_ORIGINS env(공개 터널·자체 도메인 등)."""
    return _CANONICAL_ALLOWED_ORIGINS + [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]


def csrf_origin_ok(origin) -> bool:
    """상태변경(파일삭제 등) 엔드포인트 CSRF 방어. Origin이 허용목록에 있어야 True.
    Origin이 없거나(비브라우저 스크립트·터널 직접호출) 허용목록 밖 크로스오리진이면 False.
    정상 프론트(github.io/localhost)만 통과."""
    return bool(origin) and origin in allowed_origins()


def get_launch_options(slow_mo: int = None) -> dict:
    """모든 RPA가 공통으로 쓰는 브라우저 실행 옵션.

    윈도우에서는 Playwright 번들 Chromium이 일부 잠긴(관리형) PC에서 SxS(부속 구성)
    오류로 실행되지 않을 수 있어, 기본값으로 시스템에 설치된 Microsoft Edge(msedge)를
    사용한다. Edge도 Chromium 계열이라 선택자·동작이 동일하다.
    macOS/Linux는 기존처럼 번들 Chromium을 쓴다(맥 동작 불변).

    환경변수로 재정의 가능:
      - RPA_BROWSER_CHANNEL : 'msedge' | 'chrome' | '' (빈 값이면 번들 Chromium 강제)
      - RPA_HEADLESS=1      : 창 없이 실행. 기본은 headed(본인인증 위해 창 표시).
    """
    # slow_mo: 모든 액션에 걸리는 지연(ms) — 과거 300ms는 클릭·입력마다 0.3초씩 쌓여 '버벅임'의 주범.
    # nhis가 100ms로 장기 검증돼 있어 기본 120ms로 통일(RPA_SLOW_MO 로 현장에서 즉시 조절 가능).
    if slow_mo is None:
        slow_mo = max(0, int(os.getenv("RPA_SLOW_MO", "120")))
    opts = {
        "headless": os.getenv("RPA_HEADLESS", "0") == "1",
        "slow_mo": slow_mo,
        "args": [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",
        ],
    }
    channel = os.getenv("RPA_BROWSER_CHANNEL")
    if channel is None:
        channel = "msedge" if sys.platform == "win32" else ""
    channel = channel.strip()
    if channel:
        opts["channel"] = channel
    else:
        # --no-sandbox 는 '번들 Chromium'에만 — 컨테이너/잠긴 PC에서 샌드박스 초기화가 실패해
        # 실행 자체가 안 되는 경우의 회피책이다. 정부 사이트 로그인을 하는 사용자의 실제
        # Chrome/Edge(channel 지정)에서는 보안 계층(샌드박스)을 끄지 않는다. (감사 지적 반영)
        opts["args"].append("--no-sandbox")
    return opts


def _browser_candidates() -> list[str]:
    """실행을 시도할 브라우저 채널 우선순위. 설치 안 된 채널은 launch 실패로 다음으로 폴백.

    핵심: **Microsoft Edge 는 Windows 10/11 에 항상 선탑재**(Chromium 계열)라, 사용자가 Chrome 을
    안 깔았어도 msedge 로 폴백되어 거의 모든 윈도우 PC에서 자동발급이 동작한다(별도 번들 불필요).
    마지막 폴백은 ''(Playwright 번들 Chromium) — `playwright install chromium` 돼 있으면 사용.
    """
    forced = os.getenv("RPA_BROWSER_CHANNEL")
    order: list[str] = []
    if forced is not None:
        order.append(forced.strip())  # 명시값(빈 문자열='번들 chromium')을 최우선
    if sys.platform == "win32":
        defaults = ["chrome", "msedge", ""]  # 실사용자 크롬 선호 → 없으면 항상 있는 Edge → 번들
    else:
        defaults = ["", "chrome"]  # 맥/리눅스는 기존처럼 번들 Chromium 우선(동작 불변) → 없으면 chrome
    for c in defaults:
        if c not in order:
            order.append(c)
    # 중복 제거(순서 유지)
    seen, uniq = set(), []
    for c in order:
        if c not in seen:
            seen.add(c); uniq.append(c)
    return uniq


async def launch_browser(pw, slow_mo: int = None):
    """가용 브라우저를 우선순위로 시도해 첫 성공을 반환(설치 안 된 채널은 건너뜀).

    Chrome→Edge→번들 Chromium 순 폴백이라, 특정 브라우저 미설치 PC에서도 자동발급이 끊기지 않는다.
    전부 실패하면 사용자가 조치할 수 있는 명확한 메시지와 함께 예외를 던진다.
    """
    base = get_launch_options(slow_mo)
    base.pop("channel", None)
    base_args = [a for a in base.get("args", []) if a != "--no-sandbox"]
    tried, last_err = [], None
    for ch in _browser_candidates():
        opts = dict(base)
        # 후보별 args 재구성: --no-sandbox 는 번들 Chromium 후보에만(실사용 Chrome/Edge 는 샌드박스 유지)
        opts["args"] = base_args + ([] if ch else ["--no-sandbox"])
        if ch:
            opts["channel"] = ch
        try:
            browser = await pw.chromium.launch(**opts)
            if ch:
                os.environ["RPA_ACTIVE_BROWSER"] = ch  # 상태/로그용
            return browser
        except Exception as e:  # 미설치·SxS 오류 등 → 다음 후보로
            last_err = e
            tried.append(ch or "chromium(번들)")
    raise RuntimeError(
        "브라우저를 실행할 수 없습니다. Chrome 또는 Edge를 설치하거나, 터미널에서 "
        "`playwright install chromium` 을 실행해 주세요. "
        f"(시도: {', '.join(tried)} · 원인: {last_err})"
    )


def _default_docs_dir() -> pathlib.Path:
    """발급 서류(주민번호 포함 PII) 저장 폴더 — '사용자에게 실제로 보이는' 바탕화면을 찾는다.

    ⚠️ 한국 Win11 + OneDrive Known-Folder 리다이렉션이면 진짜 바탕화면은 ~/OneDrive/바탕 화면 인데,
    ~/Desktop 은 존재하지 않거나 빈 폴더라, 거기에 저장하면 '저장 완료'라고 해도 사용자 눈엔 안 보이고
    PII 문서가 엉뚱한 경로에 남는다. → 레지스트리 Shell Folders\\Desktop(리다이렉션 반영)을 우선 사용,
    실패 시 OneDrive/일반 바탕화면/문서 순으로 폴백."""
    env = os.getenv("MODOOBOM_DOCS_DIR")
    if env:
        return pathlib.Path(env)
    home = pathlib.Path.home()
    if sys.platform == "win32":
        try:
            import winreg
            key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                desktop = os.path.expandvars(winreg.QueryValueEx(k, "Desktop")[0])
                if os.path.isdir(desktop):
                    return pathlib.Path(desktop) / "모두봄서류"
        except Exception:
            pass
        for cand in (home / "OneDrive" / "바탕 화면", home / "OneDrive" / "Desktop",
                     home / "Desktop", home / "Documents"):
            if cand.is_dir():
                return cand / "모두봄서류"
        return home / "Documents" / "모두봄서류"
    return home / "Desktop" / "모두봄서류"


# 발급 서류 저장 폴더. 환경변수 MODOOBOM_DOCS_DIR 로 변경.
DOCS_DIR = _default_docs_dir()


def recent_issued_docs(limit: int = 10, within_seconds: Optional[int] = None):
    """모두봄이 발급해 저장한 서류(PDF/PNG)를 최신순으로 반환 — [(표시이름, 절대경로), ...].

    신청 양식의 '서류 첨부'를 사용자가 정확히 하도록 안내하는 데 쓴다(어떤 서류가 어디에 있는지).
    파일명은 '{서류명}_{타임스탬프}.pdf' 형식 → 타임스탬프를 떼어 사람이 읽는 이름으로.

    within_seconds: 지정 시 '최근 N초 내 발급'만 반환 — 공용 PC에서 '직전 사용자'의 오래된 서류를
    다음 사용자의 신청서에 자동 첨부하는 것을 막는 방어선(자동첨부 경로에서 사용)."""
    import glob
    import re as _re
    import time as _time
    out = []
    try:
        files = []
        for ext in ("*.pdf", "*.png"):
            files.extend(glob.glob(os.path.join(str(DOCS_DIR), ext)))
        files.sort(key=os.path.getmtime, reverse=True)
        cutoff = (_time.time() - within_seconds) if within_seconds else None
        for f in files[:limit]:
            if cutoff is not None and os.path.getmtime(f) < cutoff:
                continue
            stem = os.path.splitext(os.path.basename(f))[0]
            name = _re.sub(r"_\d{8}_\d{6}$", "", stem)  # _YYYYMMDD_HHMMSS 제거
            out.append((name or stem, os.path.abspath(f)))
    except Exception:
        pass
    return out


def clear_docs_dir() -> int:
    """발급 서류 폴더(DOCS_DIR)의 PDF/PNG 를 모두 삭제 — 공용 PC '다음 분 상담' 전환 시 이전 사용자 PII 제거.
    반환: 삭제한 파일 수. (폴더 자체는 유지)"""
    import glob
    n = 0
    try:
        for ext in ("*.pdf", "*.png"):
            for f in glob.glob(os.path.join(str(DOCS_DIR), ext)):
                try:
                    os.remove(f)
                    n += 1
                except OSError:
                    pass
    except Exception:
        pass
    return n


def _safe_filename(name: str) -> str:
    cleaned = "".join(c for c in name if c not in '<>:"/\\|?*\n\r\t').strip()
    return cleaned or "document"


async def save_document(page, name: str) -> Optional[str]:
    """발급된 서류 페이지를 파일로 '반드시' 저장한다.
    1순위 PDF(CDP Page.printToPDF — headed에서도 시도), 실패 시 전체 스크린샷(PNG) 폴백.
    저장 경로를 반환하고, 완전 실패 시 None.
    """
    try:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = DOCS_DIR / f"{_safe_filename(name)}_{stamp}"
    # 1) PDF (Chrome DevTools Protocol)
    try:
        client = await page.context.new_cdp_session(page)
        res = await client.send("Page.printToPDF", {"printBackground": True})
        data = res.get("data")
        if data:
            out = base.with_suffix(".pdf")
            out.write_bytes(base64.b64decode(data))
            return str(out)
    except Exception:
        pass
    # 2) 스크린샷 폴백 — 어떤 경우에도 증빙은 남긴다
    try:
        out = base.with_suffix(".png")
        await page.screenshot(path=str(out), full_page=True)
        return str(out)
    except Exception:
        return None

# 카카오 간편인증 버튼 선택자 (각 사이트에서 공통적으로 사용)
KAKAO_SELECTORS = [
    "a:has-text('카카오')",
    "button:has-text('카카오')",
    "img[alt*='카카오']",
    ".kakao-login",
    "[class*='kakao']",
    "a[href*='kakao']",
]

# ★ 카카오톡(TALK) 전용 선택자 — 카카오뱅크/카카오스토리와 구분
# plus.gov.kr 간편인증(oacx 위젯)은 카카오톡을 라디오형 label/li + img[alt='카카오톡'] 로 노출.
KAKAOTALK_SELECTORS = [
    "a[title='카카오톡']",
    "img[alt='카카오톡']",
    "label:has-text('카카오톡')",
    "li:has-text('카카오톡')",
    "a:has-text('카카오톡')",
    "li:has-text('카카오톡') a",
    "button:has-text('카카오톡')",
    ".kakao-talk",
    "[class*='kakaotalk']",
    "[data-id='kakaotalk']",
    "[data-provider='kakaotalk']",
]

# 본인인증 정보 입력 폼 감지 선택자 (anyid 인증 요청 폼)
AUTH_FORM_SELECTORS = [
    "button:has-text('인증 요청')",
    "button:has-text('인증요청')",
    "input[placeholder*='생년월일']",
    "input[placeholder*='이름']",
    "button:has-text('전체동의')",
    "label:has-text('전체동의')",
    "input[type='checkbox']",
]

AUTH_FORM_USER_GUIDE = (
    "📋 카카오톡 본인인증 정보 입력 폼이 열렸습니다.\n\n"
    "1️⃣  이름 입력\n"
    "2️⃣  생년월일 입력 (예: 19900101)\n"
    "3️⃣  휴대폰 번호 입력\n"
    "4️⃣  '전체동의' 체크박스 선택\n"
    "5️⃣  '인증 요청' 버튼 클릭\n\n"
    "📱 이후 카카오톡 알림에서 [본인인증 허용] 을 누르면 자동으로 진행됩니다."
)

# 로그인 완료 감지 선택자
LOGIN_SUCCESS_SELECTORS = [
    "a[href*='logout']",
    "button:has-text('로그아웃')",
    ".logout",
    ".user-name",
    ".member-name",
    "#headerUserName",
    ".mypage-link",
    "a:has-text('로그아웃')",
    "[title*='로그아웃']",
]

# 공통 로그인 완료 URL 패턴
LOGIN_DONE_URL_KEYWORDS = ["main", "mypage", "portal/service", "index", "dashboard"]
# 로그인/인증 진행 중으로 봐야 하는 URL(간편인증 위젯·안티봇 인터스티셜 포함).
# plus.gov.kr은 mbuster 안티봇, 간편인증은 simpleCert/fincert/cert 로 잠깐 URL이 바뀌므로
# 이들을 '아직 로그인 중'으로 간주해 wait_for_login 오탐(성급한 성공)을 막는다.
LOGIN_PAGE_URL_KEYWORDS = [
    "login", "member/join", "auth", "personalLoginPage", "openLginPage",
    "mbuster", "cert", "nlogin",
]


# ── 간편인증 제공자 정의 — 어르신 다수가 카카오 미사용(통신사 PASS 등)이라 수단 선택 필수(복지관 현장) ──
# labels: has-text/alt 정확 매칭용 표시 라벨 · tokens: JS 텍스트 포함 매칭 · loose: 최후 폴백 · exclude: 오클릭 방지
AUTH_PROVIDERS = {
    "kakao": {"labels": ["카카오톡"], "tokens": ["카카오톡", "kakaotalk"], "loose": ["카카오", "kakao"],
              "exclude": ["뱅크", "bank"], "display": "카카오톡"},
    "pass":  {"labels": ["통신사PASS", "통신사 PASS", "PASS"], "tokens": ["통신사pass", "통신사 pass", "pass(통신사)"],
              "loose": ["pass", "통신사"], "exclude": ["카카오", "kakao", "password", "페이코", "payco"], "display": "통신사 PASS"},
    "naver": {"labels": ["네이버"], "tokens": ["네이버", "naver"], "loose": ["네이버"],
              "exclude": ["뱅크", "bank", "페이", "웨일"], "display": "네이버"},
    "toss":  {"labels": ["토스"], "tokens": ["토스", "toss"], "loose": ["토스"],
              "exclude": ["뱅크", "bank"], "display": "토스"},
}


def provider_display(provider: str) -> str:
    """안내 문구용 제공자 표시명 — 미지정/오타는 카카오톡."""
    return AUTH_PROVIDERS.get(str(provider or "").lower(), AUTH_PROVIDERS["kakao"])["display"]


async def click_provider_in_anyid(page, provider: str = "kakao", attempts: int = 4) -> bool:
    """간편인증 위젯에서 선택 제공자를 클릭 — 위젯 내부가 늦게 렌더돼도 되도록 재시도(감사 확정).

    위젯 iframe 이 'URL 등장 즉시' 반환된 뒤 내부 버튼이 아직 안 그려졌을 때 1회 클릭은 불발한다.
    → 짧은 간격으로 여러 번 시도해 버튼이 나타나는 순간 클릭한다. (기본 4회 × ~1.2초)"""
    if str(provider or "").lower() not in AUTH_PROVIDERS:
        provider = "kakao"  # 비표준/오타 값은 카카오로(프론트는 유효값만 보내나 방어)
    for i in range(max(1, attempts)):
        if await _click_provider_once(page, provider):
            return True
        await asyncio.sleep(1.0)  # 위젯 내부 렌더 대기 후 재시도
    return False


async def _click_provider_once(page, provider: str = "kakao") -> bool:
    """제공자 클릭 1회 시도 — 정확 셀렉터 → JS 토큰 매칭 → 느슨한 폴백(뱅크/페이 오클릭은 exclude로 차단)."""
    p = AUTH_PROVIDERS.get(str(provider or "").lower(), AUTH_PROVIDERS["kakao"])

    # 1단계: Playwright 선택자 — 카카오는 검증된 테이블, 그 외는 라벨 기반 생성
    if p is AUTH_PROVIDERS["kakao"]:
        selectors = KAKAOTALK_SELECTORS
    else:
        selectors = []
        for lab in p["labels"]:
            selectors += [
                f"a[title*='{lab}']", f"img[alt*='{lab}']",
                f"label:has-text('{lab}')", f"li:has-text('{lab}')",
                f"a:has-text('{lab}')", f"button:has-text('{lab}')",
            ]
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1.2)
                return True
        except Exception:
            continue

    # 2단계: JS — 토큰 포함 + exclude 제외 (텍스트·alt·title·data-*·클래스 종합)
    try:
        result = await page.evaluate("""
            (cfg) => {
                const all = [...document.querySelectorAll('a, button, li, span, img, div')];
                const candidates = all.filter(el => {
                    const text = (
                        (el.textContent || '') +
                        (el.getAttribute('alt') || '') +
                        (el.getAttribute('title') || '') +
                        (el.getAttribute('data-id') || '') +
                        (el.getAttribute('data-provider') || '') +
                        el.className
                    ).toLowerCase();
                    return cfg.tokens.some(t => text.includes(t)) &&
                           !cfg.exclude.some(x => text.includes(x));
                });
                if (candidates.length > 0) {
                    const el = candidates[0];
                    const clickTarget = el.tagName === 'IMG'
                        ? (el.closest('a') || el.closest('label') || el.closest('li') || el.closest('button') || el)
                        : el;
                    clickTarget.click();
                    return true;
                }
                return false;
            }
        """, {"tokens": [t.lower() for t in p["tokens"]], "exclude": [x.lower() for x in p["exclude"]]})
        if result:
            await asyncio.sleep(1.2)
            return True
    except Exception:
        pass

    # 3단계: JS — 느슨한 매칭의 마지막 항목(위젯 목록에서 본계열이 보통 하단)
    try:
        result = await page.evaluate("""
            (cfg) => {
                const all = [...document.querySelectorAll('a, button, li')];
                const items = all.filter(el => {
                    const t = (el.textContent + el.className).toLowerCase();
                    return cfg.loose.some(k => t.includes(k)) && !cfg.exclude.some(x => t.includes(x));
                });
                if (items.length > 0) {
                    items[items.length - 1].click();
                    return items.length;
                }
                return 0;
            }
        """, {"loose": [k.lower() for k in p["loose"]], "exclude": [x.lower() for x in p["exclude"]]})
        if result:
            await asyncio.sleep(1.2)
            return True
    except Exception:
        pass

    return False


async def click_kakaotalk_in_anyid(page) -> bool:
    """(호환 래퍼) anyid 모달에서 카카오톡 클릭 — click_provider_in_anyid('kakao')."""
    return await click_provider_in_anyid(page, "kakao")


async def detect_auth_form(page) -> bool:
    """본인인증 정보 입력 폼이 열렸는지 감지"""
    for sel in AUTH_FORM_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                return True
        except Exception:
            continue
    return False


async def take_screenshot(page) -> str:
    try:
        buf = await page.screenshot(full_page=False, type="jpeg", quality=75)
        return base64.b64encode(buf).decode()
    except Exception:
        return ""


async def try_click_kakao(page) -> bool:
    """카카오 로그인 버튼 자동 클릭 시도. 성공 여부 반환."""
    for sel in KAKAO_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click()
                await asyncio.sleep(1.5)
                return True
        except Exception:
            continue
    return False


async def wait_for_login(
    page,
    task,
    timeout_sec: int = 180,
    login_url: Optional[str] = None,
    min_wait_sec: int = 8,
) -> bool:
    """
    로그인 완료까지 대기 (최대 timeout_sec 초).
    로그아웃 버튼 등장 또는 URL 변화로 감지.

    min_wait_sec: 이 시간 전에는 성공으로 판정하지 않는다. 카카오 간편인증은 제공자 선택→
    정보입력→휴대폰 승인까지 물리적으로 수 초 내 완료가 불가능하므로, 초반의 안티봇/위젯
    리다이렉트를 '로그인 완료'로 오탐하는 것을 원천 차단한다.
    """
    report_interval = 15  # 15초마다 진행상황 스크린샷
    last_report = 0

    for elapsed in range(timeout_sec):
        # 최소 대기 구간: 성급한 성공 판정 금지(안티봇/위젯 리다이렉트 오탐 방지)
        if elapsed < min_wait_sec:
            await asyncio.sleep(1)
            continue
        try:
            current_url = page.url

            # URL 기반 감지 — login 키워드가 URL에서 사라지면 완료
            is_login_page = any(k in current_url for k in LOGIN_PAGE_URL_KEYWORDS)
            is_done_page = any(k in current_url for k in LOGIN_DONE_URL_KEYWORDS)
            if is_done_page and not is_login_page:
                return True

            # 특정 로그인 URL 이탈 감지 (hash SPA 포함)
            if login_url:
                # plus.gov.kr SPA: login_url이 hash에 있으므로 현재 URL과 직접 비교
                if login_url not in current_url and not is_login_page:
                    return True

            # 로그아웃 버튼 감지 — '보이는' 요소만(숨겨진 로그아웃 링크 오탐 방지)
            for sel in LOGIN_SUCCESS_SELECTORS:
                try:
                    if await page.locator(sel).first.is_visible():
                        return True
                except Exception:
                    pass

            # 일정 간격으로 대기 중 스크린샷 업데이트
            if elapsed - last_report >= report_interval and elapsed > 0:
                try:
                    ss = await take_screenshot(page)
                    remaining = timeout_sec - elapsed
                    task.update(
                        "waiting_login",
                        f"📱 카카오 인증을 기다리는 중... (남은 시간: {remaining}초)\n"
                        "스마트폰 카카오톡 알림을 확인해주세요.",
                        ss,
                    )
                    last_report = elapsed
                except Exception:
                    pass

        except Exception:
            pass
        await asyncio.sleep(1)
    return False


async def click_by_text(page, texts: list, roles=("link", "button", "tab", "menuitem", "listitem")) -> bool:
    """
    역할(role)·텍스트 기반으로 요소를 찾아 클릭. CSS 클래스 변경에 강함.
    정부 사이트가 마크업을 바꿔도 '간편인증' 같은 표시 텍스트로 탐색.
    """
    for t in texts:
        for role in roles:
            try:
                el = page.get_by_role(role, name=t)
                if await el.count() > 0:
                    await el.first.scroll_into_view_if_needed()
                    await el.first.click()
                    await asyncio.sleep(1)
                    return True
            except Exception:
                continue
        try:
            el = page.get_by_text(t, exact=False)
            if await el.count() > 0:
                await el.first.click()
                await asyncio.sleep(1)
                return True
        except Exception:
            continue
    return False


async def click_eform_button(page_or_frame, text: str) -> bool:
    """Clipsoft eForm(WebSquare 유사) 컴포넌트 클릭.

    복지로 등은 로그인·간편인증 버튼을 표준 a/button이 아니라 .cl-button / [role=button] /
    .cl-text-wrapper / .cl-output div 로 렌더한다. 게다가 eForm은 합성 JS click 에 반응하지
    않으므로(신뢰된 이벤트 필요), 요소의 화면 좌표를 구해 실제 마우스 클릭을 날린다.
    (메인 프레임에서만 좌표 클릭; iframe 내부는 JS click 폴백.) 성공 여부 반환."""
    # 1) 텍스트로 대상 요소를 찾아 중심 좌표(뷰포트 기준) 계산 + 스크롤
    try:
        box = await page_or_frame.evaluate(
            """(t) => {
                const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 3 && r.height > 3; };
                const actionable = (e) =>
                    e.closest('.cl-button, [role="button"], a, button, .cl-control') || e;
                // 텍스트를 포함하는 '가시' 요소 중 가장 안쪽(작은) 것 → 그 액션 조상(카드/버튼) 클릭
                const cands = Array.from(document.querySelectorAll('*'))
                    .filter(e => (e.innerText || '').includes(t) && vis(e));
                if (!cands.length) return null;
                cands.sort((a, b) => {
                    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                    return (ra.width * ra.height) - (rb.width * rb.height);
                });
                const target = actionable(cands[0]);
                target.scrollIntoView({block: 'center'});
                const r = target.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                return {x: r.left + r.width / 2, y: r.top + r.height / 2};
            }""",
            text,
        )
    except Exception:
        box = None
    if not box:
        return False
    # 2) Page면 신뢰된 마우스 클릭(eForm 정답). Frame이면 좌표 오프셋이 달라 JS click 폴백.
    mouse = getattr(page_or_frame, "mouse", None)
    if mouse is not None:
        try:
            await mouse.click(box["x"], box["y"])
            return True
        except Exception:
            pass
    try:
        return await page_or_frame.evaluate(
            """(t) => {
                const actionable = (e) =>
                    e.closest('.cl-button, [role="button"], a, button, .cl-control') || e;
                const nodes = Array.from(document.querySelectorAll(
                    '.cl-button, [role="button"], .cl-text-wrapper, .cl-output, a, button, li'));
                let el = nodes.find(e => (e.innerText || '').trim() === t);
                if (!el) el = Array.from(document.querySelectorAll('*')).find(e => {
                    const x = (e.innerText || '').trim();
                    return x.includes(t) && x.length < t.length + 45 && e.children.length <= 4;
                });
                if (el) { actionable(el).click(); return true; }
                return false;
            }""",
            text,
        )
    except Exception:
        return False


async def get_frame_by_url(page, keyword: str, timeout_sec: int = 12):
    """URL에 keyword가 포함된 iframe 프레임을 반환(로드 대기 포함). 없으면 None.
    간편인증 위젯이 외부 iframe(정부24 simpleCert, 복지로 fincert 등)으로 로드될 때 사용."""
    for _ in range(timeout_sec * 2):
        for fr in page.frames:
            if keyword in (fr.url or ""):
                return fr
        await asyncio.sleep(0.5)
    return None


async def click_first_matching(page, selectors: list) -> bool:
    """선택자 목록 중 첫 번째로 찾은 요소 클릭. 성공 여부 반환."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1)
                return True
        except Exception:
            continue
    return False


def make_browser_context_args() -> dict:
    return {
        "viewport": {"width": 1280, "height": 900},
        "locale": "ko-KR",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
    }
