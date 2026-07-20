"""
고용24 고용보험 피보험자격 이력내역서 실제 자동 발급 (Playwright RPA)
사이트: https://www.work24.go.kr
- 간편인증 로그인 → 개인서비스 → 피보험자격이력내역서 발급
"""
import asyncio
import re
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, make_browser_context_args,
    click_provider_in_anyid, provider_display, detect_auth_form, AUTH_FORM_USER_GUIDE,
    get_launch_options, launch_browser, wait_any_visible, AUTH_FORM_SELECTORS,
    check_cancel, cancellable_sleep, CancelledByUser, NO_PRINT_SCRIPT,
)
from rpa.auth_autofill import autofill_easy_auth, request_easy_auth

WORK24_MAIN = "https://www.work24.go.kr/cm/main.do"
# 로그인 페이지 (간편인증 포함)
WORK24_LOGIN_URL = "https://www.work24.go.kr/cm/z/b/0210/openLginPageForAnyIdIntro.do"

# 피보험자격이력내역서 메뉴 선택자 (로그인 후 GNB/사이드 메뉴에 표시)
DOC_MENU_SELECTORS = [
    "a:has-text('피보험자격이력')",
    "a:has-text('피보험 자격이력')",
    "a:has-text('이력내역서')",
    "a:has-text('피보험자격 이력')",
    "span:has-text('피보험자격이력')",
    "li:has-text('피보험자격이력') a",
    "li:has-text('이력내역서') a",
]

# 조회 버튼 선택자
SEARCH_SELECTORS = [
    "button:has-text('조회')",
    "input[value='조회']",
    "a:has-text('조회')",
    "#btnSearch",
    ".btn-search",
    "button:has-text('확인')",
]

# 발급/출력 버튼 선택자
ISSUE_SELECTORS = [
    "button:has-text('발급')",
    "button:has-text('출력')",
    "button:has-text('인쇄')",
    "a:has-text('발급')",
    "input[value='발급']",
    "#btnIssue",
    "#btnPrint",
    ".btn-issue",
    ".btn-print",
]

# 간편인증 탭 선택자 (work24 로그인 페이지)
SIMPLE_AUTH_SELECTORS = [
    "a.link-easy-anyId",
    "a[class*='easy-anyId']",
    "a[onclick*='anyidAdaptor']",
    ".btn_quick_login",
    "a:has-text('간편인증')",
]


async def _navigate_to_doc_menu(page, task) -> bool:
    """로그인 후 피보험자격이력내역서 메뉴 탐색"""
    # 메인 메뉴에서 직접 클릭 시도
    clicked = await click_first_matching(page, DOC_MENU_SELECTORS)
    if clicked:
        return True

    # JavaScript로 텍스트 기반 탐색
    try:
        found = await page.evaluate("""
            () => {
                const keywords = ['피보험자격이력', '이력내역서', '피보험자격 이력'];
                for (const kw of keywords) {
                    const els = Array.from(document.querySelectorAll('a, button, span, li'));
                    const el = els.find(e => e.textContent && e.textContent.includes(kw));
                    if (el) {
                        const link = el.tagName === 'A' ? el : el.closest('a') || el.querySelector('a');
                        if (link) { link.click(); return true; }
                        el.click();
                        return true;
                    }
                }
                return false;
            }
        """)
        if found:
            await asyncio.sleep(2)
            return True
    except Exception:
        pass

    # work24 fn_goPageUrl 함수로 직접 메뉴 호출 (개인서비스 → 고용보험 → 피보험자격)
    try:
        await page.evaluate("""
            () => {
                // work24 개인 → 고용보험 개인서비스 이동
                if (typeof fn_goPageUrl === 'function') {
                    // 개인서비스 마이페이지 이동
                    fn_goPageUrl('/cm', 'EBG020000001', '/z/a/0100/myPageMainPost.do', 'EBM01', 'N', '');
                }
            }
        """)
        await asyncio.sleep(2)
        # 이후 텍스트 기반으로 재탐색
        return await click_first_matching(page, DOC_MENU_SELECTORS)
    except Exception:
        pass

    return False


