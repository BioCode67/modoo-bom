# -*- coding: utf-8 -*-
"""모두봄 확장 연동 E2E — 실제 크롬에 확장(extension/)을 로드해
웹 ↔ 확장 ↔ 정부24 자동발급 흐름이 '진짜로' 맞물리는지 검증한다.

유닛/스모크가 못 보는 구간:
  bridge.js 주입 → PING 케이퍼빌리티 → ISSUE 시작 → 정부24 탭 생성 → status 피드백.
본인인증 직전(로그인 요구)까지가 검증 범위 — 그 이후는 설계상 사람 몫.

실행(레포 루트에서):
    backend\\venv\\Scripts\\python.exe frontend\\e2e\\ext-flow.py

주의: 브릿지는 manifest의 matches(localhost:4173) 페이지에만 주입되므로 포트 4173 고정.
"""
import io as _io
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FRONTEND = Path(__file__).resolve().parents[1]
EXT_DIR = FRONTEND.parent / "extension"
PORT = 4173  # bridge.js content_scripts matches 고정
BASE = f"http://localhost:{PORT}/"


def wait_port(port: int, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def port_busy(port: int) -> bool:
    try:
        with socket.create_connection(("localhost", port), timeout=1):
            return True
    except OSError:
        return False


PING_JS = """
() => new Promise((resolve) => {
  const reqId = 'e2e-' + Math.random().toString(36).slice(2)
  const onMsg = (e) => {
    const d = e.data
    if (d && d.source === 'modoo-ext' && d.kind === 'response' && d.reqId === reqId) {
      window.removeEventListener('message', onMsg); resolve(d.resp)
    }
  }
  window.addEventListener('message', onMsg)
  window.postMessage({ source: 'modoo-web', type: 'PING', reqId }, '*')
  setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null) }, 3000)
})
"""

ISSUE_JS = """
(docName) => new Promise((resolve) => {
  window.__extStatuses = []
  window.addEventListener('message', (e) => {
    const d = e.data
    if (d && d.source === 'modoo-ext' && d.kind === 'status') window.__extStatuses.push(d.payload)
  })
  const reqId = 'e2e-' + Math.random().toString(36).slice(2)
  const onMsg = (e) => {
    const d = e.data
    if (d && d.source === 'modoo-ext' && d.kind === 'response' && d.reqId === reqId) {
      window.removeEventListener('message', onMsg); resolve(d.resp)
    }
  }
  window.addEventListener('message', onMsg)
  window.postMessage({ source: 'modoo-web', type: 'ISSUE',
    payload: { docName, userInfo: { name: '테스트' } }, reqId }, '*')
  setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null) }, 15000)
})
"""


def main() -> int:
    if not (EXT_DIR / "manifest.json").exists():
        print("[ext-e2e] ❌ extension/ 폴더 없음")
        return 2
    if port_busy(PORT):
        print(f"[ext-e2e] ❌ :{PORT} 이미 사용 중 — 기존 프리뷰/개발서버 종료 후 재실행")
        return 2

    log = open(os.path.join(str(FRONTEND), "e2e", "ext-preview.log"), "w", encoding="utf-8")
    if not (FRONTEND / "e2e-dist" / "index.html").exists():
        print("[ext-e2e] e2e-dist 빌드 중 …")
        r = subprocess.run(
            "npm run build -- --outDir e2e-dist --emptyOutDir --base /",
            cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
        )
        if r.returncode != 0:
            print("[ext-e2e] ❌ 빌드 실패 — e2e/ext-preview.log 확인")
            return 2

    print(f"[ext-e2e] vite preview 기동(:{PORT}) …")
    server = subprocess.Popen(
        f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",
        cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT,
    )
    failures: list[str] = []
    try:
        if not wait_port(PORT, timeout=60):
            print("[ext-e2e] ❌ preview 서버가 뜨지 않음")
            return 1

        from playwright.sync_api import sync_playwright

        headed = os.environ.get("EXT_HEADED") == "1"
        with sync_playwright() as p:
            user_dir = tempfile.mkdtemp(prefix="modoo-ext-e2e-")
            args = [
                f"--disable-extensions-except={EXT_DIR}",
                f"--load-extension={EXT_DIR}",
                # 실사용 크롬에 가깝게: 자동화 탐지 플래그 제거(Mbuster는 navigator.webdriver 등을 봄)
                "--disable-blink-features=AutomationControlled",
            ]
            launch_kw = dict(
                args=args,
                ignore_default_args=["--enable-automation"],
                # webdriver 플래그를 최대한 지운다
            )
            # 컨테이너/CI 크로미움 경로 폴백(버전 불일치 회피) — 로컬 PC에선 빈 리스트라 기본 동작
            import glob as _glob
            _exe = _glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
            if _exe:
                launch_kw["executable_path"] = _exe[0]
            if headed:
                print("[ext-e2e] headed(실사용 근사) + 확장 로드 — Mbuster 통과 여부 확인")
                ctx = p.chromium.launch_persistent_context(user_dir, headless=False, **launch_kw)
            else:
                # MV3 확장은 신형 headless(chromium 채널)에서만 동작
                try:
                    ctx = p.chromium.launch_persistent_context(
                        user_dir, headless=True,
                        **({} if _exe else {"channel": "chromium"}), **launch_kw)  # 경로 지정 시 channel 생략(충돌)
                    print("[ext-e2e] chromium(신형 headless) + 확장 로드")
                except Exception as ex:
                    print(f"[ext-e2e] headless 확장 로드 실패({str(ex)[:80]}) → headed 폴백")
                    ctx = p.chromium.launch_persistent_context(user_dir, headless=False, **launch_kw)
            # navigator.webdriver 흔적 제거(실사용 근사)
            try:
                ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
            except Exception:
                pass

            page = ctx.new_page()
            page.goto(BASE, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)  # bridge 주입 + SW 기동 여유

            # 1) PING — 케이퍼빌리티·서류 13종·서비스 목록
            resp = page.evaluate(PING_JS)
            if not (resp and resp.get("ok") and (resp.get("capabilities") or {}).get("rpa")):
                failures.append(f"PING 실패: {resp!r}")
            else:
                docs = resp.get("docs") or []
                svcs = resp.get("services") or []
                print(f"[ext-e2e] ✅ PING ok — 서류 {len(docs)}종, 신청 {len(svcs)}종, v{resp.get('version','?')}")
                if len(docs) < 13:
                    failures.append(f"지원 서류 {len(docs)}종(<13): {docs}")
                for must in ("주민등록등본", "가족관계증명서", "건강보험 자격득실확인서"):
                    if not any(must.replace(" ", "") == d.replace(" ", "") for d in docs):
                        failures.append(f"PING docs에 {must} 누락")

            # 2) ISSUE 주민등록등본 — 정부24 탭 생성 + status 피드백 (본인인증 전까지)
            if not failures:
                new_pages: list = []
                ctx.on("page", lambda pg: new_pages.append(pg))
                resp2 = page.evaluate(ISSUE_JS, "주민등록등본")
                if not (resp2 and resp2.get("ok")):
                    failures.append(f"ISSUE 시작 실패: {resp2!r}")
                else:
                    print("[ext-e2e] ISSUE 시작 ok — 정부24 탭 대기 …")
                    end = time.time() + 40
                    gov = None
                    while time.time() < end and gov is None:
                        for pg in new_pages:
                            try:
                                if "gov.kr" in (pg.url or ""):
                                    gov = pg
                                    break
                            except Exception:
                                pass
                        page.wait_for_timeout(500)
                    if gov is None:
                        failures.append(f"40초 내 정부24 탭 미생성 (새 탭 {len(new_pages)}개)")
                    else:
                        print(f"[ext-e2e] ✅ 정부24 탭 생성: {gov.url[:90]}")
                        # 자동화 진행 여유 — 로그인/인증 관문 도달까지
                        page.wait_for_timeout(12000)
                        statuses = page.evaluate("window.__extStatuses || []")
                        print(f"[ext-e2e] status 이벤트 {len(statuses)}건")
                        for s in statuses[:10]:
                            print("   ·", s)
                        if not statuses:
                            failures.append("ISSUE 후 status 이벤트 0건 — 진행 피드백 루프 끊김")
                        try:
                            shot = str(FRONTEND / "e2e" / "ext-gov24.png")
                            gov.screenshot(path=shot)
                            print(f"[ext-e2e] 스크린샷: {shot}")
                        except Exception as ex:
                            print("[ext-e2e] 스크린샷 실패(무해):", str(ex)[:80])

            ctx.close()
    finally:
        try:
            if os.name == "nt":
                subprocess.run(f"taskkill /F /T /PID {server.pid}", shell=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:  # 리눅스/맥 — 프리뷰 고아 방지
                server.terminate()
        except Exception:
            pass
        log.close()

    if failures:
        print("\n[ext-e2e] ❌ 실패:")
        for f in failures:
            print("  -", f)
        return 1
    print("\n[ext-e2e] ✅ 확장 연동 흐름 검증 통과 (PING → ISSUE → 정부24 탭 → status 피드백)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
