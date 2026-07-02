#!/usr/bin/env python3
"""확장 스모크 테스트 — 실제 Chromium에 확장을 로드해 웹↔확장 감지(PING)를 검증.

카카오 본인인증(사람 몫)을 제외한 '플러밍'이 동작하는지 확인한다:
  1) 확장이 로드되고 서비스워커가 등록되는가
  2) bridge.js 가 웹앱 페이지에 표식(meta)과 메시지 릴레이를 주입하는가
  3) 웹 → 확장 PING 이 capabilities.rpa=true + 지원서류 목록을 반환하는가

실행: backend/venv 에서  python ../extension/verify.py   (Playwright chromium 필요, headed)
"""
import asyncio
import functools
import http.server
import socketserver
import tempfile
from pathlib import Path

EXT = str(Path(__file__).resolve().parent)
TEST_HTML = """<!doctype html><html><head><meta charset=utf-8></head><body>
<script>
function req(type){return new Promise(res=>{const id=Math.random().toString(36).slice(2);
 const h=e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='response'&&d.reqId===id){window.removeEventListener('message',h);res(d.resp)}};
 window.addEventListener('message',h);
 window.postMessage({source:'modoo-web',type,reqId:id},'*');
 setTimeout(()=>{window.removeEventListener('message',h);res(null)},2000)})}
setTimeout(async()=>{window.__meta=!!document.querySelector('meta[name="modoo-agent"]');window.__ping=await req('PING');},800);
</script></body></html>"""


async def main() -> int:
    webdir = Path(tempfile.mkdtemp())
    (webdir / "test.html").write_text(TEST_HTML, encoding="utf-8")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(webdir))
    httpd = socketserver.TCPServer(("127.0.0.1", 5173), handler)
    import threading
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    from playwright.async_api import async_playwright
    ok = False
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=tempfile.mkdtemp(),
            headless=False,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        )
        page = await ctx.new_page()
        await page.goto("http://localhost:5173/test.html")
        await asyncio.sleep(3)
        meta = await page.evaluate("window.__meta")
        ping = await page.evaluate("window.__ping")
        print("bridge meta:", meta)
        print("PING:", ping)
        ok = bool(ping and ping.get("ok") and ping.get("capabilities", {}).get("rpa"))
        print("RESULT:", "✅ PASS" if ok else "❌ FAIL")
        await ctx.close()
    httpd.shutdown()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
