# -*- coding: utf-8 -*-
"""
모두봄 — '웹/폰에서 바로 서류 자동발급' 원클릭 켜기.

이 한 파일이 다음을 순서대로 자동으로 합니다(수동 4단계 → 더블클릭 1번):
  1) 이 PC를 RPA 서버로 켠다(local_server, 포트 8000, 개인정보 보호 기본값).
  2) cloudflared로 공개 https 주소(https://xxxx.trycloudflare.com)를 자동으로 얻는다.
  3) 그 주소를 VITE_RPA_BASE 로 프론트엔드를 재빌드하고 gh-pages에 배포한다.
  4) 서버·터널을 켠 채 유지한다(이 창을 닫으면 꺼짐).

→ 완료되면 배포 사이트(https://biocode67.github.io/modoo-bom/)에서 방문자가
   '실제 정부24 자동발급 체험/신청'을 바로 할 수 있게 됩니다(본인인증만 폰에서).

전제: (a) backend venv 준비됨  (b) cloudflared 설치(winget install --id Cloudflare.cloudflared
       또는 cloudflared.exe를 저장소 루트에 저장)  (c) frontend에서 `npm run deploy`가 되는 git 인증.
사용: 저장소 루트의  웹자동발급-켜기.bat  더블클릭  (또는  python backend/enable_web_rpa.py)
"""
import os
import re
import subprocess
import sys
import pathlib

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONT = ROOT / "frontend"
TRYCF_RE = re.compile(r"https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com")


def log(msg):
    print(f"[모두봄] {msg}", flush=True)


def pick_python():
    for rel in ("backend/venv-local/Scripts/python.exe", "backend/venv/Scripts/python.exe",
                "backend/venv-local/bin/python", "backend/venv/bin/python"):
        p = ROOT / rel
        if p.exists():
            return str(p)
    return sys.executable


def start_rpa_server():
    env = dict(os.environ)
    env.update({
        "RPA_ENABLED": "1", "RPA_HEADLESS": "1", "RPA_BROWSER_CHANNEL": "chrome",
        "RPA_DELETE_AFTER_DOWNLOAD": "1", "RPA_TASK_TIMEOUT": "1800",
        "PYTHONUTF8": "1", "MODOO_ENV": "server", "HOST": "0.0.0.0", "PORT": "8000",
    })
    log("① RPA 서버를 켭니다 (포트 8000)…")
    return subprocess.Popen(
        [pick_python(), "-m", "uvicorn", "local_server:app", "--host", "0.0.0.0", "--port", "8000"],
        cwd=str(BACKEND), env=env,
    )


def start_tunnel_and_get_url():
    cf = str(ROOT / "cloudflared.exe") if (ROOT / "cloudflared.exe").exists() else "cloudflared"
    log("② 공개 터널(cloudflared)을 엽니다… https 주소를 자동으로 찾습니다.")
    proc = subprocess.Popen(
        [cf, "tunnel", "--url", "http://localhost:8000"],
        cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    url = None
    for line in proc.stdout:
        print("   [tunnel]", line.rstrip(), flush=True)
        m = TRYCF_RE.search(line)
        if m:
            url = m.group(0)
            break
    return proc, url


def deploy(url):
    env = dict(os.environ)
    env["VITE_RPA_BASE"] = url  # vite가 빌드 시 이 값을 읽어 CSP·API 베이스에 반영
    log(f"③ VITE_RPA_BASE={url} 로 재빌드·배포합니다 (npm run deploy)…")
    # Windows에서 npm은 npm.cmd — shell=True로 PATH 해석
    r = subprocess.run("npm run deploy", cwd=str(FRONT), env=env, shell=True)
    return r.returncode == 0


def main():
    log("웹/폰에서 '바로 서류 자동발급'을 켭니다. (이 창을 닫으면 꺼집니다)")
    server = start_rpa_server()
    tunnel = None
    try:
        tunnel, url = start_tunnel_and_get_url()
        if not url:
            log("❌ 공개 https 주소를 찾지 못했습니다. cloudflared 설치를 확인하세요"
                " (winget install --id Cloudflare.cloudflared).")
            return
        log(f"✅ 공개 주소 확보: {url}")
        ok = deploy(url)
        if ok:
            print("\n" + "=" * 62)
            log("🎉 켜졌습니다! 이제 배포 사이트에서 실제 자동발급이 됩니다:")
            log("   https://biocode67.github.io/modoo-bom/  (전파에 1~2분)")
            log("   방문자는 '실제 정부24 자동화'를 바로 쓸 수 있어요(본인인증만 폰).")
            log("   ⚠️ 이 창을 닫지 마세요 — 닫으면 서버·터널이 꺼집니다.")
            print("=" * 62 + "\n")
        else:
            log("⚠️ 배포(npm run deploy)가 실패했습니다. 아래 주소를 VITE_RPA_BASE로 수동 배포하세요:")
            log(f"   VITE_RPA_BASE={url}  →  cd frontend && npm run deploy")
        # 서버·터널을 켠 채 대기(사용자가 창을 닫을 때까지)
        tunnel.wait()
    except KeyboardInterrupt:
        log("종료합니다…")
    finally:
        for p in (tunnel, server):
            try:
                if p:
                    p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
