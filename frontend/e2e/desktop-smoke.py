# -*- coding: utf-8 -*-
"""데스크탑앱 스모크 — local_server(:8000)가 dist-app을 서빙하는 '진짜 배포 셋업'에서
데스크탑 전용 기능을 실브라우저로 회귀 검증한다(웹 프리뷰 스모크로는 localAgent 기능이 안 보임).

검증 26종(번호는 추가 순서 — 실행 순서는 코드 순):
  1 상태 스트립 · 2 진단 복사(PII 0) · 2.5 발급 전 점검(6항목·서류함 무결성) · 3 서류함 등록+첨부 후보 배지 · 3.5 🖍 가리기
  4 자동첨부 미리보기 · 5 개별 삭제(2탭) · 5.5 유효기간 배지+📦 ZIP · 5.55 👁 파일 열람 · 5.6 종류별 그룹핑(최신본 대표) · 5.65 🧹 이전 버전 정리 · 5.7 부족분만 발급→📨 자동신청만 · 5.8 자유 선택 일괄발급 · 5.85 🔁 손상 원탭 재발급 · 5.87 🔎 앱 내 실측 확인 · 5.88 후보 칩·자동신청 실측 정직 실패 · 5.9 빈 상태 슬림 모드
  6 새로고침 복원+실태스크 정리 · 6.5 인증 알림음+🔊 음성(옵트인)+발급 자동 기억
  6.8 챗 에이전트 인지 · 6.9 여정 이어보기 · 6.95 인증정보 탭-기억 옵트인
  7.5 원클릭 연쇄+⏭ 스킵+📨 기록 CTA · 7.6 여정 오류 경로(정직 요약) · 7 검증형 리셋 · 8 🌱 새싹이 가이드
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

            # 8) 🌱 새싹이 가이드 — 나의 복지에서 '에이전트 인지' 안내 + 접기/펼치기 + 영구 숨김
            #    (검증 직후 숨겨 이후 체크들의 클릭 경로에 말풍선이 끼어들지 않게 한다)
            pg.wait_for_selector("text=🚀 버튼 하나로", timeout=8000)   # agentOn 상태 인지 문구
            pg.locator("button[aria-label='안내 접기']").click()
            pg.wait_for_selector("text=🚀 버튼 하나로", state="detached", timeout=4000)
            pg.locator("button[aria-label='새싹이 안내 보기']").click()
            pg.wait_for_selector("text=🚀 버튼 하나로", timeout=4000)
            pg.locator("button:has-text('다시 보지 않기')").click()
            pg.wait_for_selector("[aria-label='새싹이 도우미']", state="detached", timeout=4000)
            print("[desktop] ✅ 8. 🌱 새싹이 가이드 — 상태 인지 문구·접기·영구 숨김")

            # 2) 진단 복사(PII 무포함)
            pg.locator("button:has-text('진단 복사')").click()
            pg.wait_for_selector("text=복사됨 ✓", timeout=6000)
            clip = pg.evaluate("()=>navigator.clipboard.readText()")
            assert "[모두봄 에이전트 진단]" in clip and '"version"' in clip
            assert all(x not in clip for x in ("user_name", "doc_name", "screenshot")), "진단에 PII 필드"
            print("[desktop] ✅ 2. 진단 복사(PII 무포함)")

            # 2.5) 발급 전 점검(프리플라이트) — 실서버 6항목 체크리스트 렌더
            #      (정부망은 컨테이너에서 막힐 수 있으므로 성패는 단정하지 않고, 항목 표시만 검증)
            pg.locator("button:has-text('발급 전 점검')").click()
            pg.wait_for_selector("text=자동화 브라우저", timeout=60000)
            body = pg.inner_text("body")
            for item in ("자동화 브라우저", "정부24 연결", "복지로 연결", "발급 폴더 쓰기", "디스크 여유", "서류함 무결성"):
                assert item in body, f"프리플라이트 항목 누락: {item}"
            assert ("발급 준비 완료" in body) or ("점검 필요" in body)
            pg.locator("button[aria-label='점검 결과 닫기']").click()
            print("[desktop] ✅ 2.5. 발급 전 점검 — 6항목 체크리스트 렌더(서류함 무결성 포함)")

            # 3) 서류함: 촬영 등록 → 목록+배지
            pg.wait_for_selector("text=내 서류함", timeout=8000)
            pg.locator("button:has-text('📷 촬영')").first.click()
            pg.wait_for_selector("div[role='dialog'][aria-label*='촬영']", timeout=8000)
            # 400×300 합성 사진(어두운 배경 + 밝은 서류) — 1×1 픽셀론 가리기 드래그·영역 감지를 검증할 수 없다
            big_b64 = pg.evaluate(
                "()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');"
                "x.fillStyle='#2a2a2a';x.fillRect(0,0,400,300);x.fillStyle='#f2f0ea';x.fillRect(60,40,280,220);"
                "return c.toDataURL('image/jpeg',0.9).split(',')[1]}")
            pg.locator("div[role='dialog'] input[type='file']").set_input_files(
                files=[{"name": "doc.jpg", "mimeType": "image/jpeg", "buffer": base64.b64decode(big_b64)}])
            pg.wait_for_selector("div[role='dialog'] img[alt='1쪽']", timeout=8000)

            # 3.5) 🖍 민감정보 가리기 — 드래그로 검정 사각형을 만들어 픽셀을 덮는다(주민번호 뒷자리 등)
            pg.locator("button[aria-label='1쪽 민감정보 가리기']").click()
            pg.wait_for_selector("div[role='dialog'][aria-label='민감정보 가리기']", timeout=6000)
            box = pg.locator("img[alt='가릴 이미지']").bounding_box()
            assert box and box["width"] > 10, "가리기 편집기 이미지 미표시"
            pg.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.35)
            pg.mouse.down()
            pg.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.6, steps=6)
            pg.mouse.up()
            pg.wait_for_selector("button:has-text('가림 적용 (1곳)')", timeout=4000)
            pg.locator("button:has-text('가림 적용 (1곳)')").click()
            pg.wait_for_selector("div[role='dialog'][aria-label='민감정보 가리기']", state="detached", timeout=4000)
            print("[desktop] ✅ 3.5. 🖍 민감정보 가리기 — 드래그 마스킹 적용(픽셀 덮어쓰기)")

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

            # 5.5) 🗂 서류함 지능화 — 유효기간 배지(발급 3개월 경과) + 📦 묶음 받기(ZIP)
            #      서버의 실제 발급 폴더를 목록 API의 folder 필드로 알아내 '95일 지난 발급형' 파일을 심는다.
            folder = pg.evaluate("async()=>(await (await fetch('/api/documents/list')).json()).folder")
            aged = Path(folder) / "주민등록등본_스모크_2026-04-01_1000.pdf"
            aged.write_bytes(b"%PDF-1.4 smoke")
            _old = time.time() - 95 * 86400
            os.utime(aged, (_old, _old))
            fresh = Path(folder) / "가족관계증명서_스모크_2026-07-18_1000.pdf"
            fresh.write_bytes(b"%PDF-1.4 smoke2")
            try:
                pg.locator("button[aria-label='서류함 새로고침']").click()
                pg.wait_for_selector("text=3개월 지남", timeout=8000)          # stale 배지
                pg.wait_for_selector("text=재발급이 필요할 수 있어요", timeout=4000)  # 요약 경고(정직 문구)
                with pg.expect_download(timeout=10000) as dl:
                    pg.locator("button:has-text('묶음 받기')").click()
                d = dl.value
                assert d.suggested_filename.startswith("신청서류_") and d.suggested_filename.endswith(".zip"), d.suggested_filename
                print("[desktop] ✅ 5.5. 서류함 지능화 — 3개월 경과 배지 + 묶음 받기(ZIP)")
                # 5.55) 👁 파일 열람 — 발급물을 앱에서 바로 확인(inline PDF + 이탈 가드)
                vr = pg.evaluate(
                    "async()=>{const r=await fetch('/api/documents/file?name='+encodeURIComponent('가족관계증명서_스모크_2026-07-18_1000.pdf'));"
                    "return r.status+'|'+(r.headers.get('content-type')||'')}")
                assert vr.startswith("200|application/pdf"), f"파일 열람 실패: {vr}"
                bad = pg.evaluate("async()=>(await fetch('/api/documents/file?name=..%2Fetc%2Fpasswd')).status")
                assert bad == 400, f"경로 이탈이 차단되지 않음: {bad}"
                pg.wait_for_selector("a[aria-label*='보기']", timeout=4000)  # 행마다 👁 버튼
                print("[desktop] ✅ 5.55. 👁 발급물 바로 열람 — inline 서빙 + 이탈 가드 + 행 버튼")
                # 5.6) 종류별 그룹핑 — 같은 서류를 재발급하면 최신본이 대표, 이전본은 접힘
                fresh2 = Path(folder) / "주민등록등본_스모크_2026-07-19_0900.pdf"
                fresh2.write_bytes(b"%PDF-1.4 smoke3")
                pg.locator("button[aria-label='서류함 새로고침']").click()
                pg.wait_for_selector("text=이전 버전 1건 보기", timeout=8000)
                assert pg.locator("text=3개월 지남").count() == 0, "접힌 상태에서 이전본 배지가 보이면 그룹핑 실패"
                pg.locator("text=이전 버전 1건 보기").click()
                pg.wait_for_selector("text=3개월 지남", timeout=4000)   # 펼치면 이전본(95일 경과)+배지 노출
                pg.wait_for_selector("text=이전 버전", timeout=2000)
                print("[desktop] ✅ 5.6. 서류함 그룹핑 — 최신본 대표 + 이전 버전 접기/펼치기")
                # 5.65) 🧹 이전 버전 일괄 정리 — 최신본만 남기고 지난 발급본 삭제(confirm 승인 후 실파일 검증)
                pg.once("dialog", lambda d: d.accept())
                pg.locator("button:has-text('이전 버전 정리')").click()
                pg.wait_for_selector("button:has-text('이전 버전')", state="detached", timeout=8000)
                assert not aged.exists(), "이전 버전 파일이 실제로 삭제되지 않음"
                assert fresh2.exists(), "최신본이 지워짐(정리 범위 오류)"
                print("[desktop] ✅ 5.65. 🧹 이전 버전 정리 — 최신본 보존·이전본만 삭제(실파일 검증)")
            finally:
                aged.unlink(missing_ok=True)
                fresh.unlink(missing_ok=True)
                (Path(folder) / "주민등록등본_스모크_2026-07-19_0900.pdf").unlink(missing_ok=True)
            pg.locator("button[aria-label='서류함 새로고침']").click()
            # 5.65의 🧹가 docs-changed 로 vaultHave 를 갱신해두므로, 파일 정리 후에도 같은 이벤트로
            # '보유 0' 상태를 재동기화해야 5.7 시작 조건(3종 전부)이 성립한다
            pg.evaluate("() => window.dispatchEvent(new Event('modoobom:docs-changed'))")
            pg.wait_for_timeout(500)

            # 5.7) 🧾 신청 준비도 인텔리전스 — 서류함 실파일 기준 '부족분만 발급' + '자동신청만 진행'
            #      청년월세지원 자동발급 3종(등본·가족관계·소득금액) 중 보유분만큼 연쇄 대상이 줄어야 한다.
            notify = "() => window.dispatchEvent(new Event('modoobom:docs-changed'))"
            pg.wait_for_selector("text=3종 전부 자동발급", timeout=8000)  # 시작 상태(보유 0)
            f1 = Path(folder) / "주민등록등본_스모크_2026-07-18_1100.pdf"
            f1.write_bytes(b"%PDF-1.4 s1")
            try:
                pg.evaluate(notify)
                pg.wait_for_selector("text=부족한 서류 2종만 자동발급", timeout=8000)
                pg.wait_for_selector("text=건너뛰어요", timeout=4000)  # 스마트 스킵 가시화 문구
                f2 = Path(folder) / "가족관계증명서_스모크_2026-07-18_1100.pdf"
                f3 = Path(folder) / "소득금액증명_스모크_2026-07-18_1100.pdf"
                f2.write_bytes(b"%PDF-1.4 s2"); f3.write_bytes(b"%PDF-1.4 s3")
                pg.evaluate(notify)
                pg.wait_for_selector("text=자동신청만 진행", timeout=8000)  # 서류 완비 → 📨 경로
                # 인증정보 미입력 상태에서 클릭 → 여정을 시작하지 않고 정직한 안내 + 폼 포커스 유도
                pg.locator("button:has-text('자동신청만 진행')").click()
                pg.wait_for_selector("text=실명·생년월일·휴대폰을 먼저 입력", timeout=4000)
                print("[desktop] ✅ 5.7. 준비도 인텔리전스 — 부족분만 발급·완비 시 자동신청만(+미입력 가드)")
            finally:
                for f in (f1, Path(folder) / "가족관계증명서_스모크_2026-07-18_1100.pdf",
                          Path(folder) / "소득금액증명_스모크_2026-07-18_1100.pdf"):
                    f.unlink(missing_ok=True)
            pg.evaluate(notify)
            pg.wait_for_selector("text=3종 전부 자동발급", timeout=8000)  # 원복(상태 잔류 없음)

            # 5.8) 🗂 자유 선택 일괄발급 — 지원 그리드(서버 지원목록과 동수: 동적 커버리지 배선 검증)·
            #      부족분 기본 선택·미입력 가드(여정 미시작)
            import urllib.request as _url
            _sup = json.loads(_url.urlopen(f"{BASE.rstrip('/')}/api/documents/rpa-supported", timeout=5).read())
            n_server = len(_sup.get("supported", []))
            assert n_server >= 15, f"서버 지원 서류 수 비정상: {n_server}"
            pg.locator("button:has-text('골라 한번에 발급')").click()
            pg.wait_for_selector("text=원하는 서류 골라 일괄발급", timeout=6000)
            n_boxes = pg.locator("input.accent-sky2-600").count()
            assert n_boxes == n_server, f"패널 서류 수({n_boxes}) ≠ 서버 지원목록({n_server}) — 동적 배선 회귀"
            pg.wait_for_selector("button:has-text('선택한 3종 한번에 발급')", timeout=4000)  # 부족 3종이 기본 선택
            pg.locator("label:has-text('병적증명서') input").check()
            pg.wait_for_selector("button:has-text('선택한 4종 한번에 발급')", timeout=4000)
            pg.locator("button:has-text('선택한 4종 한번에 발급')").click()
            pg.wait_for_selector("text=실명·생년월일·휴대폰을 먼저 입력", timeout=4000)  # 가드 — 여정 미시작
            pg.locator("button[aria-label='일괄발급 선택 닫기']").click()
            print("[desktop] ✅ 5.8. 자유 선택 일괄발급 — 15종 그리드·부족분 기본 선택·미입력 가드")

            # 5.85) 🔁 손상 파일 원탭 재발급 — ⚠️ 배지→[지우고 다시 발급]: 손상본 삭제 + 같은 서류 자동발급 시작
            #       (인증정보 미입력 상태라 발급은 카드 밖 상태줄의 정직한 안내로 멈춘다 — 가드까지 한 번에 검증)
            broken = Path(folder) / "지방세 납세증명서_스모크_2026-07-19_1200.pdf"
            broken.write_bytes(b"broken")  # 1KB 미만 — 무결성 게이트 위반(잘린 저장 재현)
            try:
                pg.locator("button[aria-label='서류함 새로고침']").click()
                pg.wait_for_selector("span:has-text('⚠️ 손상')", timeout=8000)
                pg.once("dialog", lambda d: d.accept())
                pg.locator("button:has-text('지우고 다시 발급')").click()
                pg.wait_for_selector("text=지방세 납세증명서 — 실명·생년월일·휴대폰", timeout=8000)
                for _ in range(20):
                    if not broken.exists():
                        break
                    time.sleep(0.3)
                assert not broken.exists(), "손상 파일이 삭제되지 않음"
            finally:
                broken.unlink(missing_ok=True)
            print("[desktop] ✅ 5.85. 🔁 손상 원탭 재발급 — 손상본 삭제 + 발급 시작(미입력 가드)")

            # 5.87) 🔎 앱 내 커버리지 실측 확인 — 서류명 하나로 정부24 실측→β 등록(재시작 불필요).
            #       컨테이너는 정부망이 막혀 있으므로 '진행 표시 → 정직한 실패 보고 + 미등록'까지가 검증 대상
            #       (성공 등록 경로는 pytest test_probe_runtime 이 스텁으로 고정).
            if pg.locator("input[aria-label='실측 확인할 서류 이름']").count() == 0:
                pg.locator("button:has-text('골라 한번에 발급')").click()
            pg.wait_for_selector("input[aria-label='실측 확인할 서류 이름']", timeout=6000)
            pg.fill("input[aria-label='실측 확인할 서류 이름']", "혼인관계증명서")
            pg.locator("button:has-text('실측 확인')").click()
            pg.wait_for_selector("text=실측 확인 중", timeout=8000)      # 진행 상태(개인정보 미사용 명시)
            pg.wait_for_selector("text=실패", timeout=90000)             # 정부망 차단 → 실패를 실패로
            _sup2 = json.loads(_url.urlopen(f"{BASE.rstrip('/')}/api/documents/rpa-supported", timeout=5).read())
            assert "혼인관계증명서" not in _sup2.get("supported", []), "실측 실패인데 등록됨 — 날조 게이트 붕괴"
            print("[desktop] ✅ 5.87. 🔎 앱 내 실측 확인 — 진행 표시 + 실패 정직 보고(미등록)")

            # 5.88) 🔎 실측 후보 칩 + 일괄 버튼 렌더 + 자동신청 실측 API의 정직 실패
            #       (복지로도 컨테이너에선 차단 — 후보 발굴 실패가 'error'로 그대로 보고돼야 한다)
            pg.wait_for_selector("button:has-text('한번에 실측')", timeout=8000)   # 후보 칩 로드
            assert pg.locator("button:has-text('혼인관계증명서')").count() >= 1, "후보 칩 미렌더"
            _req = _url.Request(f"{BASE.rstrip('/')}/api/apply/probe",
                                data=json.dumps({"service_name": "경기 청년기본소득"}).encode(),
                                headers={"Content-Type": "application/json"})
            _aj = json.loads(_url.urlopen(_req, timeout=90).read())
            assert _aj.get("status") == "error", f"복지로 차단인데 status={_aj.get('status')} — 날조 게이트 붕괴"
            print("[desktop] ✅ 5.88. 🔎 후보 칩·일괄 버튼 + 자동신청 실측 정직 실패(error)")

            # 5.9) 담은 복지 0 슬림 모드 — 심사·첫 사용이 빈 화면에서 끝나지 않는다(발급 도우미+15종 패널+서류함)
            pg2 = ctx.new_page()
            pg2.add_init_script(
                "localStorage.setItem('modoobom-store',JSON.stringify({state:{onboarded:true,tracked:[],docDone:{}},version:0}));"
                "localStorage.setItem('modoobom-guide-off','1')")
            pg2.goto(BASE, wait_until="domcontentloaded", timeout=30000)
            pg2.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg2.click("text=나의 복지")
            pg2.wait_for_selector("text=아직 담은 복지가 없어요", timeout=15000)
            pg2.wait_for_selector("text=서류 발급 도우미", timeout=10000)          # 슬림 모드 헤더
            pg2.wait_for_selector("text=원하는 서류 골라 일괄발급", timeout=8000)   # 패널 자동 펼침
            assert pg2.locator("input.accent-sky2-600").count() == n_server, "슬림 모드 지원 그리드 수 불일치(동적 배선)"
            pg2.wait_for_selector("text=내 서류함", timeout=8000)                  # 서류함도 동작
            pg2.close()
            print("[desktop] ✅ 5.9. 슬림 모드 — 담은 복지 0에서도 발급 도우미·15종 패널·서류함 동작")

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

            # 6.8) 💬 챗 에이전트 데스크탑 인지 — 서류 질문에 자동화 경로([전부 자동발급])를 안내하는지
            pg.locator("button[aria-label='복지 도우미 챗봇 열기']").click()
            pg.wait_for_selector("div[role='dialog'][aria-label='복지 도우미 챗봇']", timeout=8000)
            pg.fill("input[aria-label='질문 입력']", "서류 어떻게 발급해?")
            pg.keyboard.press("Enter")
            pg.wait_for_selector("text=전부 자동발급", timeout=10000)  # agentOn 분기 응답
            pg.locator("button[aria-label='복지 도우미 챗봇 닫기']").click()
            pg.wait_for_timeout(400)
            print("[desktop] ✅ 6.8. 챗 에이전트 데스크탑 인지(자동화 경로 안내)")

            # 6.9) 🔁 여정(연쇄) 이어보기 — 새로고침 후 무클릭 재연결(플래그십 복원, 인터셉트 결정적)
            pg.route("**/api/journey/status/**", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"status": "running", "current": "소득금액증명", "current_status": "running",
                                 "current_message": "정부24에서 발급 진행 중…", "steps": [
                                     {"name": "소득금액증명", "status": "running", "kind": "doc"}]})))
            pg.evaluate("()=>sessionStorage.setItem('modoobom-live-v1',JSON.stringify({doc:{},apply:{},"
                        "journey:{current:{taskId:'j-resume',token:'t',docs:['소득금액증명'],at:Date.now()}}}))")
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg.click("text=나의 복지")
            pg.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            pg.wait_for_selector("text=연쇄 자동발급 진행 중", timeout=15000)  # 무클릭 헤더 복원
            assert "소득금액증명" in pg.inner_text("body")
            # 종결로 전환해 폴링을 닫고 다음 단계로(기억 정리까지)
            pg.unroute("**/api/journey/status/**")
            pg.route("**/api/journey/status/**", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"status": "cancelled", "current": None, "steps": [
                    {"name": "소득금액증명", "status": "cancelled", "kind": "doc"}]})))
            pg.wait_for_selector("text=연쇄 자동발급 진행 중", state="detached", timeout=10000)
            pg.unroute("**/api/journey/status/**")
            print("[desktop] ✅ 6.9. 여정 이어보기 — 새로고침 후 무클릭 재연결(헤더·카드 복원)")

            # 6.95) 🔁 인증정보 '이 탭에서는 기억'(옵트인) — 발표·상담 중 F5 실수에도 폼 복원,
            #       끄면(옵트아웃) sessionStorage 보관분까지 즉시 삭제(흔적 미잔류 계약)
            pg.locator("label:has-text('이 탭에서는 기억하기') input").check()
            pg.fill("input[placeholder*='실명']", "김기억")
            pg.wait_for_timeout(300)  # keep effect가 sessionStorage에 반영될 시간
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_selector("text=정부·지자체·민간 복지", timeout=20000)
            pg.click("text=나의 복지")
            pg.wait_for_selector("text=서류 준비 도우미", timeout=15000)
            assert pg.locator("label:has-text('이 탭에서는 기억하기') input").is_checked(), "옵트인 상태 미복원"
            pg.wait_for_function(  # 마운트 후 hydrate effect가 채울 때까지(레이스 방지)
                "() => document.querySelector(\"input[placeholder*='실명']\")?.value === '김기억'", timeout=5000)
            pg.locator("label:has-text('이 탭에서는 기억하기') input").uncheck()
            assert pg.evaluate("()=>sessionStorage.getItem('modoobom-rpainfo-session')") is None, "옵트아웃 후 보관분 잔류"
            print("[desktop] ✅ 6.95. 인증정보 탭-기억 옵트인 — F5 복원 + 옵트아웃 흔적 삭제")

            # 7.6) 여정 '오류' 경로 — 정부 사이트 불통 시에도 정직한 오류 요약 + 재시도 CTA가 남는지
            #      (실사용자가 실제로 만나는 경로 — 가짜 성공·무언 종료·막다른 UI가 없어야 한다)
            pg.route("**/api/journey/run", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"journey_id": "j-err", "download_token": "t2",
                                 "docs": ["주민등록등본", "소득금액증명"], "services": []})))
            pg.route("**/api/journey/status/**", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"status": "error", "current": None, "steps": [
                    {"name": "주민등록등본", "status": "error", "kind": "doc", "error": "정부24가 응답하지 않아요 — 잠시 후 다시 시도해 주세요."},
                    {"name": "소득금액증명", "status": "cancelled", "kind": "doc"}]})))
            # 6.95의 옵트아웃 상태 — 폼에 값이 남아 있어도(메모리) 아래에서 새로 채워 정확한 전제로 시작
            pg.fill("input[placeholder*='실명']", "김청년")
            pg.fill("input[placeholder*='생년월일']", "19980315")
            pg.fill("input[placeholder*='휴대폰']", "01012345678")
            pg.locator("button:has-text('전부 자동발급')").click()
            pg.wait_for_selector("text=연쇄가 오류로 끝났어요", timeout=10000)   # 종결 요약(정직 오류)
            body2 = pg.inner_text("body")
            assert "정부24가 응답하지 않아요" in body2, "단계 카드에 오류 원인 미표시"
            assert pg.locator("button:has-text('전부 자동발급')").count() > 0, "재시도 CTA 소실(막다른 UI)"
            pg.unroute("**/api/journey/run"); pg.unroute("**/api/journey/status/**")
            print("[desktop] ✅ 7.6. 여정 오류 경로 — 정직한 요약·원인 표시·재시도 CTA 유지")

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
    print("✅ 데스크탑 기능 26종 + pageerror 0 — 전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
