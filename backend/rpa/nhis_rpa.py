"""
국민건강보험공단 건강보험 자격득실확인서 RPA (Playwright)

흐름:
  ① 자격득실확인서 URL 접속 → 로그인 페이지 리디렉션
  ② 팝업 닫기
  ③ '간편인증' 탭 클릭 → anyid 위젯 활성화
  ④ 카카오톡 아이콘 클릭 (JS dispatchEvent)
  ⑤ 이름/생년월일/전화번호 자동 입력 → 전체동의 → 인증 요청
  ⑥ 폰에서 카카오 알림 승인 대기 → 로그인 감지
  ⑦ 발급 버튼 클릭 → 완료
"""
import asyncio
import re
from rpa.base import take_screenshot, make_browser_context_args

NHIS_CERT_URL = "https://www.nhis.or.kr/nhis/minwon/jpAea00401.do"
CERT_URL_KEYWORD = "jpAea00401"
LOGIN_URL_KEYWORD = "personalLoginPage"

ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "input[value*='발급']",
    "input[value*='출력']",
    "button:has-text('출력')",
    "button:has-text('확인서 발급')",
    ".btn-issue", "#btnIssue", "#btnPrint",
]

LOGOUT_SELECTORS = [
    "a[href*='logout']", "a[href*='Logout']",
    "a[title*='로그아웃']", "button:has-text('로그아웃')",
    ".btn-logout", ".logout", ".user-logout",
    "a:has-text('로그아웃')",
]


def _normalize_user_info(user_info: dict) -> tuple:
    name = user_info.get("user_name", "")
    birth_raw = re.sub(r"[^0-9]", "", user_info.get("birth_date", ""))
    phone_raw = re.sub(r"[^0-9]", "", user_info.get("phone", ""))
    phone_prefix = phone_raw[:3] if len(phone_raw) >= 3 else "010"
    phone_suffix = phone_raw[3:] if len(phone_raw) > 3 else ""
    return name, birth_raw, phone_prefix, phone_suffix


# ─── Step 1: 팝업 닫기 + 간편인증 탭 활성화 ──────────────────────────────────

