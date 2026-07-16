"""
복지로 복지 서비스 실제 신청 RPA (Playwright)

흐름:
  ① 복지로 로그인 (카카오톡 간편인증)
  ② 대상 서비스 검색 또는 직접 URL 이동
  ③ 신청하기 버튼 클릭
  ④ 신청 양식 자동 작성
  ⑤ 제출 전 사용자 최종 확인 대기

지원 서비스:
  - 기초연금
  - 아동수당
  - 부모급여
  - 청년 내일저축계좌
"""
import asyncio
import os
from rpa.base import (
    take_screenshot, wait_for_login,
    click_first_matching, click_by_text, make_browser_context_args,
    click_provider_in_anyid, provider_display, detect_auth_form, AUTH_FORM_USER_GUIDE,
    LOGIN_PAGE_URL_KEYWORDS, get_launch_options, launch_browser,
    click_eform_button, get_frame_by_url,
    check_cancel, CancelledByUser, NO_PRINT_SCRIPT,
)

# 복지로 로그인 — 2026 개편으로 옛 moveTWAT52012M.do 는 빈 셸(깨짐).
# 신규 loginView.do 는 tx 토큰을 자동 발급하므로 tx 없이 직접 접근해도 로그인 화면이 뜬다.
# 복지로는 Clipsoft eForm SPA라 로그인/간편인증이 .cl-button 컴포넌트이고,
# 간편인증 위젯은 외부 iframe(4user.yeskey.or.kr/fincert)로 로드된다.
BOKJIRO_LOGIN_URL = "https://www.bokjiro.go.kr/ssis-tbu/loginView.do"
FINCERT_FRAME_KEYWORD = "fincert"
BOKJIRO_SEARCH_URL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do"

# 서비스별 신청 URL (복지로 직접 링크)
# wlfareInfoId는 라이브 복지로 실측 검증(페이지 wlfareInfoNm 대조, 2026-07). 구 ID들은 타 서비스로 재배정됨.
SERVICE_APPLY_URLS = {
    "기초연금": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001164",
    "아동수당": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001171",
    "부모급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004657",
    "청년 내일저축계좌": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000060",
    "첫만남이용권": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004656",
    "기초생활 생계급여": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001132",
    # 데모 핵심 서비스 — 온라인 신청 확실, 필요서류(등본·가족관계·소득금액증명) 대부분 자동발급 가능.
    #   프론트 quickApply.KNOWN_APPLY_URLS(WLF00004661)와 동일. 표기변형 2종 모두 고정(프로필 apply_url 의존 제거).
    "청년월세지원": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004661",
    "청년 월세 한시 특별지원": "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004661",
}

APPLY_BUTTON_SELECTORS = [
    "a:has-text('신청하기')",
    "button:has-text('신청하기')",
    "a:has-text('온라인신청')",
    "a:has-text('모바일신청')",
    ".btn-apply", "#btnApply",
    "input[value='신청하기']",
    # 복지로 신청 화면은 eForm(clipsoft) 위젯 — 표준 a/button 이 아니라 .cl-button/.cl-text 라
    #   위 셀렉터로는 안 잡혀 '클릭 실패'인데도 양식 열림으로 오보되던 결함(감사 :251) 보강.
    ".cl-button:has-text('신청')",
    "[class*='cl-button']:has-text('신청')",
    "span.cl-text:has-text('신청하기')",
    "div[role='button']:has-text('신청하기')",
]

# ⚠️ 의도적 미사용 — 최종 제출은 비가역·법적 행위라 에이전트가 누르지 않는다(본인 몫, human-in-the-loop).
#    셀렉터는 향후 '제출 버튼 위치 하이라이트' 안내용으로만 보존.
SUBMIT_BUTTON_SELECTORS = [
    "button:has-text('신청')",
    "button:has-text('제출')",
    "input[type='submit']",
    "button[type='submit']",
    "a:has-text('신청 완료')",
]


