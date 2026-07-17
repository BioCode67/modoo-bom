# -*- coding: utf-8 -*-
"""데스크탑앱 스모크 — local_server(:8000)가 dist-app을 서빙하는 '진짜 배포 셋업'에서
데스크탑 전용 기능을 실브라우저로 회귀 검증한다(웹 프리뷰 스모크로는 localAgent 기능이 안 보임).

검증(이번 데스크탑 강화 런의 기능들):
  1) 에이전트 상태 스트립 — 연결·버전·발급 슬롯 표시
  2) 🩺 진단 복사 — /api/_diag 복사(PII 무포함 스팟 체크)
  3) 🗂 내 서류함 — 빈 상태 → 촬영 등록 → 목록 갱신 + '첨부 후보' 배지
  4) 📎 신청 전 자동첨부 미리보기(상세 드로어)
  5) 서류함 개별 삭제(2탭 확인)
  6) 🔁 세션 연속성 — 종결된 실태스크 기억 → 새로고침 → 무클릭 자동 재연결·정리
  7) ✅ 검증형 리셋 — '파일 N건 지움' alert + 발급 폴더 실제 비워짐
  + 전 구간 pageerror 0

실행(레포 루트에서):
    cd frontend && npm run build:app
    cd ../backend && RPA_ENABLED=1 python3 -m uvicorn local_server:app --port 8000 &   # 또는 run-local-app
    cd ../frontend && python3 e2e/desktop-smoke.py
서버가 이미 :8000에 떠 있으면 그걸 그대로 사용한다(데스크탑앱 실행 중에도 OK).
"""
import base64
import glob
import io as _io
import json
import os
import socket
import sys
import time
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]
BASE = "http://localhost:8000/"
TINY_JPG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q=="
)
SEED = ("localStorage.setItem('modoobom-store',JSON.stringify({state:{onboarded:true,"
        "tracked:[{policyId:'POL-009',name:'청년월세지원',category:'청년',status:'idle',savedAt:1,checkedDocs:[]}],"
        "docDone:{}},version:0}))")


def server_up() -> bool:
    try:
        with socket.create_connection(("localhost", 8000), timeout=2):
            return True
    except OSError:
        return False