async def run_work24_rpa(task, user_info: dict = None) -> None:
    """고용24에서 고용보험 피보험자격 이력내역서 발급. user_info.auth_provider로 인증수단 선택."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw)
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            await context.add_init_script(NO_PRINT_SCRIPT)  # 네이티브 인쇄창 렌더러 블록 방지(감사 CRITICAL)
            page = await context.new_page()

            # ① 고용24 메인 접속
            task.update("running", "고용24(work24) 접속 중...")
            await page.goto(WORK24_MAIN, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", "고용24 메인 페이지 접속 완료", ss)

            # ② 로그인 페이지 이동
            login_selectors = [
                "a:has-text('로그인')",
                "button:has-text('로그인')",
                ".btn_quick_login",
                "a[onclick*='openLginPage']",
                "a[onclick*='login']",
            ]
            clicked = await click_first_matching(page, login_selectors)
            if not clicked:
                await page.goto(WORK24_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
            ss = await take_screenshot(page)
            task.update("running", f"로그인 페이지 이동\n현재 URL: {page.url}", ss)

            # ③ 간편인증 클릭 → 인증수단 선택
            provider = str((user_info or {}).get("auth_provider", "kakao") or "kakao")
            pv = provider_display(provider)
            await asyncio.sleep(1)

            # 간편인증 링크 클릭 (class: link-easy-anyId — Work24 확인 완료)
            easy_auth_clicked = await click_first_matching(page, [
                "a.link-easy-anyId",
                "a[class*='easy-anyId']",
                "a:has-text('간편인증')",
            ])
            if easy_auth_clicked:
                # anyid 모달 로드 — 제공자 버튼이 뜰 때까지 짧게 폴링(고정 3초 → 평균 단축)
                for _ in range(10):
                    await asyncio.sleep(0.4)
                    try:
                        if await page.locator("li:has-text('카카오톡'), img[alt*='카카오'], [class*='anyid']").first.count() > 0:
                            break
                    except Exception:
                        pass

            # anyid 모달 내 인증수단 클릭 (뱅크/스토리 제외 — 공통 헬퍼 사용)
            kakao_clicked = await click_provider_in_anyid(page, provider)

            await asyncio.sleep(1)

            # 🧠 본인인증 폼 자동입력(2026-07-20 신설) — 4개 사이트 중 유일하게 수동이던 곳.
            #    같은 anyid 위젯이라 공용 오토필(고정 ID 1순위 + ai_fill 의미 인식 폴백, 키 불필요·
            #    프레임 순회) 재사용. '인증 요청'은 gov24와 동일 게이트(제공자 클릭 trusted +
            #    생년월일 존재)에서만 자동 — 어르신은 폰에서 [인증 허용]만 누르면 된다(HITL 불변).
            autofilled = False
            requested = False
            _uv = user_info or {}
            if _uv.get("user_name") or _uv.get("name"):
                await wait_any_visible(page, AUTH_FORM_SELECTORS, 8)  # 폼 렌더 대기(조기 탈출형)
                _af = await autofill_easy_auth(page, _uv)
                autofilled = bool(_af["name"] and _af["birth"] and _af["phone"])
                if autofilled and kakao_clicked == "trusted" and re.sub(r"[^0-9]", "", str(_uv.get("birth_date") or "")):
                    requested = await request_easy_auth(page)

            ss = await take_screenshot(page)

            # 자동입력 결과에 따라 안내를 가른다 — 부분 성공은 '완료'로 과장하지 않는다(3키 전부일 때만)
            if autofilled and requested:
                task.update(
                    "waiting_login",
                    "✅ 정보 자동입력 + '인증 요청'까지 완료했어요.\n"
                    f"📱 휴대폰 {pv} 알림에서 [인증 허용]만 누르시면 됩니다.",
                    ss,
                )
            elif autofilled:
                task.update(
                    "waiting_login",
                    "✅ 이름·생년월일·휴대폰을 자동 입력했어요.\n"
                    f"화면에서 '인증 요청'을 누른 뒤, 📱 {pv} 알림에서 [인증 허용]을 눌러 주세요.",
                    ss,
                )
            elif await detect_auth_form(page):
                task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
            elif kakao_clicked or easy_auth_clicked:
                task.update(
                    "waiting_login",
                    f"📱 {pv} 간편인증 화면이 열렸습니다.\n"
                    f"스마트폰 {pv} 알림에서 [인증 허용]을 눌러주세요.\n"
                    "인증 완료 후 자동으로 다음 단계가 진행됩니다.",
                    ss,
                )
            else:
                task.update(
                    "waiting_login",
                    "열린 브라우저에서 카카오 간편인증으로 로그인해주세요.\n"
                    "📱 로그인 완료 후 자동으로 진행됩니다.",
                    ss,
                )

            # ④ 로그인 완료 대기
            login_ok = await wait_for_login(
                page, task, timeout_sec=300, login_url=WORK24_LOGIN_URL
            )
            if not login_ok:
                ss = await take_screenshot(page)
                # 🔬 로그인 미감지 실화면 구조를 남긴다 — 간편인증은 됐는데 감지만 놓친 경우를 실측 구분해
                #    wait_for_login 을 보정. 개발 환경에서 못 보는 그 화면을 이 파일로.
                from rpa import diagnostics as _dg
                _saved = await _dg.dump(page, "고용보험이력-로그인미감지",
                                        tried=["wait_for_login: URL·로그아웃 링크"], note="5분 내 로그인 미감지")
                task.update("error", f"로그인 대기 시간 초과 (5분). 다시 시도해주세요.\n{_saved}".rstrip(), ss)
                await browser.close()
                return

            ss = await take_screenshot(page)
            task.update("running", "로그인 완료! 피보험자격이력내역서 메뉴를 찾는 중...", ss)
            await asyncio.sleep(2)

            # ⑤ 피보험자격이력내역서 메뉴 탐색
            doc_found = await _navigate_to_doc_menu(page, task)
            ss = await take_screenshot(page)

            if doc_found:
                task.update("running", "피보험자격이력내역서 메뉴 선택 완료", ss)
            else:
                task.update(
                    "running",
                    "메뉴를 자동으로 찾지 못했습니다.\n"
                    "브라우저에서 [개인서비스 → 고용보험 → 피보험자격이력] 메뉴를 클릭해주세요.\n"
                    "완료 후 자동으로 감지합니다.",
                    ss,
                )
                # 사용자가 수동 탐색할 시간 대기 — 고정 30초는 [중단]을 그만큼 지연(감사 H3와 동일 패턴)하므로 1초 틱으로
                for _ in range(30):
                    check_cancel(task, context)
                    await asyncio.sleep(1)
                ss = await take_screenshot(page)
                task.update("running", "현재 화면 확인", ss)

            await asyncio.sleep(2)

            # ⑥ 조회 버튼 클릭
            clicked = await click_first_matching(page, SEARCH_SELECTORS)
            ss = await take_screenshot(page)
            if clicked:
                task.update("running", "조회 버튼 클릭 — 이력 조회 중...", ss)
                await asyncio.sleep(3)
            else:
                task.update("running", "화면을 확인하는 중...", ss)

            # ⑦ 발급/출력 버튼 대기 (최대 90초) — '발급 버튼 클릭이 실제 발급 결과로 이어졌을 때만' 성공.
            #   ⚠️ a:has-text('발급') 같은 넓은 셀렉터가 메뉴/네비 링크를 눌러 success 로 오보되던 결함(감사 :252):
            #      클릭 후 팝업/완료 신호를 확인하기 전에는 issue_reached 를 잠그지 않고, 결과 없던 셀렉터는 재클릭 회피.
            issue_reached = False
            clicked_any = False
            spent_sels: set = set()
            for _w24 in range(90):
                check_cancel(task, context)  # [중단]·창닫힘 즉시 탈출
                # 침묵 90초 방지 — 30초마다 진행 화면과 함께 살아있음 갱신(멈춤 오인 방지)
                if _w24 and _w24 % 30 == 0:
                    try:
                        task.update("running", f"발급 화면을 기다리는 중… ({_w24}초) 화면의 안내(본인인증 등)를 확인해 주세요.", await take_screenshot(page))
                    except Exception:
                        pass
                try:
                    # 결과 팝업이 이미 떠 있으면 그것이 가장 확실한 발급 신호
                    if len(context.pages) > 1:
                        popup = context.pages[-1]
                        await popup.bring_to_front()
                        ss = await take_screenshot(popup)
                        task.update("running", "발급 완료 팝업 감지!", ss)
                        issue_reached = True
                        break
                    for sel in ISSUE_SELECTORS:
                        if sel in spent_sels:
                            continue  # 눌렀는데 결과가 없던 셀렉터(=메뉴 링크 추정)는 다시 누르지 않는다
                        el = page.locator(sel).first
                        # count() 도 만일의 렌더러 블록 대비 타임아웃(감사 CRITICAL 방어)
                        if await asyncio.wait_for(el.count(), timeout=5) > 0:
                            ss = await take_screenshot(page)
                            task.update("running", "발급/출력 버튼 후보 클릭 — 결과 확인 중…", ss)
                            await el.click()
                            clicked_any = True
                            spent_sels.add(sel)
                            await asyncio.sleep(2)
                            # 클릭이 실제 발급 결과로 이어졌는지 검증 — 팝업 개창 또는 완료 텍스트가 있어야 성공 확정
                            if len(context.pages) > 1:
                                issue_reached = True
                                break
                            try:
                                body = await asyncio.wait_for(page.inner_text("body"), timeout=5)
                            except Exception:
                                body = ""
                            if any(k in body for k in ("발급완료", "발급 완료", "처리완료", "정상적으로 발급")):
                                issue_reached = True
                                break
                            # 결과 신호 없음 → 이 셀렉터는 발급 버튼이 아니었을 가능성 → 계속 탐색
                    if issue_reached:
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)

            ss = await take_screenshot(page)
            if issue_reached:
                # ⚠️ 정직성(감사 확정): 실제 발급 결과(팝업/완료 텍스트)를 확인했을 때만 '완료'로 보고.
                task.update(
                    "done",
                    "✅ 고용보험 피보험자격 이력내역서 발급 절차 완료!\n"
                    "열린 브라우저에서 Ctrl+P(⌘+P)로 PDF 저장 또는 인쇄 가능합니다.\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    ss,
                )
                task.result = {"success": True, "doc_name": "고용보험 피보험자격 이력내역서"}
            elif clicked_any:
                # 발급 후보를 눌렀지만 발급 결과(팝업/완료)를 확인하지 못함 — 가짜 '완료' 대신 정직하게 안내(감사 :252)
                task.update(
                    "done",
                    "📄 고용보험 이력내역서 발급 화면까지 진행했어요.\n"
                    "화면에서 [발급]/[출력] 버튼을 눌러 조회 결과를 확인하고 Ctrl+P(⌘+P)로 저장해 주세요.\n"
                    "브라우저는 60초 후 자동 종료됩니다.",
                    ss,
                )
                task.result = {"success": False, "doc_name": "고용보험 피보험자격 이력내역서", "manual_save": True}
            else:
                # 🔬 발급 버튼을 못 찾은 그 화면의 구조를 PII 없이 남긴다 — 개발 환경에서 work24 실화면을
                #    못 보는 제약을, 사용자의 [진단 복사] 한 번으로 메워 메뉴·조회·발급 셀렉터를 실측 보정.
                from rpa import diagnostics as _dg
                _saved = await _dg.dump(page, "고용보험이력-발급버튼미도달",
                                        tried=["DOC_MENU_SELECTORS", "SEARCH_SELECTORS", "ISSUE_SELECTORS"],
                                        note="로그인 후 발급/출력 버튼 미도달")
                task.update(
                    "done",
                    "⚠️ 고용보험 이력내역서 '발급 버튼까지 도달하지 못했어요'.\n"
                    "로그인·조회가 됐는지 화면에서 확인하고, 발급/출력 버튼을 직접 눌러 저장해 주세요.\n"
                    f"브라우저는 60초 후 자동 종료됩니다.\n{_saved}".rstrip(),
                    ss,
                )
                task.result = {"success": False, "doc_name": "고용보험 피보험자격 이력내역서"}

            await cancellable_sleep(60, task, context)  # 중단 가능한 유예(창 닫으면 즉시 반납)
            await browser.close()

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            ss = await take_screenshot(page)
        except Exception:
            ss = None
        # 🔬 예기치 못한 실패 — 그 순간의 실화면 구조를 PII 없이 자동 저장(page가 아직 없거나 닫혔으면 생략).
        _saved = ""
        try:
            _pg = locals().get("page")
            if _pg is not None:
                from rpa import diagnostics as _dg
                _saved = await _dg.dump(_pg, "고용보험이력-예외", tried=["work24 flow"], note=str(e)[:120])
        except Exception:
            pass
        task.update("error", f"자동화 오류: {str(e)[:300]}\n{_saved}".rstrip(), ss)
