# -*- coding: utf-8 -*-
"""로컬 에이전트(진짜 크롬+CDP) 자가검증 — 로그인~인증 자동입력 구간을 실제 크롬으로 회귀 테스트.

정부24 DOM/셀렉터 변경을 조기에 잡기 위한 도구(확장의 selftest.mjs에 대응).
실인증(카카오 승인)은 사람만 가능하므로 '인증 요청' 직전까지만 검증한다(그 버튼은 누르지 않음).

실행:  cd backend && venv\\Scripts\\python.exe selftest_agent.py
필요:  크롬 설치 + playwright(pip) — playwright install(브라우저 다운로드)은 불필요(진짜 크롬 사용).
종료코드 0 = 통과.
"""
import subprocess
import sys
import tempfile
import time

import local_agent as la

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
PORT = 9222
TEST_PROFILE = {"name": "테스트", "birth": "19900101", "phone": "01012345678"}


def find_chrome():
    import os
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    local = os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe")
    return local if os.path.exists(local) else None


def main() -> int:
    chrome = find_chrome()
    if not chrome:
        print("SKIP: 크롬을 찾지 못해 검증 생략(크롬 설치 필요).")
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print("SKIP: playwright 미설치 — pip install playwright 후 재시도.")
        return 0

    tmp = tempfile.mkdtemp(prefix="modoo-selftest-")
    proc = subprocess.Popen([chrome, f"--remote-debugging-port={PORT}", f"--user-data-dir={tmp}",
                             "--no-first-run", "--no-default-browser-check", "about:blank"])
    time.sleep(4)
    checks = []

    def check(name, ok, detail=""):
        checks.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
            page = la.get_page(browser)

            # T1: navigator.webdriver=false (Mbuster 통과 조건)
            page.goto("about:blank")
            wd = page.evaluate("() => navigator.webdriver")
            check("T1 진짜 크롬(webdriver=false)", wd is False or wd is None, f"webdriver={wd}")

            # T2: 정부24 로그인 도달(Mbuster 통과)
            page.goto("https://plus.gov.kr/login", wait_until="domcontentloaded", timeout=45000)
            passed = la.wait_mbuster(page, secs=40)
            check("T2 Mbuster 통과 → 로그인 화면", passed, page.url[:50])

            # T3: 간편인증 버튼 클릭
            clicked = False
            try:
                page.locator("button.login-type", has_text="간편인증").first.click(timeout=8000)
                clicked = True
            except Exception as e:
                check("T3 간편인증 클릭", False, str(e)[:40])
            if clicked:
                check("T3 간편인증 클릭", True)

            # T4: simpleCert iframe 등장
            frame = la.simplecert_frame(page)
            check("T4 simpleCert 인증 iframe", bool(frame))

            # T5: 인증 정보 자동입력(이름·생년월일·휴대폰 뒤8자리·전체동의)
            if frame:
                la.fill_auth(frame, TEST_PROFILE)
                name_ok = frame.input_value("#oacx_name") == "테스트"
                birth_ok = frame.input_value("#oacx_birth") == "19900101"
                phone_ok = frame.input_value("#oacx_phone2") == "12345678"
                agree_ok = frame.locator("#totalAgree").is_checked()
                req_ok = frame.locator("#oacx-request-btn-pc").count() > 0
                check("T5 이름 자동입력", name_ok)
                check("T5 생년월일 자동입력", birth_ok)
                check("T5 휴대폰 뒤8자리 자동입력", phone_ok)
                check("T5 전체동의 체크", agree_ok)
                check("T5 '인증 요청' 버튼 존재", req_ok)
    except Exception as e:
        print("ERROR:", e)
        checks.append(False)
    finally:
        try:
            proc.kill()
        except Exception:
            pass

    passed = sum(1 for c in checks if c)
    print(f"\n결과: {passed}/{len(checks)} 통과")
    return 0 if checks and all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