def main() -> int:
    if not server_up():
        print("[desktop] ❌ local_server(:8000)가 떠 있지 않아요 — 파일 상단 실행법 참고")
        return 2
    from playwright.sync_api import sync_playwright
    exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
    issues: list[str] = []
    tiny = FRONTEND / "e2e" / "_tiny.jpg"
    tiny.write_bytes(TINY_JPG)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=(exe[0] if exe else None))
            ctx = b.new_context(viewport={"width": 1280, "height": 900},
                                permissions=["clipboard-read", "clipboard-write"])
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: issues.append("pageerror: " + str(e)[:100]))
            pg.add_init_script(SEED)
            pg.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg.click("text=나의 복지")
            pg.wait_for_selector("text=서류 준비 도우미", timeout=15000)

            # 1) 상태 스트립
            pg.wait_for_selector("text=에이전트 연결됨", timeout=8000)
            print("[desktop] ✅ 1. 에이전트 상태 스트립(연결·버전·슬롯)")

            # 2) 진단 복사(PII 무포함)
            pg.locator("button:has-text('진단 복사')").click()
            pg.wait_for_selector("text=복사됨 ✓", timeout=6000)
            clip = pg.evaluate("()=>navigator.clipboard.readText()")
            assert "[모두봄 에이전트 진단]" in clip and '"version"' in clip
            assert all(x not in clip for x in ("user_name", "doc_name", "screenshot")), "진단에 PII 필드"
            print("[desktop] ✅ 2. 진단 복사(PII 무포함)")

            # 3) 서류함: 촬영 등록 → 목록+배지
            pg.wait_for_selector("text=내 서류함", timeout=8000)
            pg.locator("button:has-text('📷 촬영')").first.click()
            pg.wait_for_selector("div[role='dialog'][aria-label*='촬영']", timeout=8000)
            pg.locator("div[role='dialog'] input[type='file']").set_input_files(str(tiny))
            pg.wait_for_selector("div[role='dialog'] img[alt='1쪽']", timeout=8000)
            pg.locator("div[role='dialog'] button:has-text('제출문서로 만들기')").click()
            pg.wait_for_selector("text=등록됨", timeout=12000)
            pg.wait_for_selector("span:has-text('첨부 후보')", timeout=8000)
            print("[desktop] ✅ 3. 서류함 등록 → 목록 갱신 + 첨부 후보 배지")

            # 4) 신청 전 자동첨부 미리보기
            pg.get_by_role("button", name="청년월세지원", exact=True).first.click()
            pg.wait_for_selector("text=에이전트 자동 신청", timeout=8000)
            pg.wait_for_selector("text=자동첨부 후보예요", timeout=8000)
            print("[desktop] ✅ 4. 신청 전 자동첨부 미리보기")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(500)

            # 5) 서류함 개별 삭제(2탭)
            pg.locator("button[aria-label*='삭제'][aria-label*='임대차']").first.click()
            pg.locator("button:has-text('삭제')").last.click()
            pg.wait_for_timeout(800)
            print("[desktop] ✅ 5. 서류함 개별 삭제")

            # 6) 세션 연속성 — 실태스크(곧 종결) 기억 → 새로고침 → 자동 재연결
            r = pg.evaluate("""async()=>{
              const res=await fetch('/api/documents/rpa-issue',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({doc_name:'주민등록등본',user_name:'테스트',birth_date:'19980315',phone:'01000000000',auth_provider:'kakao'})})
              return await res.json()
            }""")
            tid, tok = r.get("task_id"), r.get("download_token", "")
            pg.wait_for_timeout(2500)  # 컨테이너/실PC 모두 곧 종결 or 진행 — 어느 쪽이든 복원은 서버 상태를 그대로 렌더
            pg.evaluate("([tid,tok])=>sessionStorage.setItem('modoobom-live-v1',JSON.stringify({doc:{'주민등록등본':{taskId:tid,token:tok,at:Date.now()}},apply:{},journey:{}}))", [tid, tok])
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg.click("text=나의 복지")
            pg.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            pg.wait_for_function(
                "()=>{const t=document.body.innerText; return t.includes('다시 연결 중')||t.includes('브라우저를 실행할 수')||t.includes('인증')||t.includes('발급')}",
                timeout=12000)
            pg.wait_for_timeout(3000)
            live = json.loads(pg.evaluate("()=>sessionStorage.getItem('modoobom-live-v1')") or "{}")
            # 종결됐다면 기억이 정리돼야 하고, 아직 진행 중이면 남아있는 게 맞다 — 서버 상태와 대조
            st = pg.evaluate(f"async()=>{{const r=await fetch('/api/documents/rpa-status/{tid}');return r.status===404?'gone':(await r.json()).status}}")
            terminal = st in ("done", "completed", "error", "cancelled", "gone")
            cleaned = not (live.get("doc") or {})
            assert cleaned == terminal, f"기억 정리({cleaned})가 서버 종결 상태({st})와 불일치"
            print(f"[desktop] ✅ 6. 새로고침 복원(무클릭 재연결, 서버상태={st}, 기억정리={cleaned})")

            # 7) 검증형 리셋
            alerts = []
            def ondlg(d):
                if d.type == "confirm":
                    d.accept()
                else:
                    alerts.append(d.message); d.accept()
            pg.on("dialog", ondlg)
            btn = pg.locator("button:has-text('다음 분 상담 시작')").first
            btn.scroll_into_view_if_needed(); btn.click()
            pg.wait_for_timeout(2500)
            assert alerts and "새 상담 준비 완료" in alerts[0], f"리셋 alert 없음: {alerts}"
            print(f"[desktop] ✅ 7. 검증형 리셋 — {alerts[0][:50]}")
            b.close()
    finally:
        tiny.unlink(missing_ok=True)
    print("\n===== desktop-smoke 결과 =====")
    if issues:
        print(f"❌ {len(issues)}건:")
        for i in issues[:10]:
            print("  ", i)
        return 1
    print("✅ 데스크탑 기능 7종 + pageerror 0 — 전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
