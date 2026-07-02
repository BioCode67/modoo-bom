#!/usr/bin/env python3
"""실사이트 셀렉터 검증 하네스 (opt-in) — 본인인증 '직전'까지만.

확장을 실제 Chromium에 로드하고, 웹앱 트리거로 정부24 서류발급 잡을 시작해
자동화가 실제 정부24 로그인 페이지에서 '간편인증'을 클릭하는 데까지 도달하는지 확인한다.
※ 실제 카카오 본인인증은 하지 않는다(사람 몫). 더미 이름만 사용, 개인정보 미사용.
※ 실 정부서버에 붙으므로 데모 준비용으로 가끔만 실행. DOM 변경 시 셀렉터 보정 지표로 사용.

실행: backend venv 에서  python ../extension/validate_live.py [서류명]
"""
import asyncio
import functools
import http.server
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

EXT = str(Path(__file__).resolve().parent)
DOC = sys.argv[1] if len(sys.argv) > 1 else "주민등록등본"
# 두 번째 인자가 'apply' 면 복지 자동신청(복지로) 검증
MODE = sys.argv[2] if len(sys.argv) > 2 else "issue"
APPLY_URL = sys.argv[3] if len(sys.argv) > 3 else ""
_TYPE = "APPLY" if MODE == "apply" else "ISSUE"
_KEY = "serviceName" if MODE == "apply" else "docName"
_EXTRA = (",applyUrl:'%s'" % APPLY_URL) if APPLY_URL else ""

PAGE = """<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
window.__statuses=[];
window.addEventListener('message',e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='status')window.__statuses.push(d.payload);});
function req(type,payload){return new Promise(res=>{const id=Math.random().toString(36).slice(2);
 const h=e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='response'&&d.reqId===id){window.removeEventListener('message',h);res(d.resp)}};
 window.addEventListener('message',h);window.postMessage({source:'modoo-web',type,payload,reqId:id},'*');
 setTimeout(()=>res(null),3000)})}
setTimeout(async()=>{window.__issue=await req('%s',{%s:'%s'%s,userInfo:{user_name:'홍길동'}});},600);
</script></body></html>""" % (_TYPE, _KEY, DOC, _EXTRA)


async def main() -> int:
    webdir = Path(tempfile.mkdtemp())
    (webdir / "t.html").write_text(PAGE, encoding="utf-8")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(webdir))
    httpd = socketserver.TCPServer(("127.0.0.1", 5173), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=tempfile.mkdtemp(), headless=False,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        )
        page = await ctx.new_page()
        await page.goto("http://localhost:5173/t.html")
        print(f"[검증] '{DOC}' 발급 잡 시작 — 실제 정부사이트 로딩 대기(최대 40초)…")
        gov_url = None
        for _ in range(40):
            await asyncio.sleep(1)
            for p in ctx.pages:
                if any(k in p.url for k in ("plus.gov.kr", "gov.kr", "nhis.or.kr", "work24.go.kr", "bokjiro.go.kr", "nps.or.kr", "kosaf.go.kr")):
                    gov_url = p.url
            sts = await page.evaluate("window.__statuses || []")
            if any(any(k in s.get("step", "") for k in ("간편인증을 선택", "카카오", "자동 입력", "인증 요청")) for s in sts):
                print("[검증] ✅ 자동화가 실제 사이트에서 '간편인증' 클릭까지 도달")
                break
        sts = await page.evaluate("window.__statuses || []")
        print("[검증] 열린 정부 URL:", gov_url or "(감지 안 됨)")
        print("[검증] 수신 상태들:")
        for s in sts:
            print("   -", s.get("status"), "|", s.get("step", "")[:70])
        reached = any(any(k in s.get("step", "") for k in ("간편인증을 선택", "카카오", "자동 입력", "인증 요청")) for s in sts)
        print("[검증] 결과:", "✅ 인증 단계 도달(간편인증 클릭 성공)" if reached
              else "⚠️ 인증 단계 미도달 — 사이트 로딩 지연이거나 DOM 변경(셀렉터 보정 필요)")
        await ctx.close()
    httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
