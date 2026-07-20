"""RPA 공통 기반 — 브라우저 세션, 스크린샷, 카카오 로그인 감지"""
import asyncio
import base64
import os
import pathlib
import sys
from datetime import datetime
from typing import Optional, Callable


def get_launch_options(slow_mo: int = None, headless: bool | None = None) -> dict:
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
        # headless 명시 인자가 env보다 우선 — 셀프테스트/프리플라이트가 전역 env를 잠깐 바꾸는 방식은
        # 그 사이 시작된 '실제 발급'까지 헤드리스로 띄워 카카오 인증을 불가능하게 하는 레이스가 있었다.
        "headless": (headless if headless is not None else os.getenv("RPA_HEADLESS", "0") == "1"),
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


async def launch_browser(pw, slow_mo: int = None, headless: bool | None = None):
    """가용 브라우저를 우선순위로 시도해 첫 성공을 반환(설치 안 된 채널은 건너뜀).

    Chrome→Edge→번들 Chromium 순 폴백이라, 특정 브라우저 미설치 PC에서도 자동발급이 끊기지 않는다.
    전부 실패하면 사용자가 조치할 수 있는 명확한 메시지와 함께 예외를 던진다.
    """
    base = get_launch_options(slow_mo, headless=headless)
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
    """모두봄이 발급(PDF/PNG)했거나 '내 서류함'에 등록(사진 JPG 포함)한 서류를 최신순 반환 — [(표시이름, 절대경로), ...].

    신청 양식의 '서류 첨부'를 사용자가 정확히 하도록 안내하는 데 쓴다(어떤 서류가 어디에 있는지).
    파일명은 '{서류명}_{이름}_{YYYY-MM-DD_HHMM}.pdf'(신형)/'{서류명}_{타임스탬프}'(구형) → 접미를 떼어 표시명으로.

    within_seconds: 지정 시 '최근 N초 내 발급'만 반환 — 공용 PC에서 '직전 사용자'의 오래된 서류를
    다음 사용자의 신청서에 자동 첨부하는 것을 막는 방어선(자동첨부 경로에서 사용)."""
    import glob
    import re as _re
    import time as _time
    out = []
    try:
        files = []
        # PDF/PNG=발급물, JPG/JPEG='내 서류함'에 등록한 사진(신분증 등) — 자동첨부가 함께 찾도록 포함
        for ext in ("*.pdf", "*.png", "*.jpg", "*.jpeg"):
            files.extend(glob.glob(os.path.join(str(DOCS_DIR), ext)))
        files.sort(key=os.path.getmtime, reverse=True)
        cutoff = (_time.time() - within_seconds) if within_seconds else None
        for f in files[:limit]:
            if cutoff is not None and os.path.getmtime(f) < cutoff:
                continue
            stem = os.path.splitext(os.path.basename(f))[0]
            # 타임스탬프 접미 제거 — 신형 '_YYYY-MM-DD_HHMM(_SS)' + 구형 '_YYYYMMDD_HHMMSS' 모두
            name = _re.sub(r"(_\d{4}-\d{2}-\d{2}_\d{4}(_\d{2})?|_\d{8}_\d{6})$", "", stem)
            out.append((name or stem, os.path.abspath(f)))
    except Exception:
        pass
    return out


def clear_docs_dir() -> int:
    """발급 서류 폴더(DOCS_DIR)의 발급물(PDF/PNG)과 등록물(JPG/JPEG)을 모두 삭제 —
    공용 PC '다음 분 상담' 전환 시 이전 사용자 PII 제거. 반환: 삭제한 파일 수. (폴더 자체는 유지)

    ⚠️ JPG/JPEG 는 '내 서류함'에 등록한 신분증·계약서 '사진'이라 PII 밀도가 가장 높다 —
    과거 PDF/PNG 만 지워 이전 분 사진이 남았고, 등록 20분 안이면 다음 사용자의 자동첨부
    후보(recent_issued_docs)에까지 올랐다. 서류함이 다루는 확장자(_REGISTER_EXT)와 반드시 일치시킬 것."""
    import glob
    n = 0
    try:
        for ext in ("*.pdf", "*.png", "*.jpg", "*.jpeg"):
            for f in glob.glob(os.path.join(str(DOCS_DIR), ext)):
                try:
                    os.remove(f)
                    n += 1
                except OSError:
                    pass
    except Exception:
        pass
    return n


