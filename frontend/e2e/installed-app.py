# -*- coding: utf-8 -*-
"""배포 실행파일(PyInstaller) 패키징 스모크 — 실제 exe가 뜨고 서빙·RPA 준비되는지.

유닛/소스 e2e가 못 잡는 '번들 누락'(hiddenimport 빠짐·dist-app 미포함 등) 회귀를 잡는다.
exe가 빌드돼 있지 않으면(dist/모두봄-에이전트/) 정보만 남기고 통과(스킵) — CI 없이도 무해.

실행: frontend> python e2e/installed-app.py   (또는 build-installer.bat 마지막 단계)
"""
import io as _io
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BACKEND = Path(__file__).resolve().parents[2] / "backend"
EXE = BACKEND / "dist" / "모두봄-에이전트" / "모두봄-에이전트.exe"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(port: int, path: str, timeout: float = 2):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main() -> int:
    if not EXE.exists():
        print(f"[e2e:exe] ⏭  실행파일 미빌드 — 스킵 (빌드: build-installer.bat)\n         기대 경로: {EXE}")
        return 0

    port = free_port()
    env = dict(os.environ, RPA_ENABLED="1", PORT=str(port), HOST="127.0.0.1")
    print(f"[e2e:exe] 실행파일 기동(:{port}) … {EXE.name}")
    proc = subprocess.Popen([str(EXE)], env=env, cwd=str(EXE.parent),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # 헬스 대기(최대 25초 — PyInstaller 콜드 부팅 여유)
        ok = False
        end = time.time() + 25
        while time.time() < end:
            try:
                st, _ = get(port, "/api/health", 1)
                if st == 200:
                    ok = True
                    break
            except Exception:
                time.sleep(0.5)
        if not ok:
            print("[e2e:exe] ❌ 실행파일이 헬스에 응답하지 않음")
            return 1

        import json
        _, health = get(port, "/api/health")
        caps = json.loads(health)["capabilities"]
        _, root = get(port, "/")
        _, supported = get(port, "/api/documents/rpa-supported")
        n_docs = len(json.loads(supported).get("supported", []))

        checks = [
            ("health mode=local-agent", json.loads(health)["mode"] == "local-agent"),
            ("capabilities.rpa=true", caps["rpa"] is True),
            ("동일출처 프론트 서빙(/)", "<!doctype html" in root.lower() or "<html" in root.lower()),
            ("RPA 지원목록 노출", "주민등록등본" in supported),
            # 번들에 rpa 모듈이 온전히 포함됐는지 — 지원 서류가 6종 미만이면 RPA 모듈 누락 의심(패키징 회귀).
            (f"RPA 지원 서류 충분({n_docs}종)", n_docs >= 6),
        ]
        ok = all(v for _, v in checks)
        for name, v in checks:
            print(f"   {'✅' if v else '❌'} {name}")
        if not ok:
            print("[e2e:exe] ❌ 패키징 스모크 실패 — 번들 누락 의심")
            return 1
        print("[e2e:exe] ✅ 실행파일 패키징 스모크 통과(뜨고·서빙·RPA 준비)")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
