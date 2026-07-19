# -*- coding: utf-8 -*-
"""모두봄 E2E 스모크 — 실브라우저로 핵심 사용자 여정을 검증한다.

유닛테스트가 못 잡는 통합 파손(라우팅·번들·런타임 에러·화면 조립)을 데모 전에 잡는 안전망.
빌드 산출물(dist)을 vite preview로 띄우고 headless chromium으로 검증한다.

실행(레포 루트에서):
    cd frontend && npm run build   # dist 최신화
    ..\\backend\\venv\\Scripts\\python.exe e2e\\smoke.py

검증 여정:
  1) 홈 로드 + 히어로 통계(정부·지자체·민간)
  2) 복지 찾기 → 데모 페르소나(독거 어르신) → 분석 결과 + 민간재단 💝 섹션
  3) 챗 에이전트 열기 → 개인화 인사(프로필 이름)
  4) 정책 탐색 → 민간재단 필터 → 현대차 정몽구 스칼러십 노출
  4.5) 급여 계산기(80만→생계급여 대상) / 4.7) 긴급진단(정부 우선) / 2.5) 용어사전+ESC
  5) 모바일 뷰포트(390px) 홈·복지찾기 진입
  + 전 구간 페이지 에러(pageerror) 0건
"""
import io as _io
import os
import socket
import subprocess

from _procutil import SPAWN_KW, stop_tree
import sys
import time
from pathlib import Path

# Windows 콘솔(cp949)에서도 이모지 출력이 죽지 않게 UTF-8 강제
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FRONTEND = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = free_port()  # 고정 포트 충돌(좀비 프리뷰 등) 회피
BASE = f"http://localhost:{PORT}/"  # e2e-dist는 --base / 로 빌드(vite preview가 serve 모드 base(/)로 서빙하므로)


