"""
정부24 주민등록등본 / 초본 실제 자동 발급 (Playwright RPA)

흐름 (2026 plus.gov.kr 이전 반영):
  ① plus.gov.kr/login 접속 (옛 www.gov.kr/portal/login/memberLogin 은 soft-404)
  ② '간편인증'(button.login-type) 클릭 → simpleCert.html iframe 로드
  ③ iframe 안에서 카카오톡 선택 → 본인인증 폼(이름·생년월일·전화) → 사용자 완료 대기
  ④ 로그인 완료 → 서비스 안내 페이지(www.gov.kr/mw/AA020InfoCappView.do) 이동
  ⑤ '발급하기'(AA040OfferMainFrm) → 신청 폼 처리 → 출력/PDF

메모:
  로그인은 plus.gov.kr로 통합됐고(www.gov.kr/nlogin → plus.gov.kr/login 리다이렉트),
  서비스 안내 페이지(AA020InfoCappView.do)는 여전히 www.gov.kr에서 동작한다.
  간편인증 제공자 선택·정보입력은 페이지가 아니라 iframe(simpleCert.html) 내부에 있다.
"""
import asyncio
import re
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_kakaotalk_in_anyid, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, save_document,
)

# 정부24 로그인 페이지 — 2026년 plus.gov.kr로 이전(옛 www.gov.kr/portal/login/memberLogin 은 soft-404).
WWW_GOV_LOGIN_URL = "https://plus.gov.kr/login"
# 간편인증 위젯이 로드되는 iframe URL 키워드
SIMPLECERT_FRAME_KEYWORD = "simpleCert"

# 서비스 안내 페이지 (로그인 후 접속)
_JUMIN_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_FAMILY_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=97400000004&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
_DISABLED_URL = (
    "https://www.gov.kr/mw/AA020InfoCappView.do"
    "?CappBizCD=14600000273&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"
)
DOC_URLS = {
    "주민등록등본": _JUMIN_URL,
    "주민등록초본": _JUMIN_URL,
    "가족관계증명서": _FAMILY_URL,
    "장애인증명서": _DISABLED_URL,
}


# 발급 신청 폼(로그인 필요) — 서비스 안내(AA020) 없이 바로 발급 폼(AA040)으로 직행.
# 로그인 세션이 살아있으면 여기로 가면 실제 발급 양식이 바로 뜬다(안내 페이지 저장 방지).
def _issue_url(capp_biz_cd: str) -> str:
    return (
        f"https://www.gov.kr/mw/AA040OfferMainFrm.do?capp_biz_cd={capp_biz_cd}"
        "&HighCtgCD=A01010001&FAX_TYPE=N&img=02&selectedSeq=01"
    )


ISSUE_URLS = {
    "주민등록등본": _issue_url("13100000015"),
    "주민등록초본": _issue_url("13100000015"),
    "가족관계증명서": _issue_url("97400000004"),
    "장애인증명서": _issue_url("14600000273"),
}

# plus.gov.kr 간편인증 선택자 (신 UI: button.login-type)
SIMPLE_AUTH_SELECTORS = [
    "button.login-type:has-text('간편인증')",
    "button:has-text('간편인증')",
    # (구) www.gov.kr 로그인 탭 폴백
    "a:has-text('간편인증')",
    "li:has-text('간편인증') a",
    "button:has-text('간편인증')",
    ".tab-btn:has-text('간편인증')",
    ".login-tab:has-text('간편인증')",
    # JavaScript onclick 기반 탭 전환
    "[onclick*='tab'][onclick*='easy']",
    "[onclick*='tab'][onclick*='simple']",
    # data 속성 기반
    "[data-tab='easy']",
    "[data-type='easy']",
]

