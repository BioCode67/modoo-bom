"""
국민건강보험공단 건강보험 자격득실확인서 RPA (Playwright)

흐름:
  ① personalLoginPage.do 접속
  ② 간편 인증 로그인 바로가기 클릭 → anyid 위젯 오픈
  ③ 카카오톡 li 클릭
  ④ 메인 페이지 DOM에서 #oacx_name / #oacx_birth / #oacx_phone2 직접 입력
  ⑤ #totalAgree 체크 → 인증 요청 클릭 → 보안 팝업 자동 취소
  ⑥ 카카오 알림 승인 대기 → 로그인 감지
  ⑦ 발급 버튼 클릭 → 완료
"""
import asyncio
import re
from rpa.base import (
    take_screenshot, make_browser_context_args, get_launch_options, launch_browser, save_document,
    check_cancel, cancellable_sleep, CancelledByUser, NO_PRINT_SCRIPT,
)

NHIS_CERT_URL  = "https://www.nhis.or.kr/nhis/minwon/jpAea00401.do"
LOGIN_URL      = "https://www.nhis.or.kr/nhis/etc/personalLoginPage.do"
CERT_KEYWORD   = "jpAea00401"
LOGIN_KEYWORD  = "personalLoginPage"

ISSUE_SELECTORS = [
    "button:has-text('발급')", "a:has-text('발급하기')",
    "button:has-text('발급하기')", "input[value*='발급']",
    "input[value*='출력']", "button:has-text('출력')",
    "button:has-text('확인서 발급')", ".btn-issue", "#btnIssue", "#btnPrint",
]

# ── 사용자 정보 정규화 ────────────────────────────────────────────────────────

def _normalize(user_info: dict) -> tuple:
    # 값이 None으로 들어와도(키는 있고 값이 null) re.sub이 터지지 않게 str(... or "")로 강제
    # — 다른 RPA 모듈(gov24·apply)과 동일한 방어.
    name       = str(user_info.get("user_name") or "")
    birth      = re.sub(r"[^0-9]", "", str(user_info.get("birth_date") or ""))
    phone_raw  = re.sub(r"[^0-9]", "", str(user_info.get("phone") or ""))
    prefix     = phone_raw[:3]  if len(phone_raw) >= 3  else "010"
    suffix     = phone_raw[3:]  if len(phone_raw) >  3  else ""
    return name, birth, prefix, suffix


# ── JS: 보안 팝업 취소 ────────────────────────────────────────────────────────

_JS_DISMISS_SECURITY = """
() => {
    const KEYWORDS = [
        'AhnLab','Safe Transaction','방화벽','PC방화벽',
        '키보드 보안','보안 프로그램','설치되어 있지 않습니다','키보드보안'
    ];
    let closed = 0;
    // 1) 명시적 레이어/모달
    const containers = document.querySelectorAll(
        '.confirm,.dialog,.modal,.popup,.layer,.alert,.dimm,.dimmed,' +
        '[role=dialog],[role=alertdialog],[class*=modal],[class*=popup],' +
        '[class*=dialog],[class*=layer],[class*=alert]'
    );
    for (const dlg of containers) {
        const txt = dlg.textContent || '';
        if (!KEYWORDS.some(k => txt.includes(k))) continue;
        const btn = Array.from(dlg.querySelectorAll('button,a,input[type=button]'))
            .find(b => ['취소','닫기','아니오','Cancel'].includes(
                (b.textContent || b.value || '').trim()
            ));
        if (btn) { btn.click(); closed++; }
    }
    // 2) 폴백: 보이는 '취소' 버튼 + 보안 키워드 부모
    if (closed === 0) {
        for (const btn of document.querySelectorAll('button,input[type=button]')) {
            if ((btn.textContent||btn.value||'').trim() !== '취소') continue;
            const s = getComputedStyle(btn);
            if (s.display === 'none' || s.visibility === 'hidden') continue;
            if (KEYWORDS.some(k => (btn.closest('div,section,form')?.textContent||'').includes(k))) {
                btn.click(); closed++;
            }
        }
    }
    return closed;
}
"""


# ── JS: 폼 입력 (ID 직접 사용) ───────────────────────────────────────────────