async def _login_bokjiro(page, task, provider: str = "kakao") -> bool:
    """복지로 로그인 (eForm 간편인증 → yeskey fincert → 카카오톡).

    복지로는 Clipsoft eForm SPA라 간편인증 버튼이 .cl-button 컴포넌트이고, 인증 위젯은
    외부 iframe(fincert)로 로드된다. 제공자(카카오) 선택·본인인증 정보 입력·카카오 승인은
    사용자가 직접 수행한다(비가역 본인인증 원칙). RPA는 위젯까지 안정적으로 도달시킨다.
    """
    login_url = page.url
    pv = provider_display(provider)
    ss = await take_screenshot(page)
    task.update("running", "복지로 로그인 페이지 — 간편인증 선택 중...", ss)

    await asyncio.sleep(1)

    # 간편인증: eForm 컴포넌트(cl-button) 우선 → 표준 셀렉터/텍스트 폴백
    clicked_simple = await click_eform_button(page, "간편인증")
    if not clicked_simple:
        clicked_simple = await click_first_matching(page, [
            "button:has-text('간편인증')", "a:has-text('간편인증')", "li:has-text('간편인증')",
        ])
    if not clicked_simple:
        clicked_simple = await click_by_text(page, ["간편인증", "간편 인증", "간편로그인", "간편 로그인"])
    # fincert iframe 로드는 아래 get_frame_by_url 이 폴링으로 대기 — 고정 3초는 잉여라 제거(버벅임)
    await asyncio.sleep(0.5)

    # 간편인증 위젯은 메인 페이지 오버레이 또는 fincert iframe 중 하나에 렌더된다 → 양쪽에서 시도
    frame = await get_frame_by_url(page, FINCERT_FRAME_KEYWORD, timeout_sec=8)
    contexts = [page] + ([frame] if frame else [])
    ss = await take_screenshot(page)
    task.update("running", f"간편인증 위젯 로드됨 — '{pv}' 선택 중...", ss)

    # 인증수단 선택(뱅크류 오클릭 제외). 위젯이 있는 컨텍스트를 찾아 클릭.
    kakaotalk_clicked = False
    for ctx_ in contexts:
        if await click_provider_in_anyid(ctx_, provider):
            kakaotalk_clicked = True
            break
    await asyncio.sleep(1)
    ss = await take_screenshot(page)

    form_detected = any([await detect_auth_form(ctx_) for ctx_ in contexts])
    if kakaotalk_clicked and form_detected:
        task.update("waiting_login", AUTH_FORM_USER_GUIDE, ss)
    elif kakaotalk_clicked:
        task.update("waiting_login",
            f"📱 {pv} 간편인증 화면이 열렸습니다.\n"
            f"스마트폰 {pv} 알림에서 [인증 허용]을 눌러주세요.\n"
            "인증 완료 후 자동으로 진행됩니다.", ss)
    else:
        task.update("waiting_login",
            f"브라우저에서 '간편인증' → '{pv}' 선택 후\n"
            f"본인인증을 완료해주세요. 📱 {pv} 알림 허용 후 자동 진행됩니다.", ss)

    login_ok = await wait_for_login(page, task, timeout_sec=300, login_url=login_url)
    if not login_ok:
        task.update("error", "로그인 대기 시간 초과 (5분). 다시 시도해주세요.")
        return False

    ss = await take_screenshot(page)
    task.update("running", f"✅ 복지로 로그인 완료!\n현재: {page.url}", ss)
    return True


async def _auto_attach(target_page, issued, applicant_name: str = "") -> list:
    """파일 첨부칸의 주변 문맥(가장 가까운 행/라벨 텍스트)과 발급 서류명을 대조해 '확신 매칭'만 자동 첨부.

    - 첨부칸 문맥에 서류명이 그대로 등장할 때만 그 칸에 set_input_files (오첨부 방지)
    - 첨부칸 1개 + 발급 서류 1종이면 모호성이 없으므로 문맥 없이도 첨부
    - 실패는 조용히 건너뛰고(안내 폴백), 무엇을 어디에 붙였는지 목록으로 반환

    저장 파일명이 '{서류명}_{신청인이름}_{날짜}'라 표시명에 이름이 붙는다 →
    폼 라벨('임대차계약서')엔 이름이 없으므로, 신청인 이름 접미를 떼고 순수 서류명으로 대조한다
    (안 떼면 '임대차계약서_홍길동' ∉ '임대차계약서'라 다건 자동첨부가 전부 실패).
    """
    attached: list = []
    try:
        inputs = target_page.locator("input[type='file']")
        n = await inputs.count()
    except Exception:
        return attached
    used_docs: set = set()
    who = (applicant_name or "").replace(" ", "")
    for i in range(n):
        el = inputs.nth(i)
        try:
            ctx_text = await el.evaluate(
                "e => ((e.closest('tr,li,dl,.row,.form-group') || e.parentElement)?.innerText || '').slice(0, 300)"
            )
        except Exception:
            ctx_text = ""
        compact = (ctx_text or "").replace(" ", "")
        for doc_name, path in issued:
            raw = str(doc_name).replace(" ", "")
            # 표시명 끝의 '_신청인이름'을 떼어 순수 서류명으로 대조(폼 라벨엔 이름이 없음)
            key = raw[: -(len(who) + 1)] if (who and raw.endswith("_" + who)) else raw
            if key and key in compact and doc_name not in used_docs:
                try:
                    await el.set_input_files(path)
                    used_docs.add(doc_name)
                    label = (ctx_text or "").strip().splitlines()[0][:30] if ctx_text else f"{i + 1}번째 칸"
                    attached.append(f"{doc_name} → '{label}'")
                except Exception:
                    pass
                break
    if not attached and n == 1 and len(issued) == 1:
        try:
            await inputs.first.set_input_files(issued[0][1])
            attached.append(f"{issued[0][0]} → 첨부칸")
        except Exception:
            pass
    return attached