# 네이티브 프린트 다이얼로그 무력화 스크립트 — 정부/건보 발급 페이지가 window.print() 를 호출하면
# 크로미움이 렌더러를 블록하는 네이티브 인쇄창을 띄워 이후 evaluate/count 가 무한 동결됐다(감사 CRITICAL).
# 컨텍스트 생성 직후 add_init_script 로 주입해 렌더러가 절대 멈추지 않게 한다(문서 저장은 save_document 의 PDF 경로 사용).
NO_PRINT_SCRIPT = "try{window.print=function(){};}catch(e){}"


class CancelledByUser(Exception):
    """사용자가 자동화를 중단(취소)했거나 브라우저 창을 닫았을 때 던진다 —
    상위 러너의 finally 에서 브라우저를 닫고 태스크를 'cancelled'로 종결시킨다(멈춤 탈출구의 근간)."""


def is_cancelled(task) -> bool:
    """태스크에 취소 요청이 걸렸는지 — 러너의 대기 루프가 매 틱 확인해 즉시 빠져나오게."""
    return bool(getattr(task, "cancel_requested", False))


async def cancellable_sleep(total_sec: float, task=None, context=None) -> None:
    """중단 가능한 대기 — done 후 브라우저 유예(60~120초) 동안 사용자가 [중단]하거나 창을 닫으면
    즉시 CancelledByUser 로 빠져나온다(과거 고정 sleep 이 중단 불가라 창 닫아도 슬롯을 계속 점유했음)."""
    slept = 0.0
    while slept < total_sec:
        if task is not None:
            check_cancel(task, context)
        await asyncio.sleep(min(1.0, total_sec - slept))
        slept += 1.0


async def context_alive(context) -> bool:
    """브라우저 컨텍스트에 '살아있는' 페이지가 하나라도 있는지 — 사용자가 창을 다 닫으면 False.
    닫힌 창을 상대로 최대 8분씩 대기하던 유령 점유(감사 확정)를 끊는다."""
    try:
        pages = getattr(context, "pages", None)
        if pages is None:
            return True  # 컨텍스트 없는 호출부는 판정 불가 → 살아있다고 간주(무해)
        return any(not p.is_closed() for p in pages)
    except Exception:
        return True


def check_cancel(task, context=None) -> None:
    """대기 루프에서 매 틱 호출 — 취소 요청 또는 모든 창 닫힘이면 CancelledByUser 를 던진다.
    context 를 넘기면 창 닫힘도 함께 감지(넘기지 않으면 취소 플래그만)."""
    if is_cancelled(task):
        raise CancelledByUser("사용자가 자동화를 중단했어요.")
    if context is not None:
        try:
            pages = getattr(context, "pages", None)
            # ⚠️ 마지막 창을 닫으면 Playwright가 pages에서 제거해 목록이 '빈 리스트'가 된다 — 과거 len>0 조건 때문에
            #   '전부 닫힘'을 감지 못하고 유예를 끝까지 대기하던 결함(감사 자기검토). 빈 목록도 닫힘으로 본다.
            #   (모든 호출부가 page 생성 이후라 '생성 전 빈 상태' 오탐 위험 없음 — apply 검토루프와 동일 패턴.)
            if pages is not None and all(p.is_closed() for p in pages):
                raise CancelledByUser("브라우저 창이 닫혀 자동화를 중단했어요.")
        except CancelledByUser:
            raise
        except Exception:
            pass