_JS_FILL_FORM = """
(args) => {
    const {nameVal, birthVal, suffix, prefix} = args;

    function setVal(el, val) {
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(
            el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
            'value'
        )?.set;
        if (setter) setter.call(el, val); else el.value = val;
        ['input','change','keyup'].forEach(ev =>
            el.dispatchEvent(new Event(ev, {bubbles:true}))
        );
        return true;
    }

    const filled = [];

    // 이름
    const nameEl = document.getElementById('oacx_name');
    if (nameEl && setVal(nameEl, nameVal)) filled.push('name');

    // 생년월일
    const birthEl = document.getElementById('oacx_birth');
    if (birthEl && setVal(birthEl, birthVal)) filled.push('birth');

    // 전화번호 앞자리 select (010)
    const prefixSel = Array.from(document.querySelectorAll('select'))
        .find(s => Array.from(s.options).some(o => o.value === '010') && s.offsetParent !== null);
    if (prefixSel && setVal(prefixSel, prefix)) filled.push('prefix:' + prefix);

    // 전화번호 뒷자리
    const phoneEl = document.getElementById('oacx_phone2');
    if (phoneEl && setVal(phoneEl, suffix)) filled.push('phone');

    // 전체동의 체크
    const totalAgree = document.getElementById('totalAgree');
    if (totalAgree && !totalAgree.checked) { totalAgree.click(); filled.push('agree'); }

    return filled.length >= 3 ? filled.join(',') : null;
}
"""


# ── Step 1: 팝업 닫기 ────────────────────────────────────────────────────────

async def _close_initial_popups(page) -> None:
    await asyncio.sleep(2)
    for sel in [
        "button:has-text('오늘 하루 열지 않기')", "a:has-text('오늘 하루 열지 않기')",
        "button:has-text('닫기')", ".popup-close", ".btn-close", ".layer-close",
    ]:
        try:
            el = page.locator(sel).first
            if await el.count() > 0:
                await el.click(timeout=1500)
                await asyncio.sleep(0.3)
        except Exception:
            pass


# ── Step 2: 간편인증 위젯 오픈 ────────────────────────────────────────────────

async def _open_easy_auth_widget(page, task) -> bool:
    """'간편 인증 로그인 바로가기' 링크 클릭 → anyid 위젯 표시"""
    for attempt in range(10):
        result = await page.evaluate("""
            () => {
                // 간편 인증 로그인 바로가기
                const el = Array.from(document.querySelectorAll('a,button')).find(e =>
                    (e.textContent||'').trim().includes('간편 인증 로그인 바로가기') ||
                    (e.textContent||'').trim().includes('간편인증 로그인')
                );
                if (el) { el.scrollIntoView(); el.click(); return '간편인증:' + el.textContent.trim().slice(0,20); }
                // 폴백: .simplicity a 또는 간편 인증 링크
                const fallback = document.querySelector('.simplicity a.login-link, a[href*="simplicity"]');
                if (fallback) { fallback.click(); return 'fallback'; }
                return null;
            }
        """)
        if result:
            task.update("running", f"간편인증 위젯 오픈: {result}")
            await asyncio.sleep(2)
            return True
        await asyncio.sleep(1)
    return False


# ── Step 3: 인증수단 클릭(기본 카카오톡) ─────────────────────────────────────

async def _click_kakao(page, task, provider: str = "kakao") -> bool:
    """anyid 위젯에서 선택 인증수단 클릭 — mouse.click() 좌표 방식.

    li 텍스트 '정확 일치' 우선(기존 카카오 검증 방식 유지), 못 찾으면 '포함 매칭' 폴백
    (PASS는 위젯마다 '통신사PASS'/'PASS' 표기가 갈림). 뱅크류는 exclude로 오클릭 방지.
    """
    from rpa.base import AUTH_PROVIDERS, provider_display
    p = AUTH_PROVIDERS.get(str(provider or "").lower(), AUTH_PROVIDERS["kakao"])
    pv = provider_display(provider)
    for attempt in range(20):
        # 보안 팝업 먼저 처리
        dismissed = await page.evaluate(_JS_DISMISS_SECURITY)
        if dismissed:
            task.update("running", f"보안 팝업 {dismissed}개 닫음")
            await asyncio.sleep(0.5)

        # JS로 대상 요소 좌표 획득 — width>0 인 li만 선택(숨겨진 중복 요소 회피)
        rect = await page.evaluate("""
            (cfg) => {
                const lis = Array.from(document.querySelectorAll('li')).filter(l => {
                    const r = l.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });
                const t = (l) => l.textContent.trim();
                const low = (l) => t(l).toLowerCase();
                let li = lis.find(l => cfg.labels.includes(t(l)));                    // 정확 일치 우선
                if (!li) li = lis.find(l => cfg.tokens.some(k => low(l).includes(k)) // 포함 매칭 폴백
                                            && !cfg.exclude.some(x => low(l).includes(x)));
                if (!li) return null;
                const r = li.getBoundingClientRect();
                return {x: r.left + r.width / 2, y: r.top + r.height / 2};
            }
        """, {"labels": p["labels"], "tokens": [k.lower() for k in p["tokens"]],
              "exclude": [x.lower() for x in p["exclude"]]})

        if rect:
            await page.mouse.click(rect['x'], rect['y'])
            await asyncio.sleep(1.5)
            task.update("running", f"{pv} mouse.click 완료 ({rect['x']:.0f},{rect['y']:.0f})")
            return True

        # 좌표를 못 얻으면 스크린샷 찍고 재시도
        if attempt == 0:
            ss = await take_screenshot(page)
            task.update("running", f"{pv} 좌표 탐색 중...", ss)

        await asyncio.sleep(1)
    return False


