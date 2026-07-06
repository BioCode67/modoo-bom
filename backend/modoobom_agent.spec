# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 스펙 — 모두봄 로컬 에이전트(경량).

번들 내용:
  · agent_entry.py → local_server(FastAPI) + uvicorn
  · rpa/* (실제 RPA) — 지연 import라 hiddenimports로 명시
  · playwright 드라이버(node) — collect_all
  · frontend/dist-app (동일출처 서빙용 정적 프론트) — datas

브라우저는 시스템 Chrome(channel=chrome)을 구동하므로 chromium 바이너리는 번들하지 않는다
(용량↓). Chrome 미설치 사용자는 setup-local.bat 의 `playwright install chromium` 폴백 사용.
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
# uvicorn 워커/프로토콜 서브모듈
hiddenimports += collect_submodules("uvicorn")

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
)
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False, name="모두봄-에이전트",
)