def _safe_filename(name: str) -> str:
    cleaned = "".join(c for c in name if c not in '<>:"/\\|?*\n\r\t').strip()
    return cleaned or "document"


def doc_basename(name: str, user_name: str = "") -> str:
    """사람이 읽는 저장 파일명(확장자 제외) — '주민등록등본_홍길동_2026-07-15_1430'.

    과거 '{서류명}_20260715_143022'는 어떤 파일인지 한눈에 안 읽힌다는 실사용 피드백 →
    누구의 어떤 서류를 언제 발급했는지 파일명만으로 보이게. 이름이 없으면 서류명+날짜만.
    """
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    who = _safe_filename(user_name or "").strip()
    mid = f"_{who}" if who and who != "사용자" else ""
    return f"{_safe_filename(name)}{mid}_{stamp}"


def _looks_valid_doc(path: pathlib.Path) -> bool:
    """저장 파일 무결성 게이트 — 헤더 시그니처(%PDF/PNG)+최소 크기(1KB).
    '발급 완료'라고 보고했는데 실제로는 깨진·잘린 파일이던 상황(자동첨부·제출까지 오염)을
    성공 경로에서 원천 차단한다. 내용 검증(엉뚱한 화면 인쇄)은 범위 밖 — 크기·형식만 정직 확인."""
    try:
        if not path.exists() or path.stat().st_size < 1024:
            return False
        head = path.read_bytes()[:8]
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            return head.startswith(b"%PDF")
        if suffix in (".jpg", ".jpeg"):  # 촬영·등록 경로(서류함) 파일도 같은 게이트로 판정
            return head.startswith(b"\xff\xd8\xff")
        return head.startswith(b"\x89PNG")
    except Exception:
        return False


async def _probe_content_frames(page):
    """프레임별 '실제 그려진 본문' 크기 — (메인 프레임 면적, 최대 자식 프레임, 그 면적).
    면적 = 로드 완료(complete)된 큰 이미지·캔버스의 픽셀 면적 합. 실패는 0/None(무해)."""
    js = (
        "() => [...document.querySelectorAll('img,canvas')]"
        ".filter(e => (e.tagName === 'CANVAS') ? (e.width > 150 && e.height > 150)"
        " : (e.complete && e.naturalWidth > 150 && e.naturalHeight > 150))"
        ".reduce((s, e) => s + ((e.naturalWidth || e.width || 0) * (e.naturalHeight || e.height || 0)), 0)"
    )
    main_area = 0
    try:
        r = await page.evaluate(js)
        main_area = int(r) if isinstance(r, (int, float)) else 0
    except Exception:
        pass
    best_fr, best_area = None, 0
    try:
        for fr in list(getattr(page, "frames", None) or []):
            if fr is getattr(page, "main_frame", None):
                continue
            try:
                r = await fr.evaluate(js)
                a = int(r) if isinstance(r, (int, float)) else 0
            except Exception:
                continue
            if a > best_area:
                best_fr, best_area = fr, a
    except Exception:
        pass
    return main_area, best_fr, best_area