# ── Step 4: 폼 대기 + 입력 ───────────────────────────────────────────────────

async def _wait_and_fill_form(page, name, birth, prefix, suffix, task) -> bool:
    """#oacx_name 나타날 때까지 대기 후 폼 입력"""
    args = {'nameVal': name, 'birthVal': birth, 'suffix': suffix, 'prefix': prefix}

    for attempt in range(20):
        # 보안 팝업 처리
        dismissed = await page.evaluate(_JS_DISMISS_SECURITY)
        if dismissed:
            task.update("running", f"보안 팝업 {dismissed}개 닫음 (폼 대기 중)")
            await asyncio.sleep(0.5)

        # #oacx_name 가시 여부 확인
        visible = await page.evaluate("""
            () => {
                const el = document.getElementById('oacx_name');
                if (!el) return false;
                const s = getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
            }
        """)

        if visible:
            # 폼 입력
            result = await page.evaluate(_JS_FILL_FORM, args)
            if result:
                ss = await take_screenshot(page)
                task.update("running",
                    f"폼 입력 완료 ({result})\n"
                    f"이름={name} / 생년월일={birth} / 전화={prefix}-{suffix}",
                    ss,
                )
                return True
            # 입력 실패 → 다시 시도
            task.update("running", f"폼 입력 실패 (시도 {attempt+1}), 재시도...")

        await asyncio.sleep(1)

    return False


# ── Step 5: 인증 요청 클릭 ───────────────────────────────────────────────────

async def _click_auth_btn(page, task) -> bool:
    """인증 요청 버튼 클릭 후 보안 팝업 반복 처리"""
    clicked = await page.evaluate("""
        () => {
            const btn = Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.trim() === '인증 요청');
            if (btn) {
                btn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
                return true;
            }
            return false;
        }
    """)

    if not clicked:
        # Playwright 폴백
        try:
            el = page.locator("button:has-text('인증 요청')").first
            if await el.count() > 0:
                await el.click(force=True)
                clicked = True
        except Exception:
            pass

    if clicked:
        task.update("running", "인증 요청 버튼 클릭 — 보안 팝업 처리 중...")
        # 최대 5초간 보안 팝업 감지 및 취소
        for _ in range(5):
            await asyncio.sleep(1)
            dismissed = await page.evaluate(_JS_DISMISS_SECURITY)
            if dismissed:
                task.update("running", f"보안 팝업 {dismissed}개 자동 취소")

    return clicked


# ── Step 6: 로그인 대기 ───────────────────────────────────────────────────────

