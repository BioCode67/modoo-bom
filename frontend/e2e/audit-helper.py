# -*- coding: utf-8 -*-
import io as _io, socket, subprocess, sys, time
from pathlib import Path
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
FRONTEND = Path(__file__).resolve().parents[1]; OUT = FRONTEND/"e2e"/"audit"; OUT.mkdir(exist_ok=True)
def fp():
    with socket.socket() as s: s.bind(("127.0.0.1",0)); return s.getsockname()[1]
PORT=fp(); BASE=f"http://localhost:{PORT}/"
def wait(p,t=60):
    e=time.time()+t
    while time.time()<e:
        try:
            with socket.create_connection(("localhost",p),timeout=1): return True
        except OSError: time.sleep(0.5)
    return False
log=open(FRONTEND/"e2e"/"audit.log","w",encoding="utf-8")
if not (FRONTEND/"e2e-dist"/"index.html").exists():
    subprocess.run("npm run build -- --outDir e2e-dist --emptyOutDir --base /",cwd=str(FRONTEND),shell=True,stdout=log,stderr=subprocess.STDOUT)
srv=subprocess.Popen(f"npm run preview -- --outDir e2e-dist --port {PORT} --strictPort",cwd=str(FRONTEND),shell=True,stdout=log,stderr=subprocess.STDOUT)
fails=[]
try:
    if not wait(PORT): print("preview fail"); sys.exit(1)
    from playwright.sync_api import sync_playwright
    # base64url of {"v":1,"profile":{age:72,income_percentile:25,household_type:"1인가구",...},"tracked":[...]}
    import base64, json
    payload={"v":1,"profile":{"name":"","age":72,"gender":"female","region":"서울","household_type":"1인가구","income_percentile":25,"disability":False,"disability_grade":"","employment_status":"","has_children":False,"children_ages":[],"is_pregnant":False,"life_events":[]},"tracked":[{"policyId":"POL-001","name":"기초연금"}]}
    enc=base64.urlsafe_b64encode(json.dumps(payload,ensure_ascii=False).encode()).decode().rstrip("=")
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":950})
        errs=[]; pg.on("pageerror",lambda e: errs.append(str(e)))
        pg.goto(BASE+"#helper="+enc, wait_until="networkidle"); pg.wait_for_timeout(2500)
        try: pg.click('[aria-label="닫기"]',timeout=2000)
        except Exception: pass
        pg.wait_for_timeout(1000)
        body=pg.inner_text("body")
        if "대신 보는 중" in body: print("✅ 도우미 배너 노출")
        else: fails.append("도우미 배너 미노출")
        if "가족이 관심 표시한 복지" in body: print("✅ 공유 목록 표시")
        if "맞춤 추천 복지" in body or "받을 수 있는 복지" in body: print("✅ 재계산 결과 표시")
        else: fails.append("결과 미표시")
        # 해시가 주소창에서 제거됐는지
        url=pg.url
        if "helper=" not in url: print("✅ 해시 제거(재유출 방지)")
        else: fails.append("해시가 URL에 남음")
        if errs: fails.append(f"pageerror {errs[0][:60]}")
        pg.screenshot(path=str(OUT/"43-helper.png"))
        b.close()
finally:
    subprocess.run(f"taskkill /F /T /PID {srv.pid}",shell=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); log.close()
if fails:
    print("❌", *fails, sep="\n  - "); sys.exit(1)
print("🎉 도우미 링크 전 항목 통과")