async def save_document(page, name: str, user_name: str = "") -> Optional[str]:
    """발급된 서류 페이지를 파일로 '반드시' 저장한다.
    0순위: 본문이 '자식 프레임에만' 그려진 문서출력 창은 그 iframe 요소를 스크린샷(PNG).
      ⚠️ 실사용 확정(시연 아침, 등본 빈 PDF): printToPDF 는 교차출처 iframe 을 빈 종이로 찍는다 —
      스크린샷은 합성(컴포지터) 기반이라 교차출처여도 화면 픽셀 그대로 담긴다.
    1순위 PDF(CDP Page.printToPDF — headed에서도 시도), 실패 시 전체 스크린샷(PNG) 폴백.
    저장 후 무결성(_looks_valid_doc)까지 통과해야 성공 — 깨진 PDF는 지우고 PNG로 폴백.
    저장 경로를 반환하고, 완전 실패 시 None.
    """
    try:
        DOCS_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None
    base = DOCS_DIR / doc_basename(name, user_name)
    if base.with_suffix(".pdf").exists() or base.with_suffix(".png").exists():
        # 같은 분(分)에 재발급 — 초를 붙여 덮어쓰기 방지
        base = DOCS_DIR / f"{base.name}_{datetime.now().strftime('%S')}"
    # 0) 본문이 자식 프레임에만 있으면 iframe 요소 스크린샷이 유일하게 '내용이 담기는' 캡처다
    try:
        main_area, child_fr, child_area = await _probe_content_frames(page)
        if child_fr is not None and child_area >= 200 * 200 and main_area < 200 * 200:
            el = await child_fr.frame_element()
            out = base.with_suffix(".png")
            await el.screenshot(path=str(out))
            if _looks_valid_doc(out):
                return str(out)
            out.unlink(missing_ok=True)
    except Exception:
        pass
    # 1) PDF (Chrome DevTools Protocol) — 문서가 A4 폭보다 넓으면(가로 스크롤 해제 후 등)
    #    축소 배율로 전체 폭을 담는다(실사용: 인쇄가 보이는 폭만 찍어 우측이 잘리던 것 방지).
    try:
        client = await page.context.new_cdp_session(page)
        _pdf_params = {"printBackground": True}
        try:
            _w = await page.evaluate(
                "() => Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)"
            )
            if isinstance(_w, (int, float)) and _w > 850:  # A4 세로 ≈ 794px(96dpi)
                _pdf_params["scale"] = max(0.35, min(1.0, 794.0 / float(_w)))
        except Exception:
            pass
        res = await client.send("Page.printToPDF", _pdf_params)
        data = res.get("data")
        if data:
            out = base.with_suffix(".pdf")
            out.write_bytes(base64.b64decode(data))
            if _looks_valid_doc(out):
                return str(out)
            out.unlink(missing_ok=True)  # 깨진 PDF를 성공으로 두지 않음 → PNG 폴백으로
    except Exception:
        pass
    # 2) 스크린샷 폴백 — 어떤 경우에도 증빙은 남긴다(단, 이것도 무결성 통과해야 성공)
    try:
        out = base.with_suffix(".png")
        await page.screenshot(path=str(out), full_page=True)
        if _looks_valid_doc(out):
            return str(out)
        out.unlink(missing_ok=True)
        return None
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
    # text= 는 Playwright가 '해당 텍스트를 담는 가장 작은 요소'를 잡는다 — 신형(2026-07) 민간인증서
    # 타일 그리드(로고+라벨 div 타일, li/a/button 아님)에서 라벨 스팬을 정확히 클릭(실사용 제보).
    "text=카카오톡",
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

