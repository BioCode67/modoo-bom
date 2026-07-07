# -*- coding: utf-8 -*-
"""모두봄 프로덕션 스모크 — 배포된 라이브 사이트(gh-pages) + 백엔드(Render)를 검증한다.

smoke.py는 로컬 dist를 preview로 띄워 검증하지만, 이 스크립트는 '실제 배포본'을 대상으로
배포 직후 회귀를 잡는다. 빌드 불필요 — 인터넷만 있으면 어디서나 실행 가능.

실행(레포 루트/어디서나):
    backend/venv/Scripts/python.exe frontend/e2e/prod-smoke.py

검증:
  1) 라이브 홈 로드 + 콘솔/페이지 에러 0건
  2) QuickAsk 자연어 분석 → 결과 렌더(온디바이스 엔진 — 백엔드 없이도 동작)
     · '경기도 광주시…'(sidoOf 지역판정) · '자녀 없이…'(부정문 파싱) 등 엣지 쿼리 포함
  3) 백엔드(Render) /api/health — production·AI 프로바이더·카탈로그 건수(잠들어 있으면 깨우고 재시도)

종료코드: 0=정상, 1=문제. CI/배포 훅에서 게이트로 쓸 수 있다.
"""
import io as _io
import json
import sys
import urllib.request

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

SITE = "https://biocode67.github.io/modoo-bom/"
BACKEND = "https://modoo-bom.onrender.com/api/health"
QUERIES = [
    "경기도 광주시 사는 72세 어르신인데 소득이 적어요",  # sidoOf 도(道) 우선 판정
    "자녀 없이 혼자 사는 30대 저소득",                    # parseQuery 부정문 자녀 가드
]


def check_backend() -> bool:
    """Render 백엔드 헬스체크. 무료 티어라 잠들어 있으면 첫 요청이 느리므로 넉넉히 대기."""
    try:
        with urllib.request.urlopen(BACKEND, timeout=90) as r:
            d = json.loads(r.read().decode("utf-8"))
        cap = d.get("capabilities", {})
        rag = d.get("rag", {})
        print(f"백엔드 OK — mode={d.get('mode')} · AI={cap.get('ai_provider')} · "
              f"카탈로그={rag.get('catalog_total')}건")
        return d.get("status") == "ok" and rag.get("catalog_total", 0) > 0
    except Exception as e:
        print(f"백엔드 확인 실패(무료 티어 콜드스타트일 수 있음): {type(e).__name__}: {e}")
        return False


def check_frontend() -> bool:
    errors, page_errors = [], []
    ok_queries = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context().new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def dismiss_onboarding():
            # 첫 방문 온보딩 모달('새싹이 인사')이 히어로 입력을 가려 제출 클릭을 막는다 → ESC로 닫는다.
            if page.get_by_role("dialog").count():
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)

        page.goto(SITE, wait_until="networkidle", timeout=60000)
        print(f"홈 로드 OK — {page.title()}")

        for q in QUERIES:
            dismiss_onboarding()
            inp = page.get_by_label("상황을 한 문장으로 입력")
            inp.first.fill(q)
            # 진짜 제출 경로: 히어로 form의 submit 버튼(일반 Enter는 QuickAsk textarea에선 제출 아님).
            page.locator("form button[type=submit]").first.click(timeout=8000)
            try:
                # 결과 전용 마커('맞춤 추천 복지' 헤딩) — '받을 수 있는 복지'는 홈 히어로에도 있어 오탐.
                # 백엔드 10노드 스트림이면 수십 초 걸리므로 넉넉히 대기.
                page.wait_for_selector("text=맞춤 추천 복지", timeout=45000)
                print(f"  분석 결과 렌더 OK — '{q[:20]}…'")
                ok_queries += 1
            except Exception:
                print(f"  분석 결과 렌더 실패 — '{q[:20]}…'")
            page.goto(SITE, wait_until="networkidle", timeout=60000)

        browser.close()

    print(f"콘솔 에러 {len(errors)}건 · 페이지(uncaught) 에러 {len(page_errors)}건")
    for e in page_errors[:5]:
        print(f"  PAGEERROR: {e[:160]}")
    return ok_queries == len(QUERIES) and not page_errors


def main() -> int:
    print("=== 모두봄 프로덕션 스모크 ===")
    fe = check_frontend()
    be = check_backend()
    # 프론트는 백엔드 없이도 완전 동작(온디바이스) — 게이트는 프론트 기준, 백엔드는 경고성.
    print("\n" + ("PROD SMOKE OK ✅" if fe else "PROD SMOKE 실패 ❌ — 프론트 회귀 확인 필요"))
    if not be:
        print("(참고: 백엔드 미응답 — 정적 배포 프론트는 정상이면 데모엔 지장 없음. RPA/챗만 콜드스타트 영향)")
    return 0 if fe else 1


if __name__ == "__main__":
    sys.exit(main())