# 발급/신청 버튼 선택자 (plus.gov.kr 서비스 페이지는 '발급하기' → AA040OfferMainFrm)
APPLY_SELECTORS = [
    "a:has-text('발급하기')",
    "button:has-text('발급하기')",
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('발급신청')",
    "button:has-text('발급신청')",
    "a:has-text('온라인신청')",
    "a:has-text('인터넷발급')",
    "a:has-text('온라인발급')",
    "a.btn_bg01",
    "input[value='신청하기']",
    ".btn-apply",
    "#btnApply",
    "#btn_apply",
]

PRINT_SELECTORS = [
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "a:has-text('출력')",
    "button:has-text('저장')",
    "button:has-text('다운로드')",
    "#btnPrint",
    ".btn-print",
]


async def _get_simplecert_frame(page, timeout_sec: int = 12):
    """간편인증 위젯 iframe(plus.gov.kr/simpleCert.html) 프레임을 반환. 없으면 None.
    plus.gov.kr은 제공자 선택·본인인증 폼을 이 iframe 안에 렌더한다."""
    for _ in range(timeout_sec * 2):
        for fr in page.frames:
            if SIMPLECERT_FRAME_KEYWORD in (fr.url or ""):
                return fr
        await asyncio.sleep(0.5)
    return None


async def _autofill_auth_form(ctx, user_info: dict) -> bool:
    """간편인증 본인인증 폼(iframe oacx 위젯)에 이름·생년월일·휴대폰을 자동 입력하고 전체동의 체크.
    사용자가 정보를 제공한 경우에만 동작하며, 실패해도 조용히 넘어간다(사용자가 직접 입력하면 됨).
    ※ '인증 요청' 클릭·카카오 승인은 본인이 직접(비가역 본인인증 원칙)."""
    if not user_info:
        return False
    name = str(user_info.get("user_name") or user_info.get("name") or "").strip()
    birth = re.sub(r"[^0-9]", "", str(user_info.get("birth_date", "")))
    phone = re.sub(r"[^0-9]", "", str(user_info.get("phone", "")))
    filled = False
    try:
        if name:
            await ctx.fill("#oacx_name", name); filled = True
        if birth:
            await ctx.fill("#oacx_birth", birth); filled = True
        if phone:
            tail = phone[3:] if phone.startswith("010") and len(phone) >= 10 else phone
            for sel in ["#oacx_phone2", "#oku_phone2", "input.phone"]:
                try:
                    if await ctx.locator(sel).count() > 0:
                        await ctx.fill(sel, tail); filled = True; break
                except Exception:
                    continue
        for sel in ["#totalAgree", "input#totalAgree", "label:has-text('전체동의')"]:
            try:
                if await ctx.locator(sel).count() > 0:
                    await ctx.check(sel) if "input" in sel or "#totalAgree" == sel else await ctx.click(sel)
                    break
            except Exception:
                continue
    except Exception:
        pass
    return filled