# 간편인증 '인증 완료' 버튼 — 폰에서 승인한 뒤 이 버튼을 눌러야 로그인이 완료된다.
#   (사용자 요청) 폰 승인만 하면 앱이 이 버튼을 자동으로 눌러준다 — 승인 전 클릭은 gov24가 '미완료'
#   안내만 띄우고 무해하므로, 간격을 두고 재시도해 승인되는 순간 완료된다. 실제 본인인증(폰)은 사용자 몫.
AUTH_CONFIRM_SELECTORS = [
    "button:has-text('인증 완료')",
    "button:has-text('인증완료')",
    "a:has-text('인증 완료')",
    "a:has-text('인증완료')",
    "input[value*='인증 완료']",
    "input[value*='인증완료']",
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
    # ⚠️ exclude 는 '느슨한 매칭(loose)'이 페이지 전체를 뒤질 때의 오클릭 차단 목록.
    #   '스토리/story'는 실사용 확정 사고(2026-07-20 새벽 데모): 간편인증 iframe 을 못 찾은 폴백에서
    #   loose '카카오'가 정부24 푸터의 '카카오스토리' SNS 링크(페이지 마지막 매칭)를 클릭해
    #   story.kakao.com 새 탭이 열림. 네이버도 푸터 '네이버블로그' 링크가 같은 계열이라 함께 차단.
    "kakao": {"labels": ["카카오톡"], "tokens": ["카카오톡", "kakaotalk"], "loose": ["카카오", "kakao"],
              "exclude": ["뱅크", "bank", "스토리", "story"], "display": "카카오톡"},
    "pass":  {"labels": ["통신사PASS", "통신사 PASS", "PASS"], "tokens": ["통신사pass", "통신사 pass", "pass(통신사)"],
              "loose": ["pass", "통신사"], "exclude": ["카카오", "kakao", "password", "페이코", "payco"], "display": "통신사 PASS"},
    "naver": {"labels": ["네이버"], "tokens": ["네이버", "naver"], "loose": ["네이버"],
              "exclude": ["뱅크", "bank", "페이", "웨일", "블로그", "blog"], "display": "네이버"},
    "toss":  {"labels": ["토스"], "tokens": ["토스", "toss"], "loose": ["토스"],
              "exclude": ["뱅크", "bank"], "display": "토스"},
}


def provider_display(provider: str) -> str:
    """안내 문구용 제공자 표시명 — 미지정/오타는 카카오톡."""
    return AUTH_PROVIDERS.get(str(provider or "").lower(), AUTH_PROVIDERS["kakao"])["display"]


async def click_provider_in_anyid(page, provider: str = "kakao", attempts: int = 4):
    """간편인증 위젯에서 선택 제공자를 클릭 — 위젯 내부가 늦게 렌더돼도 되도록 재시도(감사 확정).

    위젯 iframe 이 'URL 등장 즉시' 반환된 뒤 내부 버튼이 아직 안 그려졌을 때 1회 클릭은 불발한다.
    → 짧은 간격으로 여러 번 시도해 버튼이 나타나는 순간 클릭한다. (기본 4회 × ~1.2초)

    반환: "trusted"(Playwright 신뢰 클릭·위젯에 실제 등록됨) | "js"(JS 클릭·위젯이 무시 가능·미확정)
          | False(실패). 호출부는 truthy 로 '클릭 시도됨'을 보고, **선택이 확실해야 하는** 자동 인증요청은
          == "trusted" 로 게이트한다(미선택 상태 요청 시 '인증서비스를 선택하여 주십시오' 오류 방지)."""
    if str(provider or "").lower() not in AUTH_PROVIDERS:
        provider = "kakao"  # 비표준/오타 값은 카카오로(프론트는 유효값만 보내나 방어)
    for i in range(max(1, attempts)):
        r = await _click_provider_once(page, provider)
        if r:
            return r  # "trusted" | "js"
        await asyncio.sleep(1.0)  # 위젯 내부 렌더 대기 후 재시도
    return False


def _sibling_contexts(ctx):
    """주어진 컨텍스트(Page|Frame)를 맨 앞에, 같은 브라우저 컨텍스트의 다른 프레임·창을 뒤에 붙인 목록.

    ⚠️ 실사용 확정(2026-07-20 시연 리허설): 신형 plus.gov.kr 로그인 간편인증 창은 '민간인증서'
    제공자 그리드와 '본인인증 정보 입력' 폼이 **서로 다른 프레임**에 렌더된다 — 폼 프레임(auth_ctx)만
    뒤지면 자동입력은 되는데 카카오톡 타일 클릭만 불발. 그래서 제공자 클릭은 형제 프레임(나아가
    형제 창)까지 순서대로 탐색한다. 프레임 접근 실패·페이크 객체(테스트)는 조용히 [ctx]만 반환."""
    out = [ctx]
    seen = {id(ctx)}
    try:
        pages = []
        pg = ctx if getattr(ctx, "frames", None) is not None else getattr(ctx, "page", None)  # Page | Frame.page
        if pg is not None:
            pages.append(pg)
            bctx = getattr(pg, "context", None)  # 브라우저 컨텍스트 — 별창(팝업) 레이아웃 대응
            for p2 in (getattr(bctx, "pages", None) or []):
                if id(p2) not in {id(x) for x in pages}:
                    pages.append(p2)
        for p2 in pages:
            try:
                if getattr(p2, "is_closed", None) and p2.is_closed():
                    continue
                for fr in [p2] + list(getattr(p2, "frames", None) or []):
                    if id(fr) not in seen:
                        seen.add(id(fr))
                        out.append(fr)
            except Exception:
                continue
    except Exception:
        pass
    return out