def _valid_bokjiro_url(url: str) -> bool:
    """신청 URL은 반드시 복지로(www.bokjiro.go.kr) 것만 — 임의 URL 자동이동 방지(보안)."""
    try:
        from urllib.parse import urlparse
        u = urlparse(str(url or ""))
        return u.scheme == "https" and u.hostname in ("www.bokjiro.go.kr", "bokjiro.go.kr")
    except Exception:
        return False


def resolve_apply_url(service_name: str, profile: dict) -> str:
    """신청 URL 결정 — ① 알려진 6종은 실측검증 하드코딩 URL 우선(딥링크가 서비스와 불일치하거나
    journey에서 여러 신청에 같은 프로필 apply_url이 잘못 재사용되는 것 방지) ② 그 밖은 프로필의
    복지로 딥링크(정책 wlfareInfoId, 호스트 검증) ③ 없으면 검색 페이지."""
    if service_name in SERVICE_APPLY_URLS:
        return SERVICE_APPLY_URLS[service_name]
    cand = (profile or {}).get("apply_url") or (profile or {}).get("applyUrl")
    if cand and _valid_bokjiro_url(cand):
        return str(cand)
    return BOKJIRO_SEARCH_URL


async def run_apply_rpa(task, service_name: str, profile: dict) -> None:
    """복지로에서 복지 서비스 신청 자동화. profile.apply_url(복지로 딥링크)이 있으면 임의 정책도 신청(일반화)."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        task.update("error", "playwright 미설치: pip install playwright && playwright install chromium")
        return

    service_url = resolve_apply_url(service_name, profile)
    provider = str((profile or {}).get("auth_provider", "kakao") or "kakao")

    try:
        async with async_playwright() as pw:
            browser = await launch_browser(pw)
            context = await browser.new_context(**make_browser_context_args())
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            await context.add_init_script(NO_PRINT_SCRIPT)  # 네이티브 인쇄창 렌더러 블록 방지(감사 CRITICAL)
            page = await context.new_page()

            # ① 복지로 로그인 페이지
            task.update("running", "복지로 로그인 페이지 접속 중...")
            try:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                await page.goto(BOKJIRO_LOGIN_URL, wait_until="load", timeout=40000)
            await asyncio.sleep(3)

            # ② 로그인
            login_ok = await _login_bokjiro(page, task, provider)
            if not login_ok:
                await browser.close()
                return

            await asyncio.sleep(2)

            # ③ 서비스 페이지 이동
            task.update("running", f"'{service_name}' 서비스 페이지로 이동 중...")
            await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            ss = await take_screenshot(page)
            task.update("running", f"'{service_name}' 서비스 정보 페이지 접속 완료", ss)

            # 로그인 재요구 처리
            if any(k in page.url for k in LOGIN_PAGE_URL_KEYWORDS):
                login_ok = await _login_bokjiro(page, task, provider)
                if not login_ok:
                    await browser.close()
                    return
                await asyncio.sleep(2)
                await page.goto(service_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(3)

            # ④ 신청하기 버튼 클릭
            ss = await take_screenshot(page)
            task.update("running", "신청하기 버튼 탐색 중...", ss)

            apply_clicked = await click_first_matching(page, APPLY_BUTTON_SELECTORS)
            if not apply_clicked:
                # 복지로 '신청하기'는 eForm(clipsoft) 위젯 — 합성 클릭에 무반응이라 좌표 기반 신뢰 클릭으로 폴백
                #   (감사 :251 — 표준 셀렉터만으로 '클릭 실패'인데 양식 열림 오보되던 것 실제 클릭으로 해소)
                apply_clicked = await click_eform_button(page, "신청하기") or await click_eform_button(page, "신청")
            await asyncio.sleep(2)

            if not apply_clicked:
                ss = await take_screenshot(page)
                task.update("waiting_login",
                    f"신청하기 버튼을 찾지 못했습니다.\n"
                    f"브라우저에서 '{service_name}' 신청하기 버튼을 직접 클릭한 후\n"
                    f"신청 양식이 표시되면 계속 진행됩니다.", ss)
                # 사용자가 직접 클릭하도록 최대 30초 대기 — [중단]·창닫힘엔 즉시 탈출(고정 sleep은 취소 지연, 감사 H3)
                for _ in range(30):
                    check_cancel(task, context)
                    await asyncio.sleep(1)

            ss = await take_screenshot(page)
            task.update("running", "신청 양식 로드 중...", ss)

            # ⑤ 팝업 확인
            target_page = page
            if len(context.pages) > 1:
                target_page = context.pages[-1]
                await target_page.bring_to_front()
                ss = await take_screenshot(target_page)
                task.update("running", "신청 팝업 창 감지 — 양식 자동 작성 중...", ss)

            await asyncio.sleep(2)

            # ⑥ 기본 양식 자동 작성 (이름·생년월일·연락처)
            import re as _re
            name = profile.get("name", "")
            birth = _re.sub(r"[^0-9]", "", str(profile.get("birth_date", "")))
            phone = _re.sub(r"[^0-9]", "", str(profile.get("phone", "")))

            async def _fill(selectors, value):
                if not value:
                    return False
                for sel in selectors:
                    try:
                        el = target_page.locator(sel).first
                        if await el.count() > 0:
                            await el.fill(value)
                            return True
                    except Exception:
                        pass
                return False

            any_filled = False
            any_filled |= await _fill(["input[name='aplcntNm']", "input[placeholder*='이름']", "#aplcntNm"], name)
            any_filled |= await _fill(["input[placeholder*='생년월일']", "input[name*='brthdy']", "input[name*='birth']"], birth)
            any_filled |= await _fill(["input[placeholder*='휴대폰']", "input[placeholder*='연락처']", "input[name*='telno']", "input[name*='phone']"], phone)

            # ⑦ 발급 서류 '자동 첨부' — 첨부칸 주변 문맥(라벨·행 텍스트)과 발급 서류명이 일치하는
            #    '확신 매칭'만 자동으로 붙인다(오첨부 방지). 단일 첨부칸+단일 발급서류처럼 모호성이
            #    없는 경우도 첨부. 애매하면 기존처럼 정확 안내로 폴백. 제출은 여전히 본인 확인 후.
            #    (정부24 담당 확인: 정상적 발급·신청 목적의 자동화 접근은 허용 — 2026-07 사용자 확인)
            from rpa.base import recent_issued_docs, DOCS_DIR
            try:
                has_file_input = await target_page.locator("input[type='file']").count() > 0
            except Exception:
                has_file_input = False
            # ⚠️ 자동 첨부 후보는 '최근 발급물'만 — 공용 PC에서 직전 사용자의 오래된 서류(주민번호 포함)가
            #    다음 사용자 신청서에 붙는 교차사용자 PII 유출 방지(감사 확정). '다음 분 상담'은 폴더를 비우고,
            #    이 시간창은 리셋을 깜빡한 경우의 2차 방어선. (안내 목록에는 전체 issued 사용)
            _attach_age = int(os.getenv("RPA_ATTACH_MAX_AGE", "1200"))  # 기본 20분
            issued = recent_issued_docs()
            attach_candidates = recent_issued_docs(within_seconds=_attach_age)
            attached = await _auto_attach(target_page, attach_candidates, name) if (has_file_input and attach_candidates) else []
            attach_guide = ""
            if attached:
                lst = "\n".join(f"   ✓ {a}" for a in attached)
                attach_guide = (f"\n\n📎 발급해둔 서류를 자동으로 첨부했어요:\n{lst}\n"
                                f"   제출 전 첨부칸에서 맞게 붙었는지 한 번만 확인해주세요.")
            elif has_file_input:
                try:
                    await target_page.locator("input[type='file']").first.scroll_into_view_if_needed(timeout=3000)
                except Exception:
                    pass
                if issued:
                    lst = "\n".join(f"   • {n}" for n, _ in issued[:6])
                    attach_guide = (f"\n\n📎 서류 첨부: 아래 발급 서류를 첨부칸에 올려주세요\n{lst}\n"
                                    f"   (저장 위치: {DOCS_DIR})\n"
                                    f"   ※ '전자문서지갑' 선택이 있으면 종이·첨부 없이 바로 전자제출돼요(권장).")
                else:
                    attach_guide = ("\n\n📎 서류 첨부칸이 있어요. 서류 도우미에서 먼저 발급한 뒤 첨부하거나,\n"
                                    "   '전자문서지갑' 선택으로 종이 없이 전자제출하세요(권장).")
            elif issued:
                attach_guide = "\n\n📎 첨부칸이 안 보이면 '전자문서지갑' 방식일 수 있어요 — 발급한 전자증명서가 자동 연동됩니다."

            await asyncio.sleep(1)
            ss = await take_screenshot(target_page)
            # 신청 양식이 '실제로' 열렸는지 구체 신호로 판정 — 클릭 실패·미개폐인데도 '양식 열림!'으로
            #   오보하던 결함(감사 :251) 해소. 어느 하나라도 참이면 양식 도달로 본다.
            form_detected = bool(apply_clicked) or (len(context.pages) > 1) or has_file_input or any_filled
            import os as _os
            if form_detected:
                task.update("running",
                    f"✅ '{service_name}' 신청 양식이 열렸어요!\n\n"
                    f"📋 남은 작업:\n"
                    f"1. 신청 양식의 내용을 확인해주세요\n"
                    f"2. 추가 정보가 필요하면 직접 입력해주세요"
                    + attach_guide +
                    f"\n3. 모든 내용 확인 후 '신청' 버튼을 클릭해주세요\n\n"
                    f"⚠️ 제출은 반드시 직접 확인 후 진행해주세요.", ss)
                task.result = {"success": True, "service_name": service_name, "status": "form_ready"}
            else:
                # 서비스 페이지까진 왔지만 '신청하기'를 자동으로 열지 못함 — 가짜 '양식 열림' 대신 정직 안내.
                #   (요구사항 최소선 '신청 사이트 자동이동'은 충족 → success=True, 다만 양식 개폐는 수동)
                task.update("running",
                    f"📄 '{service_name}' 신청 페이지까지 왔어요.\n\n"
                    "화면에서 '신청하기' 버튼을 눌러 양식을 열어주세요.\n"
                    "(신청 화면이 eForm이라 버튼을 자동으로 못 여는 경우가 있어요.)"
                    + attach_guide +
                    "\n\n⚠️ 제출은 반드시 직접 확인 후 진행해주세요.", ss)
                task.result = {"success": True, "service_name": service_name, "status": "page_ready", "manual_apply": True}

            # 사용자 검토·제출 동안 브라우저 유지 — 기본 10분(RPA_REVIEW_WINDOW 초).
            # ⚠️ 과거 60초는 어르신·현장에서 검토 중에 창이 사라지는 문제 → 대폭 확장.
            #    사용자가 창을 직접 닫으면 조기 종료(불필요한 대기 없음).
            review_sec = max(60, int(_os.getenv("RPA_REVIEW_WINDOW", "600")))
            for _rw in range(review_sec // 5):
                check_cancel(task, context)  # [중단] 요청·창닫힘 즉시 탈출
                await asyncio.sleep(5)
                try:
                    if not context.pages or all(p.is_closed() for p in context.pages):
                        break
                except Exception:
                    break
                # 하트비트(30초마다) — 검토 창 최대 10분이 무갱신이라 '멈췄다'로 오인(실사용 피드백).
                # 살아있음 + 지금 할 일 + 종료 방법을 계속 알려준다.
                if _rw and _rw % 6 == 0:
                    try:
                        _open = [pg for pg in context.pages if not pg.is_closed()]
                        _ss = await take_screenshot(_open[-1]) if _open else None
                        _el = _rw * 5
                        task.update("running",
                            f"🕐 신청서 검토를 기다리는 중이에요 ({_el // 60}분 {_el % 60:02d}초 경과)\n"
                            "열린 브라우저 창에서 내용을 확인하고 [신청] 버튼으로 제출해 주세요.\n"
                            "제출을 마쳤거나 그만두려면 그 창을 닫으면 돼요(자동으로 정리됩니다).",
                            _ss)
                    except Exception:
                        pass

            # 최종 스크린샷(창이 남아있을 때만)
            ss = None
            try:
                open_pages = [p for p in context.pages if not p.is_closed()]
                if open_pages:
                    ss = await take_screenshot(open_pages[-1])
            except Exception:
                pass

            task.update("done",
                f"✅ '{service_name}' 신청 절차 안내 완료!\n"
                "브라우저에서 신청을 마저 진행하거나 나중에 복지로(www.bokjiro.go.kr)에서 신청하실 수 있습니다.\n"
                "문의: ☎ 129 (복지로 콜센터)", ss)

            await browser.close()

    except CancelledByUser:
        # 사용자 중단/창닫힘 — manager 가 'cancelled'로 정직히 종결하도록 재전파
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        task.update("error", f"자동화 오류: {str(e)[:300]}", None)
