# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 스펙 — 모두봄 로컬 에이전트(경량).

번들 내용:
  · agent_entry.py → local_server(FastAPI) + uvicorn
  · rpa/* (실제 RPA) — 지연 import라 hiddenimports로 명시
  · playwright 드라이버(node) — collect_all
  · frontend/dist-app (동일출처 서빙용 정적 프론트) — datas

브라우저는 시스템 Chrome/Edge(channel)을 구동하므로 chromium 바이너리는 번들하지 않는다(용량↓).
⚠️ 이 번들에는 Playwright '브라우저 바이너리'가 없다(node 드라이버만). 그래서 launch_browser 의
   마지막 폴백 ''(번들 chromium)은 **설치본 사용자에겐 사실상 죽은 경로**다. 다만 **Edge 는 Windows
   10/11 에 항상 선탑재**(msedge 채널은 레지스트리 탐지, 바이너리 불필요)라 Chrome 미설치 PC도
   Edge 로 동작한다. Chrome·Edge 둘 다 없는 극단 환경(LTSC/N에디션 등)에서만 자동발급이 불가하며,
   그 경우 launch_browser 가 'playwright install chromium' 안내 예외를 던진다(패키징 스모크가 실기동 검증).
"""
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

# 프론트 정적 번들(동일 출처 서빙) — 실행파일 옆 frontend/dist-app 로 풀림
import os
_here = os.path.abspath(os.getcwd())
_distapp = os.path.join(_here, "..", "frontend", "dist-app")
datas += [(_distapp, "frontend/dist-app")]

# playwright(드라이버 node + package) 전체 수집
_pw = collect_all("playwright")
datas += _pw[0]; binaries += _pw[1]; hiddenimports += _pw[2]

# 지연 import 되는 RPA 모듈 명시(정적 분석이 못 잡음)
hiddenimports += collect_submodules("rpa")
hiddenimports += [
    "rpa.manager", "rpa.config", "rpa.base",
    "rpa.gov24_rpa", "rpa.nhis_rpa", "rpa.work24_rpa", "rpa.apply_rpa",
]
# uvicorn 워커/프로토콜 서브모듈 + [standard] 추가분(지연 import라 collect_submodules가 못 잡음).
# 현재 local_server 엔 WS 라우트가 없어 h11로 폴백돼 생존하지만, 향후 WS 추가/자동 프로토콜 선택 시
# 프로즌 빌드에서만 깨지는 것을 예방(방어적).
hiddenimports += collect_submodules("uvicorn")
hiddenimports += ["websockets", "httptools", "h11", "anyio", "sniffio"]

block_cipher = None

a = Analysis(
    ["agent_entry.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["chromadb", "langchain", "langgraph", "torch", "onnxruntime", "sentence_transformers", "transformers"],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="모두봄-에이전트",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # 콘솔 창(로그/진행 표시) — 데모에서 상태 확인에 유용
    disable_windowed_traceback=False,
    icon="modoobom.ico" if os.path.exists("modoobom.ico") else None,
)
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False, name="모두봄-에이전트",
)