async def _provider_click_selectors(ctx, p):
    """1단계: Playwright 신뢰 클릭 — 카카오는 검증 테이블, 그 외는 라벨 기반 생성."""
    if p is AUTH_PROVIDERS["kakao"]:
        selectors = KAKAOTALK_SELECTORS
    else:
        selectors = []
        for lab in p["labels"]:
            selectors += [
                f"a[title*='{lab}']", f"img[alt*='{lab}']", f"text={lab}",
                f"label:has-text('{lab}')", f"li:has-text('{lab}')",
                f"a:has-text('{lab}')", f"button:has-text('{lab}')",
            ]
    for sel in selectors:
        try:
            el = ctx.locator(sel).first
            if await el.count() > 0:
                await el.scroll_into_view_if_needed()
                await el.click()
                await asyncio.sleep(1.2)
                return True  # Playwright 신뢰 클릭 — 정부24 위젯이 실제 선택으로 등록
        except Exception:
            continue
    return False


async def _provider_click_tokens_js(ctx, p):
    """2단계: JS — 토큰 포함 + exclude 제외 (텍스트·alt·title·data-*·클래스 종합).
    후보는 텍스트 길이 오름차순(가장 안쪽 요소 우선 — 문서순 첫 후보는 그리드 전체를 감싼
    바깥 div일 수 있어 엉뚱한 지점 클릭) 후 가까운 클릭 가능 조상으로 승격해 누른다."""
    try:
        result = await ctx.evaluate("""
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
                    candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
                    const el = candidates[0];
                    const clickTarget = (el.closest && el.closest('a, button, li, label, [role=button], [onclick]')) || el;
                    clickTarget.click();
                    return true;
                }
                return false;
            }
        """, {"tokens": [t.lower() for t in p["tokens"]], "exclude": [x.lower() for x in p["exclude"]]})
        if result:
            await asyncio.sleep(1.2)
            return True  # JS 클릭 — 위젯이 무시할 수 있어 '미확정'(자동 인증요청 게이트에서 제외)
    except Exception:
        pass
    return False