async def _wait_login(page, task, timeout: int = 300) -> bool:
    last_report = 0
    for elapsed in range(timeout):
        check_cancel(task, getattr(page, "context", None))  # 취소·창닫힘 즉시 탈출
        try:
            if page.is_closed():
                raise CancelledByUser("로그인 창이 닫혀 자동화를 중단했어요.")
        except CancelledByUser:
            raise
        except Exception:
            pass
        try:
            url = page.url
            if CERT_KEYWORD in url and LOGIN_KEYWORD not in url:
                return True
            # 로그아웃 버튼 = 로그인 완료 신호.
            # ⚠️ '보이는' 로그아웃만 인정 + 최소 3초 경과 후 판정 — 로그인 전 숨은 메뉴의 '로그아웃' 링크를
            #    오탐해 미로그인 상태로 발급 단계로 넘어가던 결함 방지(base.wait_for_login 과 동일 패턴, 감사 확정).
            if elapsed >= 3:
                logout = await page.evaluate("""
                    () => Array.from(document.querySelectorAll('a,button'))
                        .some(e => (e.textContent||'').includes('로그아웃')
                                   && e.offsetParent !== null
                                   && e.getBoundingClientRect().width > 0)
                """)
                if logout:
                    return True
        except Exception:
            pass

        if elapsed > 0 and elapsed - last_report >= 15:
            try:
                ss = await take_screenshot(page)
                task.update("waiting_login",
                    f"📱 카카오톡 알림 승인 대기 중...\n\n"
                    f"스마트폰에서 카카오톡 → [본인인증 허용] 을 눌러주세요.\n\n"
                    f"⏱ 남은 시간: {timeout - elapsed}초",
                    ss,
                )
                last_report = elapsed
            except Exception:
                pass

        await asyncio.sleep(1)
    return False


# ── Step 7: 발급 버튼 ────────────────────────────────────────────────────────

async def _click_issue(page, context, task) -> bool:
    await asyncio.sleep(2)
    for p in context.pages:
        for sel in ISSUE_SELECTORS:
            try:
                el = p.locator(sel).first
                if await el.count() > 0:
                    await el.scroll_into_view_if_needed()
                    await el.click()
                    await asyncio.sleep(1.5)
                    ss = await take_screenshot(p)
                    task.update("running", "발급 버튼 클릭 완료", ss)
                    return True
            except Exception:
                continue
    # JS 폴백
    for p in context.pages:
        try:
            r = await p.evaluate("""
                () => {
                    const kws = ['발급','발급하기','출력','인쇄'];
                    const el = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],a'))
                        .find(e => kws.some(k => (e.textContent||e.value||'').includes(k)));
                    if (el) { el.click(); return el.textContent||el.value; }
                    return null;
                }
            """)
            if r:
                ss = await take_screenshot(p)
                task.update("running", f"JS 발급 버튼 클릭: {r}", ss)
                return True
        except Exception:
            pass
    return False


async def _auto_confirm_print(context) -> bool:
    """프린트/출력 확인 다이얼로그 자동 클릭.
    evaluate 는 만일의 렌더러 블록(감사 CRITICAL)에 대비해 5초 타임아웃으로 감싼다 —
    NO_PRINT_SCRIPT 로 네이티브 인쇄창은 이미 막았지만 방어적으로 무한 동결을 원천 차단."""
    for p in context.pages:
        for f in p.frames:
            try:
                r = await asyncio.wait_for(f.evaluate("""
                    () => {
                        const kws = ['프린트','출력','발급','인쇄'];
                        const dlgs = document.querySelectorAll(
                            '.confirm,.dialog,.modal,.popup,.layer,[role=dialog],[role=alertdialog]'
                        );
                        for (const dlg of dlgs) {
                            if (!kws.some(k => (dlg.textContent||'').includes(k))) continue;
                            const btn = Array.from(dlg.querySelectorAll('button,a'))
                                .find(b => ['확인','예','OK','출력','인쇄'].includes(b.textContent.trim()));
                            if (btn) { btn.click(); return btn.textContent.trim(); }
                        }
                        // 폴백: 보이는 확인 버튼
                        for (const btn of document.querySelectorAll('button')) {
                            if (btn.textContent.trim() === '확인') {
                                const s = getComputedStyle(btn);
                                if (s.display !== 'none' && s.visibility !== 'hidden')
                                    { btn.click(); return '확인(fb)'; }
                            }
                        }
                        return null;
                    }
                """), timeout=5)
                if r:
                    return True
            except Exception:
                pass
    return False


async def _wait_print(context, task, timeout: int = 90) -> bool:
    print_sels = ["button:has-text('출력')", "button:has-text('인쇄')", "#btnPrint", ".btn-print"]
    for _ in range(timeout):
        check_cancel(task, context)  # 취소·창닫힘 즉시 탈출(멈춤 유령 점유 차단)
        if await _auto_confirm_print(context):
            ss = await take_screenshot(context.pages[-1])
            task.update("running", "✅ 출력 확인 다이얼로그 자동 클릭!", ss)
            await asyncio.sleep(2)
        for p in context.pages:
            for sel in print_sels:
                try:
                    el = p.locator(sel).first
                    # count() 도 만일의 렌더러 블록 대비 타임아웃(감사 CRITICAL 방어)
                    if await asyncio.wait_for(el.count(), timeout=5) > 0:
                        ss = await take_screenshot(p)
                        task.update("running", "출력 버튼 감지!", ss)
                        await el.click()
                        return True
                except Exception:
                    pass
        if len(context.pages) > 1:
            ss = await take_screenshot(context.pages[-1])
            task.update("running", "발급 완료 페이지 감지!", ss)
            return True
        await asyncio.sleep(1)
    return False


