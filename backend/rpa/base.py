"""RPA 공통 기반 — 브라우저 세션, 스크린샷, 카카오 로그인 감지"""
import asyncio
import base64
import os
import pathlib
import sys
from datetime import datetime
from typing import Optional, Callable


def get_launch_options(slow_mo: int = 300) -> dict:
    """모든 RPA가 공통으로 쓰는 브라우저 실행 옵션.

    윈도우에서는 Playwright 번들 Chromium이 일부 잠긴(관리형) PC에서 SxS(부속 구성)
    오류로 실행되지 않을 수 있어, 기본값으로 시스템에 설치된 Microsoft Edge(msedge)를
    사용한다. Edge도 Chromium 계열이라 선택자·동작이 동일하다.
    macOS/Linux는 기존처럼 번들 Chromium을 쓴다(맥 동작 불변).

    환경변수로 재정의 가능:
      - RPA_BROWSER_CHANNEL : 'msedge' | 'chrome' | '' (빈 값이면 번들 Chromium 강제)
      - RPA_HEADLESS=1      : 창 없이 실행. 기본은 headed(본인인증 위해 창 표시).
    """
    opts = {
        "headless": os.getenv("RPA_HEADLESS", "0") == "1",
        "slow_mo": slow_mo,
        "args": [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    }
    channel = os.getenv("RPA_BROWSER_CHANNEL")
    if channel is None:
        channel = "msedge" if sys.platform == "win32" else ""
    channel = channel.strip()
    if channel:
        opts["channel"] = channel
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


async def launch_browser(pw, slow_mo: int = 300):
    """가용 브라우저를 우선순위로 시도해 첫 성공을 반환(설치 안 된 채널은 건너뜀).

    Chrome→Edge→번들 Chromium 순 폴백이라, 특정 브라우저 미설치 PC에서도 자동발급이 끊기지 않는다.
    전부 실패하면 사용자가 조치할 수 있는 명확한 메시지와 함께 예외를 던진다.
    """
    base = get_launch_options(slow_mo)
    base.pop("channel", None)
    tried, last_err = [], None
    for ch in _browser_candidates():
        opts = dict(base)
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


def recent_issued_docs(limit: int = 10):
    """모두봄이 발급해 저장한 서류(PDF/PNG)를 최신순으로 반환 — [(표시이름, 절대경로), ...].

    신청 양식의 '서류 첨부'를 사용자가 정확히 하도록 안내하는 데 쓴다(어떤 서류가 어디에 있는지).
    파일명은 '{서류명}_{타임스탬프}.pdf' 형식 → 타임스탬프를 떼어 사람이 읽는 이름으로."""
    import glob
    import re as _re
    out = []
    try:
        files = []
        for ext in ("*.pdf", "*.png"):
            files.extend(glob.glob(os.path.join(str(DOCS_DIR), ext)))
        files.sort(key=os.path.getmtime, reverse=True)
        for f in files[:limit]:
            stem = os.path.splitext(os.path.basename(f))[0]
            name = _re.sub(r"_\d{8}_\d{6}$", "", stem)  # _YYYYMMDD_HHMMSS 제거
            out.append((name or stem, os.path.abspath(f)))
    except Exception:
        pass
    return out


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


async def click_kakaotalk_in_anyid(page) -> bool:
    """
    anyid 모달에서 카카오톡을 정확히 클릭.
    카카오뱅크/카카오스토리와 혼동하지 않도록 '톡'/'kakaotalk' 텍스트만 매칭.
    """
    # 1단계: Playwright 선택자
    for sel in KAKAOTALK_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1.5)
                return True
        except Exception:
            continue

    # 2단계: JS — '카카오톡'/'kakaotalk' 포함, '뱅크'/'bank' 제외
    try:
        result = await page.evaluate("""
            () => {
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
                    return (text.includes('카카오톡') || text.includes('kakaotalk')) &&
                           !text.includes('뱅크') && !text.includes('bank');
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
        """)
        if result:
            await asyncio.sleep(1.5)
            return True
    except Exception:
        pass

    # 3단계: JS — anyid 리스트에서 마지막 카카오 항목 (카카오톡이 보통 하단)
    try:
        result = await page.evaluate("""
            () => {
                const all = [...document.querySelectorAll('a, button, li')];
                const kakaoItems = all.filter(el => {
                    const t = (el.textContent + el.className).toLowerCase();
                    return t.includes('카카오') || t.includes('kakao');
                });
                if (kakaoItems.length > 0) {
                    kakaoItems[kakaoItems.length - 1].click();
                    return kakaoItems.length;
                }
                return 0;
            }
        """)
        if result:
            await asyncio.sleep(1.5)
            return True
    except Exception:
        pass

    return False


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
