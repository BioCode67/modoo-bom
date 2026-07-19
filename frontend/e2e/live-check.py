# -*- coding: utf-8 -*-
"""라이브 배포판 검증 — 로컬 프리뷰가 아닌 실제 GitHub Pages 사이트를 실브라우저로 점검.
프리뷰 E2E가 못 보는 것: base(/modoo-bom/) 경로, SW 등록, policies.json 런타임 병합(5,000+),
임베딩 파일 서빙, 프로덕션 번들 런타임 에러.
실행: backend\\venv\\Scripts\\python.exe frontend\\e2e\\live-check.py
"""
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LIVE = "https://biocode67.github.io/modoo-bom/"

def main():
    from playwright.sync_api import sync_playwright
    fails = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=(__import__("glob").glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome") or [None])[0])
        pg = b.new_page(viewport={"width": 1280, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        try:
            resp = pg.goto(LIVE, wait_until="networkidle", timeout=60000)
        except Exception as e:  # 프록시/망 차단 환경 — 코드 결함이 아님을 명확히
            if "ERR_TUNNEL" in str(e) or "ERR_PROXY" in str(e) or "ERR_NAME" in str(e):
                print(f"[live] ⚠️ 라이브 사이트 접근 불가(네트워크/프록시 차단): {LIVE}")
                print("[live] ⚠️ 이 스위트는 라이브 배포 검증용 — 인터넷 연결 환경에서 재실행하세요.")
                return 2
            raise
        if not resp or resp.status >= 400:
            print(f"❌ 홈 로드 실패: {resp and resp.status}"); return 1
        pg.wait_for_timeout(2500)
        try:
            pg.click('[aria-label="닫기"]', timeout=3000)
        except Exception:
            pass
        # 1) 히어로 핵심 문구
        try:
            pg.wait_for_selector("text=복지 혜택", timeout=10000)
            print("✅ 1. 라이브 홈 로드 + 히어로")
        except Exception:
            fails.append("히어로 문구 미노출")
        # 2) SW 등록(재방문 오프라인·캐시의 전제)
        try:
            sw = pg.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)")
            if sw and sw > 0: print(f"✅ 2. 서비스워커 등록 {sw}건")
            else: fails.append("서비스워커 미등록")
        except Exception as e:
            fails.append(f"SW 확인 실패 {str(e)[:40]}")
        # 3) 정적 데이터 파일 서빙(런타임 병합 소스)
        for path, name in [("policies.json", "공공데이터"), ("policy-embeddings.json", "임베딩")]:
            st = pg.evaluate(f"fetch('{LIVE}{path}',{{method:'HEAD'}}).then(r=>r.status).catch(()=>0)")
            if st == 200: print(f"✅ 3. {name} 서빙 200")
            else: fails.append(f"{path} 서빙 {st}")
        # 4) 탐색 — 카탈로그 5,000+ 병합 확인
        try:
            pg.click("text=정책 탐색"); pg.wait_for_timeout(4000)  # 워커 병합 대기
            body = pg.inner_text("body")
            import re
            m = re.search(r"([45],\d{3})개 복지 정책", body)
            if m and int(m.group(1).replace(",", "")) >= 5000:
                print(f"✅ 4. 카탈로그 병합 {m.group(1)}건(런타임 병합 동작)")
            else:
                fails.append(f"카탈로그 병합 의심(표시: {m.group(1) if m else '못찾음'})")
        except Exception as e:
            fails.append(f"탐색 확인 실패 {str(e)[:50]}")
        # 5) 분석 여정(대화형) 최소 확인 — 새싹이 온보딩 노출
        try:
            pg.click("text=복지 찾기"); pg.wait_for_timeout(1200)
            pg.wait_for_selector("text=모두봄 에이전트", timeout=8000)
            print("✅ 5. 대화형 온보딩 노출(라이브)")
        except Exception:
            fails.append("대화형 온보딩 미노출(라이브)")
        # 6) 페이지 에러 0 (백엔드 헬스프로브 관련 콘솔은 제외 — pageerror만 본다)
        if errs:
            fails.append(f"pageerror {len(errs)}건: {errs[0][:80]}")
        else:
            print("✅ 6. 페이지 에러 0")
        b.close()
    if fails:
        print("\n❌ 라이브 결함:")
        for f in fails: print("  -", f)
        return 1
    print("\n🎉 라이브 배포판 전 항목 통과")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
