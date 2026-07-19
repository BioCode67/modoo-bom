# -*- coding: utf-8 -*-
"""서류 촬영(DocCameraModal) E2E — 가짜 카메라로 실브라우저에서 촬영→제출용 PDF 생성을 검증.

유닛(docScan)이 못 잡는 통합 파손(getUserMedia·캔버스 캡처·모달·다운로드 배선)을 잡는다.
chromium을 가짜 미디어 장치로 띄우고, tracked에 청년월세지원을 심어 서류 도우미의
'본인 준비물'(임대차계약서) 카드에서 📷 촬영 → 촬영 → 제출문서로 만들기(웹=PDF 다운로드)까지 몰아본다.

실행(레포 루트에서):
    cd frontend && python3 e2e/camera-smoke.py
"""
import io as _io
import os
import socket
import subprocess

from _procutil import SPAWN_KW, stop_tree
import sys
import time
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_port(port: int, timeout: float = 60) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


SEED = (
    "localStorage.setItem('modoobom-store', JSON.stringify({state:{"
    "tracked:[{policyId:'POL-009',name:'청년월세지원',category:'청년',status:'idle',savedAt:1,checkedDocs:[]}],"
    "docDone:{},onboarded:true},version:0}))"
)


def main() -> int:
    PORT = free_port()
    BASE = f"http://localhost:{PORT}/"
    log = open(FRONTEND / "e2e" / "preview.log", "w", encoding="utf-8")
    print("[cam] e2e-dist-cam 빌드 중 …")
    if subprocess.run("npm run build -- --outDir e2e-dist-cam --emptyOutDir --base /",
                      cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT).returncode != 0:
        print("[cam] ❌ 빌드 실패 — e2e/preview.log 확인"); return 2
    print(f"[cam] preview 기동(:{PORT}) …")
    server = subprocess.Popen(f"npm run preview -- --outDir e2e-dist-cam --port {PORT} --strictPort",
                              cwd=str(FRONTEND), shell=True, stdout=log, stderr=subprocess.STDOUT, **SPAWN_KW)
    try:
        if not wait_port(PORT):
            print("[cam] ❌ preview 서버가 뜨지 않음"); return 1
        from playwright.sync_api import sync_playwright
        import glob as _glob
        # 컨테이너 크로미움 경로(Playwright 번들 버전과 어긋날 수 있어 실제 바이너리를 직접 지정)
        cands = _glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        exe = cands[0] if cands else None
        errors: list[str] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=exe, args=[
                "--use-fake-device-for-media-stream",  # 가짜 카메라(초록 패턴 프레임 공급)
                "--use-fake-ui-for-media-stream",       # 권한 프롬프트 자동 허용
            ])
            ctx = browser.new_context()
            ctx.grant_permissions(["camera"], origin=BASE)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))

            def on_console(m):
                if m.type != "error":
                    return
                t = m.text
                if "/api/health" in t or "/api/" in t or "Failed to load resource" in t:
                    return  # 백엔드 없는 프리뷰 노이즈
                errors.append(f"console: {t[:160]}")
            page.on("console", on_console)

            page.add_init_script(SEED)
            page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            print("[cam] ✅ 홈 로드")
            try:
                page.click('[aria-label="닫기"]', timeout=2000)
            except Exception:
                pass

            page.click("text=나의 복지")
            page.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            print("[cam] ✅ 나의 복지 → 서류 준비 도우미(청년월세지원 서류 노출)")

            # 임대차계약서 = 본인 준비물 → 📷 촬영 버튼(웹에서도 노출: userProvided)
            cam_btn = page.locator("button:has-text('📷 촬영')").first
            cam_btn.wait_for(state="visible", timeout=8000)
            cam_btn.click()
            print("[cam] ✅ 📷 촬영 버튼 클릭 → 모달")

            page.wait_for_selector("div[role='dialog'][aria-label*='촬영']", timeout=8000)

            # 파일선택 경로 회귀검증 — CSP img-src에 blob:이 없어 createObjectURL 이미지가 조용히 차단되던 버그
            #   (FileReader data:로 수정). 합성 이미지(PII 아님)를 hidden input에 주입해 썸네일이 뜨는지 확인.
            import base64 as _b64
            tiny = _b64.b64decode(
                "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
                "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
                "AAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q=="
            )
            tinyp = FRONTEND / "e2e" / "_tiny.jpg"
            tinyp.write_bytes(tiny)
            page.locator("div[role='dialog'] input[type='file']").set_input_files(str(tinyp))
            page.wait_for_selector("div[role='dialog'] img[alt='1쪽']", timeout=8000)
            tinyp.unlink()
            print("[cam] ✅ 사진 선택(FileReader data:) → 썸네일 (CSP blob: 차단 우회 확인)")

            # 90° 회전 컨트롤 동작(가로로 찍힌 신분증 세우기)
            page.locator("div[role='dialog'] button[aria-label*='회전']").first.click()
            print("[cam] ✅ 90° 회전 컨트롤 동작")

            # 가짜 카메라 프레임이 실제로 흐르는지 — video.videoWidth>0 까지 대기
            page.wait_for_function(
                "() => { const v=document.querySelector(\"div[role='dialog'] video\"); return v && v.videoWidth>0 && v.readyState>=2 }",
                timeout=15000,
            )
            print("[cam] ✅ 카메라 미리보기 재생(videoWidth>0)")

            page.locator("div[role='dialog'] button:has-text('촬영')").first.click()
            page.wait_for_selector("div[role='dialog'] img[alt='2쪽']", timeout=8000)
            print("[cam] ✅ 촬영 1장 추가 → 2쪽(촬영+파일 혼합)")

            # ✂️ 자르기(옵트인) — 2쪽 크롭 편집기 열고 기본 크롭 적용 → 캔버스가 작아지는지 확인(배경 제거)
            w0 = page.evaluate("()=>document.querySelector(\"div[role='dialog'] img[alt='2쪽']\").naturalWidth")
            page.locator("button[aria-label='2쪽 자르기']").click()
            page.wait_for_selector("div[aria-label='서류 자르기']", timeout=6000)
            page.locator("div[aria-label='서류 자르기'] button:has-text('자르기 적용')").click()
            page.wait_for_selector("div[aria-label='서류 자르기']", state="detached", timeout=6000)
            w1 = page.evaluate("()=>document.querySelector(\"div[role='dialog'] img[alt='2쪽']\").naturalWidth")
            assert w1 < w0, f"크롭 후 폭이 안 줄었다: {w0}->{w1}"
            print(f"[cam] ✅ 서류 자르기(크롭) 적용 → 폭 {w0}→{w1}px 축소(배경 제거)")

            # 제출문서로 만들기 → 웹은 PDF 다운로드
            with page.expect_download(timeout=15000) as dl_info:
                page.locator("div[role='dialog'] button:has-text('제출문서로 만들기')").click()
            dl = dl_info.value
            out = FRONTEND / "e2e" / "cam-out.pdf"
            dl.save_as(str(out))
            size = out.stat().st_size
            head = out.read_bytes()[:8]
            assert dl.suggested_filename.endswith(".pdf"), f"파일명이 pdf 아님: {dl.suggested_filename}"
            assert head[:5] == b"%PDF-", f"PDF 헤더 아님: {head!r}"
            assert size > 500, f"PDF 너무 작음: {size}"
            print(f"[cam] ✅ 제출문서로 만들기 → {dl.suggested_filename} ({size} bytes, %PDF 헤더 확인)")
            out.unlink(missing_ok=True)

            # 추가 검증: 자동신청 버튼 노출(데모 최대 결함 수정) — 청년월세지원 상세에 '에이전트 자동 신청' 카드가 뜨는가.
            #   과거 application이 표시문자열이라 버튼이 통째로 숨었다(showApply=false→return null). 지금은 복지로 딥링크
            #   해석(isBokjiroLocal)으로 노출돼야 한다(백엔드 없는 프리뷰는 '공식 신청 페이지' 폴백 카드로, 제목은 동일).
            page.get_by_role("button", name="청년월세지원", exact=True).first.click()
            page.wait_for_selector("text=에이전트 자동 신청", timeout=8000)
            print("[cam] ✅ 청년월세지원 상세 → '에이전트 자동 신청' 카드 노출(자동신청 숨김 결함 수정 확인)")

            if errors:
                print("[cam] ❌ 페이지/콘솔 에러:")
                for e in errors[:8]:
                    print("   ", e[:200])
                return 1
            print("[cam] ✅ 전 구간 에러 0건 — 촬영→제출용 PDF 실브라우저 검증 통과")
            browser.close()
        return 0
    finally:
        stop_tree(server)  # 셸+node 트리째 종료(_procutil) — 전 OS 고아 프리뷰 방지


if __name__ == "__main__":
    sys.exit(main())