async def _prepare_login_page(page, task) -> None:
    """팝업 닫기 후 간편인증(민간 인증서) 탭 클릭해서 anyid 위젯 활성화"""
    await asyncio.sleep(2)

    # 팝업 닫기
    for sel in [
        "button:has-text('오늘 하루 열지 않기')",
        "a:has-text('오늘 하루 열지 않기')",
        "button:has-text('닫기')",
        ".popup-close", ".btn-close", ".layer-close", ".close",
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click(timeout=2000)
                await asyncio.sleep(0.5)
                break
        except Exception:
            pass

    # 간편인증 / 민간 인증서 탭 클릭 (anyid 위젯을 화면에 표시)
    activated = False
    for sel in [
        "li:has-text('민간 인증서')",
        "li:has-text('간편인증')",
        "li:has-text('간편 인증')",
        "a:has-text('간편인증')",
        "button:has-text('간편인증')",
        ".tab-easy", ".tab-simple",
        "[data-tab='simple']", "[role='tab']:has-text('간편')",
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click(force=True)
                await asyncio.sleep(2)
                activated = True
                break
        except Exception:
            continue

    if not activated:
        # JS 폴백으로 탭 클릭
        try:
            result = await page.evaluate("""
                () => {
                    const kws = ['민간 인증서', '간편인증', '간편 인증', '민간인증'];
                    for (const kw of kws) {
                        const el = Array.from(
                            document.querySelectorAll('li, a, button, [role="tab"]')
                        ).find(e => (e.textContent || '').trim().includes(kw));
                        if (el) { el.click(); return el.textContent.trim(); }
                    }
                    return null;
                }
            """)
            if result:
                await asyncio.sleep(2)
                activated = True
        except Exception:
            pass

    ss = await take_screenshot(page)
    task.update(
        "running",
        f"로그인 페이지 준비 완료 ({'간편인증 탭 활성화' if activated else '탭 자동 클릭 실패 — 위젯 대기 중'}).\n"
        "카카오 인증 위젯 탐색 중...",
        ss,
    )


# ─── Step 2: anyid 프레임 탐색 ───────────────────────────────────────────────

async def _find_anyid_frame(page, timeout_sec: int = 20):
    """anyid/webplay iframe 탐색"""
    for _ in range(timeout_sec):
        for frame in page.frames:
            if "eswebgen" in frame.url or "webplay" in frame.url:
                return frame
        await asyncio.sleep(1)
    return None


# ─── Step 3: 카카오톡 아이콘 클릭 ────────────────────────────────────────────

async def _click_kakao_icon(frame, page, task) -> bool:
    """모든 프레임에서 카카오톡 요소 탐색 후 클릭 (중첩 iframe 포함)"""

    # 전체 프레임 목록 + URL 로그
    all_frames = list(page.frames)
    frame_urls = "\n".join(f"  {f.url[:80]}" for f in all_frames)
    task.update("running", f"전체 프레임 {len(all_frames)}개 탐색 중:\n{frame_urls[:400]}")

    # 각 프레임에서 카카오 요소 탐색 (webplay.jsp 외 중첩 iframe 포함)
    for f in all_frames:
        try:
            # 프레임 로드 대기
            try:
                await f.wait_for_load_state("domcontentloaded", timeout=2000)
            except Exception:
                pass

            result = await f.evaluate("""
                () => {
                    // class/src 기반 탐색
                    const clsSels = [
                        '.ico.certificate.kakao-talk', '.kakao-talk',
                        '[class*="kakao"]', '[class*="Kakao"]',
                    ];
                    for (const sel of clsSels) {
                        const el = document.querySelector(sel);
                        if (el) {
                            const target = el.closest('li') || el;
                            target.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                            return 'cls:' + sel + ' @ ' + location.href.slice(-40);
                        }
                    }
                    // 텍스트/alt/src 기반
                    const all = document.querySelectorAll('li, a, button, img, span, div');
                    for (const el of all) {
                        const text = (el.textContent || el.alt || el.title || '');
                        const cls  = (el.className || '').toString();
                        const src  = (el.src || el.currentSrc || '');
                        if (text.includes('카카오톡') || cls.toLowerCase().includes('kakao')
                            || src.toLowerCase().includes('kakao')) {
                            const target = el.closest('li') || el;
                            target.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                            return 'text:' + text.trim().slice(0, 20) + ' @ ' + location.href.slice(-40);
                        }
                    }
                    return null;
                }
            """)

            if result:
                task.update("running", f"카카오 클릭 성공: {result}")
                await asyncio.sleep(2)
                return True

        except Exception:
            continue

    # 모든 프레임 실패 → 각 프레임 li 개수 확인용 디버그
    debug_lines = []
    for f in all_frames:
        try:
            cnt = await f.evaluate("() => document.querySelectorAll('li, img, button').length")
            debug_lines.append(f"  {f.url[-50:]}: {cnt}개 요소")
        except Exception:
            debug_lines.append(f"  {f.url[-50:]}: 접근 불가")
    task.update("running", f"카카오 자동 클릭 실패. 각 프레임 요소 수:\n" + "\n".join(debug_lines[:10]))
    return False


# ─── Step 4: 폼 자동 입력 ────────────────────────────────────────────────────

_JS_FILL_FORM = """
(args) => {
    const {nameVal, birthVal, phoneSuffix, phonePrefix} = args;

    function setInput(el, val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
        el.dispatchEvent(new Event('input',  {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
    }
    function setSelect(el, val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
        el.dispatchEvent(new Event('change', {bubbles: true}));
    }

    const filled = [];

    // ── 행(tr) 기반: th/td 레이블로 같은 행의 input 탐색 ──
    for (const row of document.querySelectorAll('tr')) {
        const label = (row.querySelector('th, .label, td:first-child')?.textContent || '').trim();
        const inp   = row.querySelector('input[type="text"], input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])');
        const sel   = row.querySelector('select');
        if (!inp) continue;
        if ((label.includes('이름') || label.includes('성명')) && !filled.includes('name')) {
            setInput(inp, nameVal); filled.push('name');
        } else if (label.includes('생년월일') && !filled.includes('birth')) {
            setInput(inp, birthVal); filled.push('birth');
        } else if ((label.includes('번호') || label.includes('전화') || label.includes('휴대')) && !filled.includes('phone')) {
            setInput(inp, phoneSuffix);
            if (sel) setSelect(sel, phonePrefix);
            filled.push('phone');
        }
    }

    // ── 폴백: label 태그 기반 ──
    if (!filled.includes('name') || !filled.includes('birth')) {
        for (const lbl of document.querySelectorAll('label')) {
            const txt = lbl.textContent.trim();
            const inp = lbl.control || document.getElementById(lbl.htmlFor)
                        || lbl.nextElementSibling?.querySelector?.('input')
                        || lbl.parentElement?.querySelector('input');
            if (!inp) continue;
            if ((txt.includes('이름') || txt.includes('성명')) && !filled.includes('name')) {
                setInput(inp, nameVal); filled.push('name_lbl');
            } else if (txt.includes('생년월일') && !filled.includes('birth')) {
                setInput(inp, birthVal); filled.push('birth_lbl');
            }
        }
    }

    if (filled.length === 0) return null;

    // 전체동의 체크박스
    const allChk = document.querySelector('input[type="checkbox"][id*="all"], input[type="checkbox"][name*="all"]')
                   || document.querySelector('input[type="checkbox"]');
    if (allChk && !allChk.checked) { allChk.click(); }

    return filled.join(',');
}
"""


async def _dump_inputs(page) -> str:
    """디버그: 모든 프레임의 text input 목록 반환"""
    lines = []
    for f in page.frames:
        try:
            info = await f.evaluate("""
                () => {
                    const inputs = document.querySelectorAll(
                        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])'
                    );
                    return Array.from(inputs).map(el => ({
                        tag: el.tagName, type: el.type, name: el.name, id: el.id,
                        placeholder: el.placeholder, value: el.value.slice(0,20),
                        parentText: (el.closest('tr,li,div,dt')?.textContent||'').trim().slice(0,40),
                    }));
                }
            """)
            if info:
                lines.append(f"Frame: {f.url[-50:]}")
                for i in info:
                    lines.append(f"  [{i['type']}] name={i['name']} id={i['id']} ph='{i['placeholder']}' parent='{i['parentText']}'")
        except Exception:
            pass
    return "\n".join(lines[:40])


_JS_FILL_FORM_V2 = """
(args) => {
    const {nameVal, birthVal, phoneSuffix, phonePrefix} = args;

    function setInput(el, val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
        ['input','change','keyup'].forEach(ev => el.dispatchEvent(new Event(ev, {bubbles:true})));
    }
    function setSelect(el, val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
        el.dispatchEvent(new Event('change', {bubbles:true}));
    }

    const filled = [];

    // ① 부모 텍스트/placeholder/name/id 기반 탐색 (구조 무관)
    const allInputs = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])'
    ));

    for (const inp of allInputs) {
        const ph  = (inp.placeholder || '').toLowerCase();
        const nm  = (inp.name || inp.id || '').toLowerCase();
        const ctx = (inp.closest('tr,li,dl,div')?.textContent || '').toLowerCase();

        if (!filled.includes('name') &&
            (ph.includes('홍길동') || ph.includes('이름') || ph.includes('성명') ||
             nm.includes('nm') || nm.includes('name') || nm.includes('user') ||
             ctx.includes('이름') || ctx.includes('성명'))) {
            setInput(inp, nameVal); filled.push('name'); continue;
        }
        if (!filled.includes('birth') &&
            (ph.includes('19900101') || ph.includes('yyyymmdd') || ph.includes('생년') ||
             nm.includes('birth') || nm.includes('bday') ||
             ctx.includes('생년월일'))) {
            setInput(inp, birthVal); filled.push('birth'); continue;
        }
        if (!filled.includes('phone') &&
            (ph.includes('12341234') || ph.includes('번호') ||
             nm.includes('phone') || nm.includes('tel') || nm.includes('mphno') || nm.includes('hpno') ||
             ctx.includes('번호') || ctx.includes('전화') || ctx.includes('휴대'))) {
            setInput(inp, phoneSuffix);
            const sel = inp.closest('tr,li,div')?.querySelector('select');
            if (sel) setSelect(sel, phonePrefix);
            filled.push('phone'); continue;
        }
    }

    // ② 못 찾으면 가시적 텍스트 input 순서대로 채우기 (최후 수단)
    if (filled.length === 0) {
        const visible = allInputs.filter(el => {
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
        });
        if (visible.length >= 1) { setInput(visible[0], nameVal);  filled.push('name_order'); }
        if (visible.length >= 2) { setInput(visible[1], birthVal); filled.push('birth_order'); }
        if (visible.length >= 3) { setInput(visible[2], phoneSuffix); filled.push('phone_order');
            const sel = visible[2].closest('tr,li,div')?.querySelector('select');
            if (sel) setSelect(sel, phonePrefix);
        }
    }

    if (filled.length === 0) return null;

    // 전체동의 체크박스
    const chks = document.querySelectorAll('input[type="checkbox"]');
    for (const chk of chks) { if (!chk.checked) chk.click(); }

    return filled.join(',');
}
"""


async def _fill_kakao_form(page, name: str, birth: str, prefix: str, suffix: str, task) -> bool:
    """카카오 인증 폼 자동 입력 — 최대 12초 재시도, 구조 무관 다중 전략"""
    args = {'nameVal': name, 'birthVal': birth, 'phoneSuffix': suffix, 'phonePrefix': prefix}

    for attempt in range(12):
        if attempt == 3:
            # 3초 후 DOM 덤프로 구조 확인
            dump = await _dump_inputs(page)
            task.update("running", f"폼 DOM 구조 분석:\n{dump[:500]}")

        for f in page.frames:
            try:
                result = await f.evaluate(_JS_FILL_FORM_V2, args)
                if result:
                    task.update("running",
                        f"폼 입력 완료 ({result})\n"
                        f"이름: {name} / 생년월일: {birth} / 전화: {prefix}-{suffix}")
                    await asyncio.sleep(0.5)
                    return True
            except Exception:
                continue
        await asyncio.sleep(1)

    return False


async def _dismiss_security_popups(page) -> None:
    """AhnLab Safe Transaction 등 보안 프로그램 설치 팝업 → '취소' 클릭"""
    cancel_keywords = ['AhnLab', '방화벽', '보안', '설치되어 있지 않습니다']
    for f in page.frames:
        try:
            await f.evaluate("""
                (keywords) => {
                    const dialogs = document.querySelectorAll(
                        '.confirm, .dialog, .modal, .popup, .layer, [role="dialog"], [role="alertdialog"]'
                    );
                    for (const dlg of dialogs) {
                        const txt = dlg.textContent || '';
                        if (!keywords.some(k => txt.includes(k))) continue;
                        // '취소' 버튼 클릭 (설치 거부)
                        const cancelBtn = Array.from(dlg.querySelectorAll('button, a'))
                            .find(b => ['취소', '닫기', '아니오', 'Cancel'].includes(b.textContent.trim()));
                        if (cancelBtn) { cancelBtn.click(); return true; }
                    }
                    return false;
                }
            """, cancel_keywords)
        except Exception:
            pass


async def _click_auth_request(page) -> bool:
    """'인증 요청' 버튼 클릭 — 모든 프레임 전수 탐색, 보안 팝업 자동 처리"""
    for f in page.frames:
        try:
            result = await f.evaluate("""
                () => {
                    const btn = Array.from(
                        document.querySelectorAll('button, a, input, span, div')
                    ).find(e => (e.textContent || e.value || '').trim() === '인증 요청'
                               || (e.textContent || e.value || '').includes('인증 요청'));
                    if (btn) {
                        btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                        return true;
                    }
                    return false;
                }
            """)
            if result:
                # 클릭 후 AhnLab 등 보안 팝업 자동 취소
                await asyncio.sleep(1.5)
                await _dismiss_security_popups(page)
                return True
        except Exception:
            continue

    # Playwright 폴백
    for f in page.frames:
        for sel in ["button:has-text('인증 요청')", "a:has-text('인증 요청')", "input[value*='인증 요청']"]:
            try:
                el = f.locator(sel).first
                if await el.count() > 0:
                    await el.click(force=True)
                    await asyncio.sleep(1.5)
                    await _dismiss_security_popups(page)
                    return True
            except Exception:
                continue

    return False


# ─── Step 5: 로그인 완료 대기 ────────────────────────────────────────────────

async def _wait_for_cert_page(page, task, timeout_sec: int = 300) -> bool:
    last_report = 0
    for elapsed in range(timeout_sec):
        try:
            url = page.url
            if CERT_URL_KEYWORD in url and LOGIN_URL_KEYWORD not in url:
                return True
            for sel in LOGOUT_SELECTORS:
                try:
                    if await page.locator(sel).first.count() > 0:
                        return True
                except Exception:
                    pass
        except Exception:
            pass

        if elapsed > 0 and elapsed - last_report >= 15:
            try:
                ss = await take_screenshot(page)
                task.update(
                    "waiting_login",
                    f"📱 카카오톡 알림 승인 대기 중...\n\n"
                    f"스마트폰에서 카카오톡 → [본인인증 허용] 을 눌러주세요.\n\n"
                    f"⏱ 남은 시간: {timeout_sec - elapsed}초",
                    ss,
                )
                last_report = elapsed
            except Exception:
                pass

        await asyncio.sleep(1)
    return False


# ─── Step 6: 발급 버튼 클릭 ──────────────────────────────────────────────────

async def _click_issue_button(page, context, task) -> bool:
    await asyncio.sleep(2)
    for check_page in context.pages:
        for sel in ISSUE_SELECTORS:
            try:
                el = check_page.locator(sel).first
                if await el.count() > 0:
                    await el.scroll_into_view_if_needed()
                    await el.click()
                    await asyncio.sleep(1.5)
                    ss = await take_screenshot(check_page)
                    task.update("running", "'발급' 버튼 클릭 완료 — 처리 중...", ss)
                    return True
            except Exception:
                continue

    try:
        for check_page in context.pages:
            result = await check_page.evaluate("""
                () => {
                    const kws = ['발급', '확인서 발급', '발급하기', '출력', '인쇄'];
                    for (const kw of kws) {
                        const el = Array.from(
                            document.querySelectorAll('button, input[type=button], input[type=submit], a')
                        ).find(e => (e.textContent || e.value || '').includes(kw));
                        if (el) { el.click(); return kw; }
                    }
                    return null;
                }
            """)
            if result:
                await asyncio.sleep(1.5)
                ss = await take_screenshot(check_page)
                task.update("running", f"JS로 '{result}' 버튼 클릭 완료", ss)
                return True
    except Exception:
        pass

    return False


async def _click_confirm_dialogs(context) -> bool:
    """'프린트 출력하시겠습니까?' 등 확인 다이얼로그에서 '확인' 버튼 자동 클릭"""
    for p in context.pages:
        for f in p.frames:
            try:
                result = await f.evaluate("""
                    () => {
                        // '출력', '프린트', '발급' 관련 확인 다이얼로그 탐색
                        const keywords = ['프린트', '출력', '발급', '인쇄'];
                        const containers = document.querySelectorAll(
                            '.confirm, .dialog, .modal, .popup, .layer, [role="dialog"], [role="alertdialog"]'
                        );
                        for (const dlg of containers) {
                            const text = dlg.textContent || '';
                            const hasKeyword = keywords.some(k => text.includes(k));
                            if (!hasKeyword) continue;
                            // 확인/예 버튼 찾기
                            const btn = Array.from(dlg.querySelectorAll('button, a'))
                                .find(b => ['확인', '예', 'OK', '출력', '인쇄'].includes(b.textContent.trim()));
                            if (btn) { btn.click(); return btn.textContent.trim(); }
                        }
                        // 폴백: 화면에 보이는 모달 안의 '확인' 버튼
                        const allBtns = Array.from(document.querySelectorAll('button'));
                        for (const btn of allBtns) {
                            if (btn.textContent.trim() === '확인') {
                                const style = getComputedStyle(btn);
                                if (style.display !== 'none' && style.visibility !== 'hidden') {
                                    btn.click();
                                    return '확인(fallback)';
                                }
                            }
                        }
                        return null;
                    }
                """)
                if result:
                    return True
            except Exception:
                pass
    return False


async def _wait_for_print_popup(context, task, timeout_sec: int = 90) -> bool:
    print_sels = [
        "button:has-text('출력')", "button:has-text('인쇄')",
        "button:has-text('PDF')", "button:has-text('저장')",
        "#btnPrint", ".btn-print",
    ]
    for tick in range(timeout_sec):
        try:
            # 먼저 '프린트 출력하시겠습니까?' 같은 확인 다이얼로그 처리
            if await _click_confirm_dialogs(context):
                ss = await take_screenshot(context.pages[-1] if context.pages else context.pages[0])
                task.update("running", "✅ 출력 확인 다이얼로그 자동 클릭 완료!", ss)
                await asyncio.sleep(2)

            for check_page in context.pages:
                for sel in print_sels:
                    try:
                        el = check_page.locator(sel).first
                        if await el.count() > 0:
                            await check_page.bring_to_front()
                            ss = await take_screenshot(check_page)
                            task.update("running", "출력/PDF 버튼 감지! 클릭합니다.", ss)
                            await el.click()
                            return True
                    except Exception:
                        pass
            if len(context.pages) > 1:
                newest = context.pages[-1]
                await newest.wait_for_load_state("domcontentloaded", timeout=3000)
                ss = await take_screenshot(newest)
                task.update("running", "발급 완료 페이지 감지!", ss)
                return True
        except Exception:
            pass
        await asyncio.sleep(1)
    return False


# ─── 메인 RPA 진입점 ─────────────────────────────────────────────────────────

async def run_nhis_rpa(task, user_info: dict = None) -> None:
    """국민건강보험공단 건강보험 자격득실확인서 발급 RPA"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치\n터미널에서: pip install playwright && playwright install chromium")
        return

    info = user_info or {}
    name, birth, ph_prefix, ph_suffix = _normalize_user_info(info)
    has_user_info = bool(name and birth and ph_suffix)

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,
                slow_mo=150,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            ctx_args = make_browser_context_args()
            ctx_args["no_viewport"] = True
            context = await browser.new_context(**ctx_args)
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① 자격득실확인서 URL 접속
            task.update("running", "건강보험공단 접속 중...")
            try:
                await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(NHIS_CERT_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(2)

            current_url = page.url

            # ② 이미 로그인된 경우 바로 발급
            if CERT_URL_KEYWORD in current_url and LOGIN_URL_KEYWORD not in current_url:
                ss = await take_screenshot(page)
                task.update("running", "이미 로그인 상태 — 발급 버튼 탐색 중...", ss)

            else:
                # ③ 팝업 닫기 + 간편인증 탭 클릭
                await _prepare_login_page(page, task)

                if has_user_info:
                    # ④ anyid 프레임 탐색
                    anyid = await _find_anyid_frame(page, timeout_sec=20)

                    if anyid:
                        ss = await take_screenshot(page)
                        task.update("running", "인증 위젯 발견! 카카오톡 클릭 중...", ss)

                        # ⑤ 카카오톡 클릭
                        kakao_ok = await _click_kakao_icon(anyid, page, task)
                        ss = await take_screenshot(page)

                        if kakao_ok:
                            task.update("running", "카카오톡 선택 완료. 폼 자동 입력 중...", ss)

                            # ⑥ 모든 프레임에서 폼 탐색 (카카오 클릭 후 폼이 어느 frame에 뜰지 모름)
                            await asyncio.sleep(2)
                            filled = await _fill_kakao_form(page, name, birth, ph_prefix, ph_suffix, task)

                            if filled:
                                ss = await take_screenshot(page)
                                task.update("running",
                                    f"개인정보 입력 완료\n"
                                    f"이름: {name} / 생년월일: {birth} / 전화: {ph_prefix}-{ph_suffix}\n"
                                    "'인증 요청' 클릭 중...",
                                    ss,
                                )

                                # ⑦ 인증 요청 클릭
                                req_ok = await _click_auth_request(page)
                                await asyncio.sleep(1)
                                ss = await take_screenshot(page)

                                if req_ok:
                                    task.update(
                                        "waiting_login",
                                        "📱 카카오톡 알림이 발송되었습니다!\n\n"
                                        "스마트폰의 카카오톡 알림을 확인하고\n"
                                        "[본인인증 허용] 버튼을 눌러주세요.\n\n"
                                        "✅ 승인하면 자동으로 서류 발급이 진행됩니다.",
                                        ss,
                                    )
                                else:
                                    task.update("waiting_login",
                                        "⚠️ '인증 요청' 버튼을 찾지 못했습니다.\n"
                                        "브라우저에서 직접 '인증 요청' 버튼을 클릭해주세요.\n\n"
                                        "📱 카카오톡 알림이 오면 [본인인증 허용]을 눌러주세요.",
                                        ss,
                                    )
                            else:
                                ss = await take_screenshot(page)
                                task.update("waiting_login",
                                    "⚠️ 폼 자동 입력 실패.\n"
                                    "브라우저에서 직접 정보를 입력해주세요:\n"
                                    f"이름: {name} / 생년월일: {birth} / 전화: {ph_prefix}-{ph_suffix}\n\n"
                                    "입력 후 '인증 요청' → 카카오 알림 승인 → 자동 계속",
                                    ss,
                                )
                        else:
                            ss = await take_screenshot(page)
                            task.update("waiting_login",
                                "⚠️ 카카오 버튼 자동 클릭 실패.\n"
                                "브라우저에서 카카오톡을 선택하고 아래 정보를 입력해주세요:\n\n"
                                f"이름: {name}\n생년월일: {birth}\n전화: {ph_prefix}-{ph_suffix}\n\n"
                                "입력 후 '인증 요청' → 카카오 알림 승인",
                                ss,
                            )
                    else:
                        ss = await take_screenshot(page)
                        task.update("waiting_login",
                            "⚠️ anyid 위젯을 찾지 못했습니다.\n"
                            "브라우저에서 직접 카카오톡 로그인을 진행해주세요:\n\n"
                            f"이름: {name} / 생년월일: {birth} / 전화: {ph_prefix}-{ph_suffix}",
                            ss,
                        )
                else:
                    ss = await take_screenshot(page)
                    task.update("waiting_login",
                        "🔐 로그인을 진행해주세요 (브라우저)\n\n"
                        "1️⃣ 간편 인증 탭 클릭\n"
                        "2️⃣ 카카오톡 선택\n"
                        "3️⃣ 이름 / 생년월일 / 전화번호 입력\n"
                        "4️⃣ 전체동의 → 인증 요청\n"
                        "5️⃣ 📱 카카오톡 알림 → [본인인증 허용]",
                        ss,
                    )

                # ⑧ 로그인 완료 대기
                login_ok = await _wait_for_cert_page(page, task, timeout_sec=300)
                if not login_ok:
                    ss = await take_screenshot(page)
                    task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                    await browser.close()
                    return

                ss = await take_screenshot(page)
                task.update("running", "✅ 로그인 완료! 자격득실확인서 페이지로 이동 중...", ss)
                await asyncio.sleep(1)

                if CERT_URL_KEYWORD not in page.url:
                    await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=20000)
                    await asyncio.sleep(2)

            # ⑨ 발급 버튼 클릭
            ss = await take_screenshot(page)
            task.update("running", "발급 버튼 탐색 중...", ss)
            clicked = await _click_issue_button(page, context, task)

            if not clicked:
                ss = await take_screenshot(page)
                task.update("running",
                    "발급 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '발급하기' 또는 '출력' 버튼을 직접 클릭해주세요.", ss)

            # ⑩ 출력/PDF 팝업 대기
            await _wait_for_print_popup(context, task, timeout_sec=90)

            try:
                final_page = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final_page)
            except Exception:
                ss = await take_screenshot(page)

            task.update(
                "done",
                "✅ 건강보험 자격득실확인서 발급 절차 완료!\n\n"
                "브라우저에서 ⌘+P 로 PDF 저장 또는 인쇄가 가능합니다.\n"
                "브라우저는 2분 후 자동 종료됩니다.",
                ss,
            )
            task.result = {"success": True, "doc_name": "건강보험 자격득실확인서"}

            await asyncio.sleep(120)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            ss = await take_screenshot(page)
        except Exception:
            ss = None
        task.update("error", f"자동화 오류: {str(e)[:300]}\n터미널에서 상세 로그를 확인하세요.", ss)
