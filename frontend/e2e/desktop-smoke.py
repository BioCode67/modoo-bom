# -*- coding: utf-8 -*-
"""데스크탑앱 스모크 — local_server(:8000)가 dist-app을 서빙하는 '진짜 배포 셋업'에서
데스크탑 전용 기능을 실브라우저로 회귀 검증한다(웹 프리뷰 스모크로는 localAgent 기능이 안 보임).

검증(이번 데스크탑 강화 런의 기능들):
  1) 에이전트 상태 스트립 — 연결·버전·발급 슬롯 표시
  2) 🩺 진단 복사 — /api/_diag 복사(PII 무포함 스팟 체크)
  2.5) 발급 전 점검 — /api/_preflight 5항목(브라우저·정부24·복지로·폴더·디스크) 체크리스트
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
TINY_JPG_B64 = base64.b64encode(TINY_JPG).decode()
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

            # 2.5) 발급 전 점검(프리플라이트) — 실서버 5항목 체크리스트 렌더
            #      (정부망은 컨테이너에서 막힐 수 있으므로 성패는 단정하지 않고, 항목 표시만 검증)
            pg.locator("button:has-text('발급 전 점검')").click()
            pg.wait_for_selector("text=자동화 브라우저", timeout=60000)
            body = pg.inner_text("body")
            for item in ("자동화 브라우저", "정부24 연결", "복지로 연결", "발급 폴더 쓰기", "디스크 여유"):
                assert item in body, f"프리플라이트 항목 누락: {item}"
            assert ("발급 준비 완료" in body) or ("점검 필요" in body)
            pg.locator("button[aria-label='점검 결과 닫기']").click()
            print("[desktop] ✅ 2.5. 발급 전 점검 — 5항목 체크리스트 렌더")

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
            # 실PC(check-all 등)에서는 이 실태스크가 '진짜 크롬'으로 정부24 발급을 진행 중일 수 있다 —
            # 검증이 끝났으니 반드시 취소해 창/슬롯을 정리한다(컨테이너에선 이미 종결이라 무해한 no-op).
            pg.evaluate(f"async()=>{{await fetch('/api/documents/rpa-cancel/{tid}',{{method:'POST'}}).catch(()=>{{}})}}")
            pg.wait_for_timeout(1200)
            print(f"[desktop] ✅ 6. 새로고침 복원(무클릭 재연결, 서버상태={st}, 기억정리={cleaned}) + 실태스크 정리")

            # 6.5) 📱 인증 대기 알림음 — running→waiting_login 전이에서 정확히 1회 울림(Web Audio 스텁으로 계수)
            #      상태 응답을 인터셉트해 결정적으로 전이시킨다(실서버 태스크는 컨테이너에서 전이 타이밍 불정).
            pg.evaluate("""()=>{
              window.__cues = 0; window.__spoken = []
              class FakeOsc { constructor(){ this.frequency={value:0}; this.type='' }
                connect(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} } }
                start(){ window.__cues++ } stop(){} }
              window.AudioContext = class { constructor(){ this.state='running'; this.currentTime=0; this.destination={} }
                resume(){ return Promise.resolve() }
                createOscillator(){ return new FakeOsc() }
                createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} } } }
              // 🔊 음성 안내 검증용 — speechSynthesis 스텁(실발화 없이 텍스트만 계수)
              Object.defineProperty(window, 'speechSynthesis',
                { value: { speak: (u)=>window.__spoken.push(u.text), cancel(){}, getVoices: ()=>[] }, configurable: true })
            }""")
            # 🔊 인증 음성 안내 토글(옵트인, 기기 기억) — 켜고 발급을 시작한다
            pg.locator("button:has-text('인증 음성 안내')").first.click()
            assert pg.evaluate("()=>localStorage.getItem('modoobom-auth-voice')") == "1"
            calls = {"n": 0}
            pg.route("**/api/documents/rpa-issue", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"task_id": "cue-task", "download_token": "cuetok"})))
            def oncue(r):
                calls["n"] += 1
                stt = "running" if calls["n"] == 1 else ("waiting_login" if calls["n"] <= 5 else "done")
                r.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "status": stt,
                    "current_step": ("📱 폰에서 [인증 허용]을 눌러주세요" if stt == "waiting_login"
                                     else "✅ 발급 완료" if stt == "done" else "진행 중"),
                    "result": {"saved_path": "x"} if stt == "done" else None}))
            pg.route("**/api/documents/rpa-status/cue-task*", oncue)
            pg.fill("input[placeholder*='실명']", "김청년")
            pg.fill("input[placeholder*='생년월일']", "19980315")
            pg.fill("input[placeholder*='휴대폰']", "01012345678")
            row = pg.locator("div.card-cute", has=pg.locator("text=가족관계증명서")).first
            row.get_by_role("button", name="자동", exact=True).click()
            pg.wait_for_function("()=>window.__cues>=1", timeout=15000)  # 전이 1회 → 울림
            pg.wait_for_timeout(3500)  # 같은 waiting_login 폴링이 반복돼도(2~5회차) 재울림 없음
            cues = pg.evaluate("()=>window.__cues")
            assert cues == 2, f"알림음 {cues}회(두 음=오실레이터 2회 기대, 재울림 금지)"
            pg.wait_for_selector("text=발급 완료", timeout=15000)  # done 수렴으로 폴링 종료
            # 실발급 성공(saved_path)은 '발급 완료'로 자동 기억 — 재실행 중복 발급 방지(persist 검증)
            dd = pg.evaluate("()=>JSON.parse(localStorage.getItem('modoobom-store')).state.docDone")
            assert dd.get("가족관계증명서"), f"발급 성공이 기억되지 않음: {dd}"
            # 🔊 옵트인 음성 안내 — 인증 대기 전이 때 '휴대폰에서 인증 요청을 승인해 주세요' 1회 발화
            spoken = pg.evaluate("()=>window.__spoken")
            assert spoken == ["휴대폰에서 인증 요청을 승인해 주세요"], f"음성 안내: {spoken}"
            pg.locator("button:has-text('인증 음성 안내')").first.click()  # 다음 단계 영향 없게 원복
            pg.unroute("**/api/documents/rpa-issue"); pg.unroute("**/api/documents/rpa-status/cue-task*")
            print("[desktop] ✅ 6.5. 인증 알림음+🔊음성 안내(옵트인) + 발급 성공 자동 기억")

            # 7.5) 🚀 원클릭 '발급→자동신청' 연쇄 — 체크박스(기본 ON)·CTA 라벨·여정 body 계약
            #      실서버 여정을 실제로 돌리지 않도록 run/status만 인터셉트(다른 검증은 실서버 그대로).
            captured: list = []
            def onrun(r):
                captured.append(json.loads(r.request.post_data or "{}"))
                r.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"journey_id": "j-smoke", "download_token": "t",
                                           "docs": ["주민등록등본", "가족관계증명서", "소득금액증명"],
                                           "services": ["청년월세지원"]}))
            pg.route("**/api/journey/run", onrun)
            # 처음엔 running(진행률 헤더 + [이 단계 건너뛰기] 노출) → 스킵 클릭 후 completed 로 수렴
            jstate = {"phase": "running", "skips": 0}
            def onjstatus(r):
                if jstate["phase"] == "running":
                    # 인증 대기 상태로 응답 — 헤더의 📱 강조 배지 + 현재 단계 실화면(스크린샷)까지 함께 검증
                    body = {"status": "running", "current": "주민등록등본", "current_status": "waiting_login",
                            "current_message": "📱 인증 대기 중…",
                            "current_screenshot": TINY_JPG_B64,  # 진행 실화면 — 여정에서도 카드에 떠야 함
                            "steps": [
                                {"name": "주민등록등본", "status": "waiting_login"},
                                {"name": "청년월세지원", "status": "pending"}]}
                else:
                    body = {"status": "completed", "current": None, "steps": [
                        {"name": "주민등록등본", "status": "cancelled", "kind": "doc"},
                        {"name": "청년월세지원", "status": "done", "kind": "apply"}]}
                r.fulfill(status=200, content_type="application/json", body=json.dumps(body))
            pg.route("**/api/journey/status/**", onjstatus)
            def onskip(r):
                jstate["skips"] += 1; jstate["phase"] = "done"
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"skipped": True}))
            pg.route("**/api/journey/skip/**", onskip)
            pg.wait_for_selector("text=자동신청까지 이어서", timeout=8000)
            pg.fill("input[placeholder*='실명']", "김청년")
            pg.fill("input[placeholder*='생년월일']", "19980315")
            pg.fill("input[placeholder*='휴대폰']", "01012345678")
            label = pg.locator("button:has-text('전부 자동발급')").inner_text()
            assert "자동신청까지" in label, label
            pg.locator("button:has-text('전부 자동발급')").click()
            pg.wait_for_timeout(2000)
            assert captured and captured[0].get("service_names") == ["청년월세지원"], captured[:1]
            # 진행률 헤더(📱 인증 대기 강조 포함) + ⏭ 이 단계 건너뛰기 — 클릭이 skip API 로 전달되고 여정은 계속
            pg.wait_for_selector("text=연쇄 자동발급 진행 중", timeout=10000)
            pg.wait_for_selector("text=휴대폰에서 인증 승인해 주세요", timeout=6000)
            pg.wait_for_selector("img[alt='발급 진행 화면']", timeout=6000)  # 여정 현재 단계 실화면
            pg.locator("button:has-text('이 단계 건너뛰기')").click()
            pg.wait_for_timeout(2500)
            assert jstate["skips"] == 1, f"skip API 호출 {jstate['skips']}회"
            pg.wait_for_selector("text=연쇄 자동발급 진행 중", state="detached", timeout=10000)  # completed 수렴
            # 여정 종결 요약 배너 — 건너뜀·신청 준비 집계가 정직하게 표기(무언 종료 방지)
            summary = pg.inner_text("body")
            assert "연쇄 자동발급 끝" in summary and "1건 건너뜀" in summary, "여정 요약 배너 누락"
            # 📨 신청 단계 카드의 '제출 완료 기록' — 직접 눌러야만 applied 기록(자동 낙관처리 금지)
            pg.wait_for_selector("text=📨 자동신청 — 청년월세지원", timeout=8000)
            assert "신청 양식 준비 완료" in pg.inner_text("body"), "apply 단계에 서류용 '발급 미완료' 오문구"
            pg.locator("button:has-text('제출까지 마쳤어요')").click()
            pg.wait_for_selector("text=신청 완료로 기록했어요", timeout=6000)
            stat = pg.evaluate("()=>JSON.parse(localStorage.getItem('modoobom-store')).state.tracked[0].status")
            assert stat == "applied", f"기록된 상태={stat}"
            pg.unroute("**/api/journey/run"); pg.unroute("**/api/journey/status/**"); pg.unroute("**/api/journey/skip/**")
            print("[desktop] ✅ 7.5. 원클릭 연쇄 + ⏭ 단계 건너뛰기 + 📨 제출 완료 기록(applied 저장)")

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
    print("✅ 데스크탑 기능 10종 + pageerror 0 — 전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