async def _login_on_www_gov(page, task, user_info: dict = None) -> bool:
    """
    plus.gov.kr/login 에서 간편인증(카카오톡)으로 로그인.
    제공자 선택·정보입력은 iframe(simpleCert.html) 내부에서 처리한다.
    user_info가 있으면 본인인증 폼을 자동 입력(인증요청·폰승인은 본인).
    반환값: 로그인 성공 여부.
    """
    login_page_url = page.url
    ss = await take_screenshot(page)
    task.update("running", "정부24(plus.gov.kr) 로그인 — 간편인증 선택 중...", ss)

    # ① 간편인증 버튼 클릭 (신 UI: button.login-type → 텍스트 폴백)
    await asyncio.sleep(1.5)
    simple_clicked = await click_first_matching(page, SIMPLE_AUTH_SELECTORS)
    if not simple_clicked:
        simple_clicked = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    await asyncio.sleep(2.5)

    # ② 간편인증 위젯 iframe 취득 (없으면 페이지에서 직접 시도하는 폴백)
    frame = await _get_simplecert_frame(page)
    auth_ctx = frame or page
    ss = await take_screenshot(page)
    if frame:
        task.update("running", "간편인증 위젯 로드됨 — 카카오톡 선택 중...", ss)
    else:
        task.update("running", "간편인증 화면 진입 — 카카오톡 선택을 시도합니다...", ss)

    # ③ 카카오톡 선택 (iframe 내부, 카카오뱅크 제외)
    await asyncio.sleep(1)
    kakaotalk_clicked = await click_kakaotalk_in_anyid(auth_ctx)
    await asyncio.sleep(2)
    ss = await take_screenshot(page)

    # ④ 본인인증 정보 입력 폼 감지 및 안내 (iframe 컨텍스트에서 감지)
    form_detected = await detect_auth_form(auth_ctx)

    # 정보가 있으면 이름·생년월일·휴대폰 자동 입력 → 사용자는 '인증 요청' + 폰 승인만
    autofilled = await _autofill_auth_form(auth_ctx, user_info)
    if autofilled:
        await asyncio.sleep(0.5)
        ss = await take_screenshot(page)

    if autofilled:
        task.update(
            "waiting_login",
            "✅ 이름·생년월일·휴대폰을 자동 입력했어요.\n"
            "화면에서 '인증 요청'을 누르면, 📱 카카오톡 알림에서 [인증 허용]만 하시면 됩니다.",
            ss,
        )
    elif kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update(
            "waiting_login",
            "📱 카카오톡 간편인증 화면이 열렸습니다.\n"
            "스마트폰 카카오톡 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 다음 단계가 진행됩니다.",
            ss,
        )
    else:
        task.update(
            "waiting_login",
            "브라우저에서 '간편인증' 탭 → '카카오톡(TALK)' 선택 후\n"
            "본인인증 정보(이름·생년월일·전화번호)를 입력하고 '인증 요청'을 클릭해주세요.\n"
            "📱 카카오톡 알림 허용 후 자동으로 진행됩니다.",
            ss,
        )

    # 로그인 완료 대기 (최대 5분)
    login_ok = await wait_for_login(
        page, task, timeout_sec=480, login_url=login_page_url
    )

    if not login_ok:
        ss = await take_screenshot(page)
        task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.", ss)
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ 정부24 로그인 완료!\n현재 URL: {page.url}", ss)
    return True


async def _handle_apply_popup(context, page, task, doc_name) -> bool:
    """
    신청하기 클릭 후 팝업이 열리면 팝업 페이지를 반환, 아니면 현재 페이지.
    초본 선택 및 목적 선택 처리 포함.
    """
    await asyncio.sleep(2)

    # 팝업이 열렸는지 확인
    target_page = page
    if len(context.pages) > 1:
        target_page = context.pages[-1]
        await target_page.bring_to_front()
        ss = await take_screenshot(target_page)
        task.update("running", "신청 팝업 창 감지 — 양식 작성 중...", ss)

    # 문서 유형별 선택 처리
    if doc_name == "주민등록초본":
        try:
            await target_page.evaluate("""
                () => {
                    const labels = Array.from(document.querySelectorAll('label, span, td'));
                    const label = labels.find(el => el.textContent.trim() === '초본');
                    if (label) {
                        const forAttr = label.getAttribute('for');
                        if (forAttr) {
                            const inp = document.getElementById(forAttr);
                            if (inp) { inp.click(); return; }
                        }
                        label.click();
                        return;
                    }
                    const selects = document.querySelectorAll('select');
                    selects.forEach(sel => {
                        const opt = Array.from(sel.options).find(o => o.text.includes('초본'));
                        if (opt) sel.value = opt.value;
                    });
                }
            """)
            await asyncio.sleep(0.5)
            ss = await take_screenshot(target_page)
            task.update("running", "초본 선택 완료", ss)
        except Exception:
            pass

    # 가족관계증명서 유형 선택 (일반증명서 기본)
    if doc_name == "가족관계증명서":
        try:
            await target_page.evaluate("""
                () => {
                    const labels = Array.from(document.querySelectorAll('label, span, td'));
                    const label = labels.find(el => el.textContent.trim().includes('일반'));
                    if (label) { label.click(); return; }
                    const selects = document.querySelectorAll('select');
                    selects.forEach(sel => {
                        const opt = Array.from(sel.options).find(o => o.text.includes('일반'));
                        if (opt) sel.value = opt.value;
                    });
                }
            """)
            await asyncio.sleep(0.5)
        except Exception:
            pass

    # 발급 목적 기본값 선택
    for sel in ["select[name*='purpose']", "select[name*='issuPurps']", "#issuPurps", "select"]:
        try:
            el = target_page.locator(sel).first
            if await el.count() > 0:
                await el.select_option(index=0)
                break
        except Exception:
            pass

    await asyncio.sleep(0.5)
    return target_page