# ── 메인 진입점 ───────────────────────────────────────────────────────────────

async def run_nhis_rpa(task, user_info: dict = None) -> None:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치\n실행: pip install playwright && playwright install chromium")
        return

    info     = user_info or {}
    name, birth, prefix, suffix = _normalize(info)
    has_info = bool(name and birth and suffix)

    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw, slow_mo=100)
            ctx_args = make_browser_context_args()
            ctx_args["no_viewport"] = True
            context = await browser.new_context(**ctx_args)
            await context.add_init_script(
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
            )
            # 네이티브 인쇄 다이얼로그가 렌더러를 블록해 이후 evaluate/count 가 무한 동결되던 것 차단(감사 CRITICAL)
            await context.add_init_script(NO_PRINT_SCRIPT)
            page = await context.new_page()

            # ① 접속
            task.update("running", "건강보험공단 접속 중...")
            try:
                await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(NHIS_CERT_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(2)

            # 이미 로그인된 경우
            if CERT_KEYWORD in page.url and LOGIN_KEYWORD not in page.url:
                ss = await take_screenshot(page)
                task.update("running", "이미 로그인 상태 — 발급 버튼 탐색 중...", ss)
            else:
                # ② 초기 팝업 닫기
                await _close_initial_popups(page)
                ss = await take_screenshot(page)
                task.update("running", "로그인 페이지 도달. 간편인증 위젯 오픈 중...", ss)

                if has_info:
                    # ③ 간편인증 위젯 열기
                    opened = await _open_easy_auth_widget(page, task)
                    ss = await take_screenshot(page)
                    _prov = str(info.get("auth_provider", "kakao") or "kakao")
                    from rpa.base import provider_display as _pd
                    if not opened:
                        task.update("waiting_login",
                            "⚠️ 간편인증 위젯 자동 오픈 실패.\n브라우저에서 '간편 인증 로그인 바로가기'를 클릭해주세요.", ss)
                    else:
                        task.update("running", f"간편인증 위젯 열림. {_pd(_prov)} 선택 중...", ss)

                        # ④ 인증수단 클릭(기본 카카오톡)
                        kakao_ok = await _click_kakao(page, task, _prov)
                        ss = await take_screenshot(page)

                        if kakao_ok:
                            task.update("running", f"{_pd(_prov)} 선택 완료. 폼 입력 중...", ss)

                            # ⑤ 폼 입력
                            filled = await _wait_and_fill_form(page, name, birth, prefix, suffix, task)

                            if filled:
                                # ⑥ 인증 요청
                                auth_ok = await _click_auth_btn(page, task)
                                ss = await take_screenshot(page)
                                if auth_ok:
                                    task.update("waiting_login",
                                        "📱 카카오톡 알림이 발송되었습니다!\n\n"
                                        "스마트폰의 카카오톡 알림을 확인하고\n"
                                        "[본인인증 허용] 버튼을 눌러주세요.\n\n"
                                        "✅ 승인하면 자동으로 서류 발급이 진행됩니다.", ss)
                                else:
                                    task.update("waiting_login",
                                        "⚠️ 인증 요청 버튼을 찾지 못했습니다.\n"
                                        "브라우저에서 직접 '인증 요청' 버튼을 클릭해주세요.\n\n"
                                        "📱 카카오톡 알림이 오면 [본인인증 허용]을 눌러주세요.", ss)
                            else:
                                ss = await take_screenshot(page)
                                task.update("waiting_login",
                                    f"⚠️ 폼 자동 입력 실패.\n"
                                    f"브라우저에서 직접 입력해주세요:\n"
                                    f"이름: {name} / 생년월일: {birth} / 전화: {prefix}-{suffix}\n\n"
                                    "입력 후 '인증 요청' → 카카오 알림 승인 → 자동 계속", ss)
                        else:
                            ss = await take_screenshot(page)
                            task.update("waiting_login",
                                "⚠️ 카카오톡 자동 클릭 실패.\n"
                                "브라우저에서 카카오톡을 선택하고 아래 정보를 입력해주세요:\n\n"
                                f"이름: {name} / 생년월일: {birth} / 전화: {prefix}-{suffix}\n\n"
                                "입력 후 '인증 요청' → 카카오 알림 승인", ss)
                else:
                    ss = await take_screenshot(page)
                    task.update("waiting_login",
                        "🔐 브라우저에서 로그인해주세요:\n\n"
                        "1️⃣ '간편 인증 로그인 바로가기' 클릭\n"
                        "2️⃣ 카카오톡 선택\n"
                        "3️⃣ 이름 / 생년월일 / 전화번호 입력\n"
                        "4️⃣ 전체동의 → 인증 요청\n"
                        "5️⃣ 📱 카카오톡 알림 → [본인인증 허용]", ss)

                # ⑦ 로그인 완료 대기
                login_ok = await _wait_login(page, task, timeout=300)
                if not login_ok:
                    ss = await take_screenshot(page)
                    task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
                    await browser.close()
                    return

                ss = await take_screenshot(page)
                task.update("running", "✅ 로그인 완료! 자격득실확인서 페이지로 이동 중...", ss)
                await asyncio.sleep(1)

                if CERT_KEYWORD not in page.url:
                    try:
                        await page.goto(NHIS_CERT_URL, wait_until="domcontentloaded", timeout=20000)
                        await asyncio.sleep(2)
                    except Exception:
                        pass

            # ⑧ 발급 버튼 — 실제로 눌렀는지 반환값을 붙잡는다(무조건 '완료' 오보 방지)
            ss = await take_screenshot(page)
            task.update("running", "발급 버튼 탐색 중...", ss)
            issued = await _click_issue(page, context, task)

            # ⑨ 출력 팝업/완료 화면 대기 — 완료 화면 도달 여부를 성공 판정에 사용
            printed = await _wait_print(context, task, timeout=90)
            completed = printed or len(context.pages) > 1

            try:
                final = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final)
            except Exception:
                ss = await take_screenshot(page)

            _dlpage = context.pages[-1] if len(context.pages) > 1 else page
            # 발급 화면에 도달(또는 버튼 클릭)했을 때만 저장 시도 — 엉뚱한 화면 저장 방지
            saved = ""
            if completed or issued:
                saved = await save_document(_dlpage, "건강보험 자격득실확인서", getattr(task, "user_name", ""))

            doc = "건강보험 자격득실확인서"
            if saved:
                # 파일이 실제로 저장됨 — 명백한 성공
                task.update("done",
                    f"✅ {doc} 발급 완료!\n\n"
                    f"📄 자동 저장됨: {saved}\n"
                    "브라우저는 2분 후 자동 종료됩니다.", ss)
                task.result = {"success": True, "doc_name": doc, "saved_path": saved}
                await cancellable_sleep(120, task, context)
            elif completed:
                # 발급 완료 화면엔 도달했지만 headed 저장이 안 됨(구조적 quirk) — 진짜 발급은 됐으니
                # 성공으로 두되(감사: 저장 실패로 실제 성공을 뒤집지 않음) 수동 저장을 정직히 안내.
                task.update("done",
                    f"✅ {doc} 발급 화면까지 진행했어요.\n\n"
                    "브라우저 화면에서 [출력]/저장(Ctrl+P → PDF)으로 저장해 주세요.\n"
                    "브라우저는 2분 후 자동 종료됩니다.", ss)
                task.result = {"success": True, "doc_name": doc, "saved_path": None, "manual_save": True}
                await cancellable_sleep(120, task, context)
            else:
                # 발급 버튼/완료 화면을 확인하지 못함 — 가짜 '발급 완료!' 대신 정직하게 안내(감사 HIGH :583 해소)
                task.update("error",
                    "발급 화면을 자동으로 확인하지 못했어요.\n\n"
                    "로그인이 끝났는지 확인하고, 브라우저 화면에서 [발급] 버튼을 직접 눌러 저장해 주세요.\n"
                    "필요하면 [다시 시작]을 눌러 주세요.", ss)
                task.result = {"success": False, "doc_name": doc, "saved_path": None}
                await cancellable_sleep(60, task, context)  # headed 창을 잠시 열어둬 수동 완료 가능

            await browser.close()

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파(error 로 오분류 금지)
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            ss = await take_screenshot(page)
        except Exception:
            ss = None
        task.update("error", f"자동화 오류: {str(e)[:300]}\n터미널에서 상세 로그를 확인하세요.", ss)
