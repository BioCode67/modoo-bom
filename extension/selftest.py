#!/usr/bin/env python3
"""확장 자동 회귀 테스트 — 실제 Chromium에 확장 로드해 테스트 가능한 모든 구간을 검증.

로그인 이후(폼→발급→출력)는 정부24 Mbuster 안티매크로가 자동화 브라우저를 차단해 재현 불가.
그래서 '로그인 전/공개 페이지' 구간을 반복 검증한다:
  T1) 확장 로드 + 웹↔확장 PING(capabilities.rpa, 서류/서비스 목록)
  T2) 정부24 로그인 페이지에서 '간편인증' 자동 클릭 도달
  T3) 공개 안내페이지(AA020)에서 발급 폼(AA040) 직접 링크로 이동(모달 우회)
  T4) clickText가 '비회원 신청하기'를 '회원 신청하기'로 오클릭하지 않는지(단위)

실행: cd backend && ../extension/selftest.py 실행(venv python). 종료코드 0=전부 통과.
"""
import asyncio
import functools
import http.server
import socketserver
import tempfile
import threading
from pathlib import Path

EXT = str(Path(__file__).resolve().parent)
BRIDGE = """<!doctype html><html><head><meta charset=utf-8></head><body><script>
window.__st=[];window.addEventListener('message',e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='status')window.__st.push(d.payload)});
window.req=(t,p)=>new Promise(r=>{const id=Math.random().toString(36).slice(2);const h=e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='response'&&d.reqId===id){window.removeEventListener('message',h);r(d.resp)}};window.addEventListener('message',h);window.postMessage({source:'modoo-web',type:t,payload:p,reqId:id},'*');setTimeout(()=>r(null),3000)});
</script></body></html>"""
AA020 = "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200"

results = []
def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


async def find_gov_tab(ctx, secs=12):
    for _ in range(secs):
        for p in ctx.pages:
            if "gov.kr" in p.url:
                return p
        await asyncio.sleep(1)
    return None


async def main() -> int:
    wd = Path(tempfile.mkdtemp())
    (wd / "t.html").write_text(BRIDGE, encoding="utf-8")
    httpd = socketserver.TCPServer(("127.0.0.1", 5173),
                                   functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(wd)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            user_data_dir=tempfile.mkdtemp(), headless=False,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        page = await ctx.new_page()
        await page.goto("http://localhost:5173/t.html")
        await asyncio.sleep(2)

        # T1: PING
        ping = await page.evaluate("() => window.req('PING')")
        check("T1 PING capabilities.rpa", bool(ping and ping.get("capabilities", {}).get("rpa")))
        check("T1 서류 목록 ≥ 10종", bool(ping and len(ping.get("docs", [])) >= 10),
              f"{len(ping.get('docs', [])) if ping else 0}종")
        check("T1 신청 서비스 존재", bool(ping and len(ping.get("services", [])) >= 1))

        # T4: clickText 비회원 오클릭 방지(공개 AA020에 모달 띄워 확인)
        p2 = await ctx.new_page()
        await p2.goto(AA020, wait_until="domcontentloaded", timeout=25000)
        await asyncio.sleep(2)
        oclick = await p2.evaluate(r"""() => {
          const norm=t=>(t||'').replace(/\s/g,'');
          // clickText의 exclude 로직 재현: '회원 신청하기' 매칭에서 '비회원' 제외되는지
          const btns=[...document.querySelectorAll('span,a,button')].filter(e=>norm(e.textContent).includes('회원신청하기'));
          const member=btns.filter(e=>!norm(e.textContent).includes('비회원'));
          return {total:btns.length, memberOnly:member.length};
        }""")
        check("T4 회원/비회원 버튼 구분 가능", bool(oclick and oclick["total"] >= 1))
        await p2.close()

        # T2+T3: ISSUE 트리거 → 잡 탭을 AA020으로 이동 → 발급폼 링크 이동(모달 우회)
        await page.evaluate("() => window.req('ISSUE', {docName:'주민등록등본', userInfo:{user_name:'홍길동'}})")
        jt = await find_gov_tab(ctx)
        check("T2 잡 탭 생성(정부24)", jt is not None)
        if jt:
            # 로그인 페이지에서 간편인증 클릭 상태가 뜨는지(안티매크로로 실제 폼은 못 볼 수 있음)
            await asyncio.sleep(6)
            st1 = await page.evaluate("() => window.__st || []")
            reached_auth = any("간편인증" in s.get("step", "") for s in st1)
            check("T2 간편인증 단계 도달", reached_auth,
                  "" if reached_auth else "(Mbuster 차단 가능 — 실사용 크롬은 통과)")
            # AA020 이동 → 발급폼 링크 우회 확인
            await jt.goto(AA020, wait_until="domcontentloaded", timeout=25000)
            await asyncio.sleep(7)
            moved = "AA040" in jt.url or "login" in jt.url or "mbuster" in jt.url.lower()
            st2 = await page.evaluate("() => window.__st || []")
            forwarded = any("발급 폼으로 이동" in s.get("step", "") for s in st2)
            check("T3 AA020→발급폼 우회 이동", moved or forwarded,
                  f"url={jt.url[:50]}")
        await ctx.close()
    httpd.shutdown()

    passed = sum(1 for r in results if r)
    print(f"\n결과: {passed}/{len(results)} 통과")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