async def run_gov24_rpa(task, doc_name: str, user_info: dict = None) -> None:
    """정부24에서 주민등록등본 또는 초본 발급. user_info(이름·생년월일·휴대폰) 있으면 본인인증 폼 자동입력."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    doc_url = DOC_URLS.get(doc_name)
    if not doc_url:
        task.update("error", f"지원하지 않는 문서: {doc_name}")
        return

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(**get_launch_options())
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page = await context.new_page()

            # ① www.gov.kr 로그인 페이지 직접 접속 (세션 수립용)
            task.update("running", f"📄 {doc_name} 발급 준비 — 정부24 로그인/간편인증으로 이동 중...")
            try:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(WWW_GOV_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            ss = await take_screenshot(page)
            task.update("running", f"로그인 페이지 로드 완료\n현재 URL: {page.url}", ss)

            # ② 간편인증(카카오톡) 로그인 수행
            login_ok = await _login_on_www_gov(page, task, user_info)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 발급 신청 폼(AA040)으로 직행 — 안내 페이지(AA020) 저장 방지, 실제 발급으로.
            issue_url = ISSUE_URLS.get(doc_name, doc_url)
            task.update("running", f"{doc_name} 발급 폼으로 이동 중...")
            await page.goto(issue_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"{doc_name} 발급 폼 접속\n현재 URL: {page.url}", ss)

            # 회원/비회원 선택 모달이 뜨면 '회원 신청하기'
            if await click_first_matching(page, [
                "a:has-text('회원 신청하기')", "button:has-text('회원 신청하기')", "a:has-text('회원신청')",
            ]):
                await asyncio.sleep(2)
                ss = await take_screenshot(page)
                task.update("running", "회원 신청 진입 — 발급 양식 처리 중...", ss)

            # 혹시 로그인 페이지로 다시 튕긴 경우 재처리
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                task.update("running", "서비스 접근 시 재로그인 요구 — 다시 로그인 중...", ss)
                login_ok = await _login_on_www_gov(page, task, user_info)
                if not login_ok:
                    await browser.close()
                    return
                await asyncio.sleep(2)
                # 재접속
                if "AA020InfoCappView" not in page.url:
                    await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(3)
                    ss = await take_screenshot(page)
                    task.update("running", f"{doc_name} 서비스 페이지 재접속 완료", ss)

            # ④ "온라인발급" / "인터넷발급" 탭 선택
            await asyncio.sleep(1)
            online_selectors = [
                "a:has-text('온라인발급')", "a:has-text('온라인 발급')",
                "a:has-text('인터넷발급')", "a:has-text('전자문서')",
                "button:has-text('온라인발급')",
            ]
            if await click_first_matching(page, online_selectors):
                await asyncio.sleep(1.5)
                ss = await take_screenshot(page)
                task.update("running", "온라인 발급 탭 선택", ss)

            # ⑤ 신청하기 버튼 클릭
            await asyncio.sleep(1)
            ss = await take_screenshot(page)
            task.update("running", "신청하기 버튼 탐색 중...", ss)

            clicked = await click_first_matching(page, APPLY_SELECTORS)
            await asyncio.sleep(2)
            # 발급하기 후 회원/비회원 모달 → 회원 신청하기
            if await click_first_matching(page, [
                "a:has-text('회원 신청하기')", "button:has-text('회원 신청하기')",
            ]):
                clicked = True
                await asyncio.sleep(2)

            if clicked:
                # 신청 클릭 후 로그인 페이지로 튕겼으면 다시 로그인
                if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                    task.update("running", "신청 클릭 후 로그인 요구 — 로그인 처리 중...")
                    login_ok = await _login_on_www_gov(page, task, user_info)
                    if not login_ok:
                        await browser.close()
                        return
                    await asyncio.sleep(2)
                    # 로그인 후 returnUrl로 자동 복귀되지 않으면 재시도
                    if "AA020InfoCappView" not in page.url:
                        await page.goto(doc_url, wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(3)
                        await click_first_matching(page, online_selectors)
                        await asyncio.sleep(1)
                        await click_first_matching(page, APPLY_SELECTORS)
                        await asyncio.sleep(2)

                ss = await take_screenshot(page)
                task.update("running", "신청하기 클릭 완료 — 양식 처리 중...", ss)

                # 팝업 처리 및 초본/목적 선택
                target_page = await _handle_apply_popup(context, page, task, doc_name)

                # 최종 제출 버튼 클릭
                submit_selectors = [
                    "button:has-text('발급')",
                    "button:has-text('확인')",
                    "input[type='submit']",
                    "button[type='submit']",
                    "a:has-text('발급')",
                ]
                if await click_first_matching(target_page, submit_selectors):
                    await asyncio.sleep(2)
                    ss = await take_screenshot(target_page)
                    task.update("running", "발급 신청 완료 — 결과 대기 중...", ss)
            else:
                ss = await take_screenshot(page)
                task.update(
                    "running",
                    "신청하기 버튼을 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 '신청하기' 또는 '온라인발급' 버튼을 직접 클릭해주세요.",
                    ss,
                )

            # ⑥ 인쇄/출력 창 대기 (최대 120초)
            printed = False
            for _ in range(120):
                try:
                    # 현재 페이지와 팝업 모두 확인
                    for check_page in context.pages:
                        for sel in PRINT_SELECTORS:
                            try:
                                el = check_page.locator(sel).first
                                if await el.count() > 0:
                                    await check_page.bring_to_front()
                                    ss = await take_screenshot(check_page)
                                    task.update("running", "출력 버튼 감지! 클릭합니다.", ss)
                                    await el.click()
                                    printed = True
                                    break
                            except Exception:
                                pass
                        if printed:
                            break
                    if printed:
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            # 최종 스크린샷
            try:
                final_page = context.pages[-1] if len(context.pages) > 1 else page
                ss = await take_screenshot(final_page)
            except Exception:
                ss = await take_screenshot(page)

            # 실제 발급 결과에 도달했는지 확인 — 안내 페이지(AA020)/로그인 페이지면 완료로 오판하지 않는다.
            final_url = final_page.url
            reached_doc = ("AA020InfoCappView" not in final_url
                           and not any(k in final_url for k in LOGIN_PAGE_URL_KEYWORDS))
            saved = await save_document(final_page, doc_name) if reached_doc else None

            if reached_doc:
                task.update(
                    "done",
                    f"✅ {doc_name} 발급 완료!\n"
                    + (f"📄 자동 저장됨: {saved}\n" if saved else "브라우저에서 Ctrl+P로 저장하세요.\n")
                    + "브라우저는 60초 후 자동 종료됩니다.",
                    ss,
                )
                task.result = {"success": True, "doc_name": doc_name, "saved_path": saved}
            else:
                task.update(
                    "done",
                    f"⚠️ {doc_name} 발급 화면까지 진행했지만 자동 완료를 확정하지 못했어요.\n"
                    "브라우저에서 남은 발급/출력 단계를 직접 마무리해주세요(로그인/양식 확인 필요).\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    ss,
                )
                task.result = {"success": False, "doc_name": doc_name, "note": "발급 결과 페이지 미도달", "final_url": final_url}

            await asyncio.sleep(60)
            await browser.close()

    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