async def _provider_click_loose_js(ctx, p):
    """3단계: JS — 느슨한 매칭의 마지막 항목(위젯 목록에서 본계열이 보통 하단)."""
    try:
        result = await ctx.evaluate("""
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
            return True  # JS 클릭 — 위젯이 무시할 수 있어 '미확정'(자동 인증요청 게이트에서 제외)
    except Exception:
        pass
    return False


async def _click_provider_once(page, provider: str = "kakao"):
    """제공자 클릭 1회 시도 — 정확 셀렉터 → JS 토큰 매칭 → 느슨한 폴백(뱅크/페이 오클릭은 exclude로 차단).

    각 단계를 '주어진 컨텍스트 → 형제 프레임·창' 순으로 훑는다: 신뢰 클릭(trusted)을 모든 프레임에서
    먼저 소진한 뒤에야 JS 폴백으로 내려간다(자동 인증요청 게이트는 trusted만 통과하므로 순서가 중요)."""
    p = AUTH_PROVIDERS.get(str(provider or "").lower(), AUTH_PROVIDERS["kakao"])
    ctxs = _sibling_contexts(page)
    for c in ctxs:
        if await _provider_click_selectors(c, p):
            return "trusted"
    for c in ctxs:
        if await _provider_click_tokens_js(c, p):
            return "js"
    for c in ctxs:
        if await _provider_click_loose_js(c, p):
            return "js"
    return False


async def click_kakaotalk_in_anyid(page) -> bool:
    """(호환 래퍼) anyid 모달에서 카카오톡 클릭 — click_provider_in_anyid('kakao')."""
    return await click_provider_in_anyid(page, "kakao")


async def detect_auth_form(page) -> bool:
    """본인인증 정보 입력 폼이 열렸는지 감지 — 메인뿐 아니라 형제 프레임·창까지 살핀다.

    ⚠️ 신형 plus.gov.kr 등은 인증 폼이 '자식 프레임'에 렌더된다(제공자 클릭·'인증 완료' 클릭과 같은
    프레임 분리 갭). 메인 page 만 보던 기존 판정은 그 화면에서 폼을 '없음'으로 오판해, 폼을 채워야 하는
    사용자에게 '폰 승인만 하세요'라는 잘못된 안내를 띄웠다(work24는 폼 자동입력이 없어 특히 치명적 —
    어르신이 빈 폼을 두고 승인부터 시도). page 를 맨 앞에 두므로 폼이 메인에 있으면 동작 불변(순수 확장).
    gov24/apply 는 이미 프레임 인지 컨텍스트를 넘겨 결과 불변, work24(bare page)만 실제로 교정된다."""
    for ctx in _sibling_contexts(page):
        for sel in AUTH_FORM_SELECTORS:
            try:
                if await ctx.locator(sel).first.count() > 0:
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


async def _click_auth_confirm_any(ctx_page) -> bool:
    """'인증 완료' 버튼을 메인 page 뿐 아니라 형제 프레임·창까지 훑어 누른다 → 눌렀으면 True.

    ⚠️ 실사용 배경(2026-07-20 리허설): 신형 plus.gov.kr 간편인증은 '정보 입력 폼·인증 완료 버튼'이
    자식 프레임에 렌더된다 — 메인 page 만 보던 기존 자동 클릭은 폰 승인 뒤에도 '인증 완료'를 못 눌러
    로그인이 끝나지 않는 경우가 있었다(제공자 클릭은 이미 _sibling_contexts 로 해결한 것과 같은 갭).
    page 를 맨 앞에 두므로 버튼이 메인에 있으면 동작은 기존과 100% 동일 — 순수 확장(최악도 기존과 같음).

    승인 전 클릭이면 gov24 가 '완료되지 않았습니다' 안내만 띄우므로, 그 안내의 '확인'만 닫고(메인 팝업
    '닫기'는 절대 건드리지 않음) 다음 주기에 재시도한다. 실제 본인인증(폰 [인증 허용])은 여전히 사용자 몫."""
    for ctx in _sibling_contexts(ctx_page):
        for sel in AUTH_CONFIRM_SELECTORS:
            try:
                el = ctx.locator(sel).first
                if await el.count() > 0 and await el.is_visible():
                    await el.click()
                    await asyncio.sleep(1.2)
                    try:
                        body = await ctx.evaluate("() => document.body ? document.body.innerText : ''")
                    except Exception:
                        body = ""
                    if any(k in (body or "") for k in ("완료되지 않", "완료되지않", "미완료")):
                        await click_by_text(ctx, ["확인"])
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
    # '인증 완료' 자동 클릭(사용자 요청) — 폰 승인 뒤 앱이 완료 버튼을 눌러준다. 승인 전 클릭은 무해
    #   ('미완료' 안내만 뜸)하므로 간격을 두고 재시도. 폰 승인 시간을 먼저 주려 20초부터 시작.
    confirm_start, confirm_interval = 20, 12
    last_confirm = 0

    for elapsed in range(timeout_sec):
        # 취소·창닫힘 즉시 탈출(닫힌 창 상대로 최대 timeout_sec 유령 대기하던 것 차단, 감사 확정)
        check_cancel(task, getattr(page, "context", None))
        try:
            if page.is_closed():
                raise CancelledByUser("로그인 창이 닫혀 자동화를 중단했어요.")
        except CancelledByUser:
            raise
        except Exception:
            pass
        # 최소 대기 구간: 성급한 성공 판정 금지(안티봇/위젯 리다이렉트 오탐 방지)
        if elapsed < min_wait_sec:
            await asyncio.sleep(1)
            continue

        # 🔵 '인증 완료' 자동 클릭 — 사용자가 폰에서 승인만 하면 앱이 완료 버튼을 눌러 로그인을 마무리한다.
        #   ⚠️ 실제 본인인증(폰 [인증 허용])은 여전히 사용자 몫(HITL 유지). 이 클릭은 승인 후의 기계적 마무리.
        #   승인 전이면 gov24가 '완료되지 않았습니다' 안내만 띄우므로, 그 안내의 확인만 닫고(메인 팝업 '닫기'는
        #   절대 건드리지 않음) 다음 주기에 재시도한다. 승인되면 다음 URL 체크에서 완료로 잡힌다.
        if elapsed >= confirm_start and (elapsed - last_confirm) >= confirm_interval:
            last_confirm = elapsed
            try:
                # 메인 page 뿐 아니라 형제 프레임·창까지 훑어 '인증 완료'를 누른다 — 신형 plus.gov.kr은
                #   완료 버튼이 자식 프레임에 있어 메인만 보던 기존 클릭이 폰 승인 뒤에도 불발하던 실사용
                #   갭을, 제공자 클릭과 동일한 _sibling_contexts 순회로 해소. page 우선이라 메인이면 동작 불변.
                await _click_auth_confirm_any(page)
            except Exception:
                pass

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
    iframe 내부는 프레임 요소의 화면 오프셋을 더해 Page 마우스로 신뢰 클릭한다. 성공 여부 반환."""
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
    # 2) Page면 바로, Frame이면 iframe의 메인 뷰포트 좌표를 더해 신뢰된 마우스 클릭.
    mouse = getattr(page_or_frame, "mouse", None)
    if mouse is not None:
        try:
            await mouse.click(box["x"], box["y"])
            return True
        except Exception:
            pass
    try:
        frame_element = await page_or_frame.frame_element()
        frame_box = await frame_element.bounding_box()
        frame_page = page_or_frame.page
        frame_mouse = getattr(frame_page, "mouse", None)
        if frame_box and frame_mouse is not None:
            await frame_mouse.click(frame_box["x"] + box["x"], frame_box["y"] + box["y"])
            return True
    except Exception:
        pass
    # 특수 프레임/교차 출처에서 좌표를 얻지 못할 때만 합성 클릭을 마지막 폴백으로 사용.
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


async def wait_any_visible(page, selectors: list, timeout_s: float, poll: float = 0.3) -> bool:
    """선택자 중 하나라도 나타날 때까지 '조기 탈출' 폴링 — 고정 sleep 대체용 속도 최적화.

    ⚠️ 계약: 상한(timeout_s)은 기존 고정 sleep과 동일하게 두고, 준비가 끝났으면 즉시 진행한다.
    → 오늘보다 느려질 수는 없고(최악 = 기존과 동일), 빠른 회선에선 단계당 수 초를 아낀다.
    셀렉터는 '이미 검증된 기존 목록'을 그대로 받는다(새 DOM 가정 금지). 찾으면 True, 상한 도달 False.
    """
    end = asyncio.get_event_loop().time() + max(0.0, timeout_s)
    while True:
        for sel in selectors:
            try:
                if await asyncio.wait_for(page.locator(sel).first.count(), timeout=3) > 0:
                    return True
            except Exception:
                continue
        if asyncio.get_event_loop().time() >= end:
            return False
        await asyncio.sleep(poll)


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