def wait_port(port: int, timeout: float = 30) -> bool:
    """vite가 IPv6(::1)로만 바인딩하기도 하므로 localhost 해석(v4/v6 모두)으로 확인"""
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def main() -> int:
    # 전용 출력 폴더(e2e-dist)로 직접 빌드 — 같은 폴더에서 병행 작업(다른 세션)의
    # dist 빌드와 경합해 index.html/assets가 어긋나는 문제를 원천 차단한다.
    print("[e2e] e2e-dist 빌드 중 …")
    log = open(os.path.join(str(FRONTEND), "e2e", "preview.log"), "w", encoding="utf-8")
    r = subprocess.run(
        "npm run build -- --outDir e2e-dist --emptyOutDir --base /",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
    )
    if r.returncode != 0:
        print("[e2e] ❌ 빌드 실패 — e2e/preview.log 확인")
        return 2

    print(f"[e2e] vite preview 기동(:{PORT}) …")
    server = subprocess.Popen(
        f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
        **SPAWN_KW,
    )
    try:
        if not wait_port(PORT, timeout=60):
            print("[e2e] ❌ preview 서버가 뜨지 않음")
            return 1

        from playwright.sync_api import sync_playwright
        import glob as _glob

        errors: list[str] = []
        with sync_playwright() as p:
            # 컨테이너/CI의 크로미움 경로 폴백(버전 불일치 회피) — 로컬 PC에선 빈 리스트라 기본 동작
            _exe = _glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
            browser = p.chromium.launch(executable_path=(_exe[0] if _exe else None))
            # Windows UA로 고정 — 'Windows 앱 바로 받기' CTA가 Windows UA에서만 노출돼, 리눅스 CI/컨테이너에서
            # 이 여정이 환경 때문에 실패하지 않게 한다(사용자 Windows PC와 동일 조건).
            page = browser.new_context(user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36")).new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            # /api/health 는 백엔드 감지 프로브 — 프리뷰(프록시)에선 500이 정상 노이즈라 실패 게이트에서 제외
            def on_console(m):
                if m.type != "error":
                    return
                loc = (m.location or {}).get("url", "") if hasattr(m, "location") else ""
                if "/api/health" in loc or "/api/health" in m.text:
                    return  # 백엔드 감지 프로브 노이즈(프리뷰 프록시 500) — 무해
                if "cdn.jsdelivr.net" in loc:
                    return  # 폰트 CDN(프리텐다드) — 차단망/CI에선 실패해도 시스템 폰트 폴백으로 무해
                if "huggingface.co" in loc or "huggingface.co" in m.text:
                    return  # AI 임베딩 모델 CDN — 차단망/CI에선 실패해도 앱이 키워드 검색으로 정직 폴백(제품 검증은 별도 단계)
                if "[AI검색]" in m.text and "Failed to fetch" in m.text:
                    # 같은 차단망 실패의 '앱 정직 로깅' 경로(위치가 로컬 번들이라 위 huggingface 필터를 비껴감).
                    # 3.8 핸드오프 후 비동기로 늦게 도착해 그린/레드가 갈리던 플레이크 — 오류 UI(영어 브리지) 검증은 별도 수행됨.
                    return
                # /ws/analyze WS 403: 프리뷰는 임의 포트(localhost:PORT) origin이라 백엔드 허용목록 밖 → 정상 거절.
                # 실제 배포 origin(biocode67.github.io)은 허용돼 스트리밍됨(라이브 실측 확인). 프론트도 WS 실패 시
                # 클라이언트 에이전트 연출로 폴백하므로 사용자 영향 없음 → E2E 실패 게이트에서 제외.
                if "/ws/analyze" in m.text or "/ws/analyze" in loc:
                    return
                errors.append(f"console.{m.type}: {m.text} @{loc[:80]}")
            page.on("console", on_console)
            bad: list[str] = []
            page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
            page.on("requestfailed", lambda r: bad.append(f"FAIL {r.url} {r.failure}"))

            def dump(tag: str):
                """실패 원인 진단 — 페이지 에러·스크린샷 저장"""
                print(f"[e2e][debug] url={page.url} title={page.title()!r}")
                try:
                    kids = page.evaluate("document.getElementById('root')?.childElementCount")
                    entry = page.evaluate("performance.getEntriesByType('resource').length")
                    print(f"[e2e][debug] #root children={kids} resources={entry}")
                except Exception as ex:
                    print("[e2e][debug] evaluate 실패:", ex)
                for b in bad[:8]:
                    print("   [net]", b[:200])
                for e in errors[:6]:
                    print("   [pageerror]", e[:220])
                shot = FRONTEND / "e2e" / f"fail-{tag}.png"
                page.screenshot(path=str(shot))
                print(f"[e2e][debug] 스크린샷: {shot}")

            # 1) 홈
            page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_selector("text=정부·지자체·민간 복지", timeout=15000)
            except Exception:
                dump("home")
                raise
            print("[e2e] ✅ 1. 홈 로드 + 히어로 통계")

            # 첫 방문 온보딩 모달이 클릭을 가로채므로 닫는다(있을 때만)
            try:
                page.click('[aria-label="닫기"]', timeout=3000)
            except Exception:
                pass

            # 2) 분석: 복지 찾기 → '직접 입력'(폼) 탭 → 데모 페르소나 → 결과
            #    (기본은 '새싹이와 대화' 모드라, 페르소나 빠른 선택은 직접 입력 탭에 있음)
            page.click("text=복지 찾기")
            page.click("text=직접 입력")
            page.click("text=독거 어르신")
            page.wait_for_selector("text=맞춤 추천 복지", timeout=30000)  # 분석 연출 ~3초 포함
            page.wait_for_selector("text=민간재단 지원", timeout=10000)
            print("[e2e] ✅ 2. 분석 결과 + 민간재단 💝 섹션")

            # 2.5) 용어사전 + ESC 접근성 — 어려운 말 즉시 해소 + 키보드로 닫기
            page.click("text=복지 용어 사전")
            page.wait_for_selector("text=복지 용어 쉬운 사전", timeout=8000)
            page.keyboard.press("Escape")
            page.wait_for_selector("text=복지 용어 쉬운 사전", state="hidden", timeout=5000)
            print("[e2e] ✅ 2.5 용어사전 열기 + ESC 닫기(키보드 접근성)")

            # 2.7) 📞 결과를 전화로 — 통화가 열리며 결과를 조목조목 브리핑(보수 합산·top3·후속 안내)
            page.click('[aria-label="결과를 전화로 설명 듣기"]')
            page.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
            page.wait_for_selector("text=전화로 짚어드릴게요", timeout=5000)
            page.wait_for_selector("text=기초연금", timeout=4000)  # 독거 어르신 top3에 반드시 포함
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            assert page.locator('[aria-label="새싹이와 통화 상담"]').count() == 0, "브리핑 통화 ESC 종료 실패"
            print("[e2e] ✅ 2.7 📞 결과 음성 브리핑 통화(열림→브리핑→ESC)")

            # 3) 챗 에이전트: 개인화 인사(분석한 프로필 이름)
            page.click('[aria-label="복지 도우미 챗봇 열기"]')
            page.wait_for_selector("text=김복순", timeout=10000)
            print("[e2e] ✅ 3. 챗 에이전트 개인화 브리핑")

            # 3.5) 에이전트 행동 스토리: 검색 → "담아줘"(맥락 저장) → "서류 뭐 필요해"(서류 요약)
            page.fill('[aria-label="질문 입력"]', "기초연금")
            page.keyboard.press("Enter")
            page.wait_for_selector("text=이런 복지가 있어요", timeout=8000)
            page.fill('[aria-label="질문 입력"]', "담아줘")
            page.keyboard.press("Enter")
            page.wait_for_selector("text=담았어요", timeout=8000)
            page.fill('[aria-label="질문 입력"]', "서류 뭐 필요해?")
            page.keyboard.press("Enter")
            page.wait_for_selector("text=주민등록등본", timeout=8000)
            print("[e2e] ✅ 3.5 챗 행동 스토리(담기→서류 요약)")
            page.keyboard.press("Escape")

            # 3.7) 📞 통화형 상담 — 어르신 말로만 완주 경로. 헤드리스에서도 '말 대신 입력' 이중 경로로
            #      인사→질문→정책 답변까지 검증(음성 인식 자체는 브라우저 기능이라 실기기에서 확인).
            #      진입은 챗 헤더의 📞 버튼(분석 완료 상태와 무관하게 항상 존재하는 경로).
            page.click('[aria-label="복지 도우미 챗봇 열기"]')
            page.click('[aria-label="음성 통화 상담으로 전환"]')
            page.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
            page.fill('[aria-label="말 대신 입력하기"]', "기초연금 알려줘")
            page.click('[aria-label="입력 보내기"]')
            page.wait_for_selector("text=기초연금", timeout=8000)
            # 상황 문장(신호≥2) → 통화 안에서 즉시 분석 + 결과 브리핑 + 결과 화면 CTA
            page.fill('[aria-label="말 대신 입력하기"]', "72세 혼자 사는데 소득이 적어요")
            page.click('[aria-label="입력 보내기"]')
            page.wait_for_selector("text=바로 찾아봤어요", timeout=8000)
            # 금액 브리핑은 결과 화면 헤더와 '같은 보수 합산'(핵심 현금지원) — 이론최대 과장 회귀 방지
            page.wait_for_selector("text=핵심 현금지원만 적게 잡아", timeout=4000)
            page.wait_for_selector("text=결과 화면에서 자세히 보기", timeout=4000)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            assert page.locator('[aria-label="새싹이와 통화 상담"]').count() == 0, "통화 ESC 종료 실패"
            print("[e2e] ✅ 3.7 📞 통화형 상담(인사→질문→답변→ESC 종료)")

            # 3.75) 📞→💬 통화 기록 연속성 — 통화를 끊어도 대화가 챗에 이어진다("아까 뭐랬지?" 해결)
            page.click('[aria-label="복지 도우미 챗봇 열기"]')
            page.wait_for_selector("text=방금 통화하신 내용이에요", timeout=5000)
            page.wait_for_selector("text=기초연금 알려줘", timeout=4000)  # 통화의 사용자 발화가 챗 기록에
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            print("[e2e] ✅ 3.75 📞→💬 통화 기록 연속성(끊어도 챗에 남음)")

            # 3.8) 📞 다국어 통화 — 영어 입력 → 자국어 안내 + UI 언어 자동 추종 + AI 의미 검색 핸드오프.
            #      (음성 인식·TTS 보이스는 실기기 확인 영역 — 여기선 라우팅·핸드오프 배선을 검증)
            page.click('[aria-label="복지 도우미 챗봇 열기"]')
            page.click('[aria-label="음성 통화 상담으로 전환"]')
            page.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
            page.fill('[aria-label="말 대신 입력하기"]', "housing support for foreign workers")
            page.click('[aria-label="입력 보내기"]')
            page.wait_for_selector("text=AI meaning search", timeout=8000)  # 영어 안내
            page.wait_for_selector('input[placeholder^="Type instead"]', timeout=4000)  # 입력창도 영어로 자동 전환
            page.click("text=See matching programs")  # CTA → 통화 종료 + 탐색 AI 모드 프리필
            page.wait_for_selector('[aria-label="정책 검색"]', timeout=8000)
            assert "housing" in page.input_value('[aria-label="정책 검색"]'), "AI 검색 질의 프리필 실패"
            page.wait_for_selector("text=AI 의미 검색 ON", timeout=4000)
            # 정리: 다음 시나리오 오염 방지(AI 모드 off + 검색어 비움)
            page.click("text=AI 의미 검색 ON")
            page.click('[aria-label="검색어 지우기"]')
            print("[e2e] ✅ 3.8 📞 다국어 통화(영어 입력→영어 안내→AI 의미 검색 핸드오프)")

            # 4) 탐색: 민간재단 필터 → 큐레이션 노출
            page.click("text=정책 탐색")
            page.click("text=민간재단")
            page.wait_for_selector("text=현대차 정몽구 스칼러십", timeout=15000)
            print("[e2e] ✅ 4. 탐색 민간재단 필터 + 큐레이션 노출")

            # 4.5) 급여 계산기 — 1인 가구 월 80만원 → 생계급여 신청 대상(2026 실측 기준 상한 82만)
            page.click("text=내가 받을 수 있는 급여 계산하기")
            page.fill('[aria-label="월 소득"]', "800000")
            page.wait_for_selector("text=신청 대상이에요", timeout=8000)
            print("[e2e] ✅ 4.5 급여 계산기(1인 80만 → 생계급여 대상)")

            # 4.7) 긴급복지 진단 — 위기 선택 시 정부 제도가 최우선으로 안내
            page.click("text=홈")
            page.click("text=긴급 도움")
            page.wait_for_selector('[aria-label="긴급복지 빠른 진단"]', timeout=8000)
            page.click("text=아프거나 다쳤어요")
            page.wait_for_selector("text=긴급복지지원", timeout=8000)  # 법정 권리(정부) 노출
            page.click('[aria-label="긴급복지 빠른 진단"] >> [aria-label="닫기"]')
            print("[e2e] ✅ 4.7 긴급진단(정부 제도 최우선 노출)")

            # 4.8) 외국인·다문화 진입로 — 홈에 다국어 진입 섹션 + 언어 버튼(경쟁 미개척 차별화)
            page.click("text=홈")
            page.wait_for_selector("text=Ask in your language", timeout=8000)
            page.wait_for_selector("text=Tiếng Việt", timeout=5000)
            # 📞 자국어 통화 직행 — 베트남어 버튼 → 통화가 베트남어 인사·입력창으로 시작(언어 프리셋)
            page.click('[aria-label="자국어 통화 상담 — Tiếng Việt"]')
            page.wait_for_selector('[role="dialog"][aria-label="새싹이와 통화 상담"]', timeout=8000)
            page.wait_for_selector("text=Xin chào", timeout=5000)
            page.wait_for_selector('input[placeholder^="Hoặc gõ câu hỏi"]', timeout=4000)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            assert page.locator('[aria-label="새싹이와 통화 상담"]').count() == 0, "자국어 통화 ESC 종료 실패"
            print("[e2e] ✅ 4.8 외국인·다문화 다국어 진입로(+📞 자국어 통화 직행)")

            # 4.9) 데스크탑 앱 원클릭 다운로드 CTA — exe 직접 다운로드 링크(릴리스 latest 자산) 회귀 고정
            #      (Windows UA에서만 노출 — e2e 크로뮴은 Windows UA)
            btn = page.wait_for_selector('a:has-text("Windows 앱 바로 받기")', timeout=8000)
            href = btn.get_attribute("href") or ""
            assert href.endswith("/releases/latest/download/ModooBom-Setup.exe"), f"다운로드 href 회귀: {href}"
            print("[e2e] ✅ 4.9 데스크탑 앱 원클릭 다운로드 CTA(exe 직링크)")

            # 5) 모바일 뷰포트(iPhone급) — 핸드폰에서 홈·주 흐름이 깨지지 않는지
            mpage = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            mpage.on("pageerror", lambda e: errors.append(f"[mobile] {e}"))
            mpage.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            mpage.wait_for_selector("text=정부·지자체·민간 복지", timeout=15000)
            try:
                mpage.click('[aria-label="닫기"]', timeout=3000)
            except Exception:
                pass
            mpage.click('[aria-label="하단 메뉴"] >> text=복지 찾기')  # 모바일은 하단 탭바(데스크탑 nav는 hidden)
            mpage.wait_for_selector("text=새싹이와 대화", timeout=10000)  # 분석 화면(대화 모드 기본) 진입 확인
            print("[e2e] ✅ 5. 모바일(390px) 홈·복지찾기 정상")
            mpage.close()

            browser.close()

        if errors:
            print(f"[e2e] ❌ 페이지 에러 {len(errors)}건:")
            for e in errors[:5]:
                print("   ", e[:200])
            return 1
        print("[e2e] 🎉 스모크 전 구간 통과 (페이지 에러 0)")
        return 0
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지


if __name__ == "__main__":
    sys.exit(main())
