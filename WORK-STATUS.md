# 작업 현황 인수인계 (2026-07-01, 새 윈도우 랩PC)

> 이 파일은 **다른 Claude 세션(터미널/폰 원격)** 이 오늘 작업을 이어받기 위한 메모다.
> 먼저 이 파일 → `CLAUDE.md` 순으로 읽고 이어서 진행하면 된다.

## 실행 방법 (윈도우, 무관리자 설치본)
- **한 번에 실행:** 프로젝트 루트의 **`run-windows.bat` 더블클릭** → 백엔드(:8000) + 프론트(:5173) 새 창 기동.
- 런타임(이미 설치됨): Node(포터블) `%LOCALAPPDATA%\Programs\nodejs`, Python(NuGet) `%LOCALAPPDATA%\Programs\py311nuget`, 백엔드 venv `backend\venv`.
- 백엔드 실행 시 **`PYTHONUTF8=1`**(한글 콘솔 크래시 방지) + **`RPA_BROWSER_CHANNEL=msedge`** 환경변수 필요(run-windows가 자동 설정).
- 포트가 이미 사용 중이면 이전 세션의 서버가 떠있는 것 → 재사용하거나 종료 후 재기동.

## 오늘 변경한 것 (아직 **미커밋**)
- `backend/rpa/base.py`
  - `get_launch_options()` — **윈도우에서는 번들 Chromium(SxS 오류) 대신 설치된 Edge(msedge)** 사용. 맥/리눅스는 기존 번들. env: `RPA_BROWSER_CHANNEL`, `RPA_HEADLESS`.
  - `save_document()` — 발급된 서류를 **PDF로 `바탕화면\모두봄서류`에 자동 저장**(CDP printToPDF, 실패 시 PNG 폴백).
- `backend/rpa/{gov24,apply,nhis,work24}_rpa.py` — 모두 `get_launch_options()` 사용. gov24·nhis는 발급 성공 시 `save_document()` 호출.
- `backend/rpa/orchestrator.py` + `backend/api/routes.py` — **무인 여정 엔진**: `POST /api/journey/plan`(계획), `POST /api/journey/run`(순차 발급→저장→신청), `GET /api/journey/status/{id}`(추적).
- `backend/main.py` — **로컬 에이전트 브릿지(백엔드)**: CORS에 `https://biocode67.github.io` 허용 + Private Network Access 헤더. (배포 웹이 사용자 PC의 이 에이전트를 호출 가능하게)
- 루트: `run-windows.bat`, `run-windows.ps1`, `scripts/restore-handoff.windows.sh` (윈도우 실행/복원 스크립트).

### 이번 세션 추가 변경 (2026-07-01 오후, 아직 미커밋)
- `frontend/src/lib/backend.ts` — 로컬 에이전트(localhost:8000) 감지(`export let API_BASE` 라이브바인딩). → **gh-pages 재배포 완료**(Supabase/onrender 제외).
- `frontend/src/components/ChatWidget.tsx`, `QuickAsk.tsx` — 폴리시(모바일 홈 FAB 겹침 해소, 비활성 버튼 대비).
- `backend/rpa/gov24_rpa.py` — plus.gov.kr/login + simpleCert iframe 대응.
- `backend/rpa/apply_rpa.py` — 복지로 loginView.do + eForm + fincert 대응.
- `backend/rpa/base.py` — `click_eform_button`(eForm 좌표 신뢰클릭), `get_frame_by_url`, 카카오톡 셀렉터 보강.
- ※ 프론트 배포는 gh-pages에 반영됨. **소스(main)는 미커밋** — 사용자 요청 시 커밋.

## 동작 확인됨 ✅ / 미동작 ⚠️
- ✅ **건강보험 자격득실확인서(nhis) 자동발급** — 실제 사이트 접속→간편인증 위젯→카카오톡 선택→정보입력→인증요청→**카카오 승인 대기 지점**까지 실동작. + PDF 자동저장(153KB) 검증.
- ✅ Mock 발급(`/api/documents/issue`), 여정 API, CORS/PNA 프리플라이트 검증.
- ✅ **정부24 로그인 갱신 완료(2026-07-01)** — `plus.gov.kr/login` + `button.login-type` 간편인증 + **simpleCert iframe**(oacx) 내 카카오톡/폼. `gov24_rpa.py`·`base.py` 갱신, headed Edge로 폼 도달까지 검증. 서비스 안내(`AA020InfoCappView.do`)는 여전히 동작, 발급은 `AA040OfferMainFrm`(`발급하기`). **로그인 이후 서비스→발급→PDF는 실제 카카오 승인 세션에서 최종 검증 필요.**
- ✅ **복지로 로그인 갱신 완료(2026-07-01)** — 새 URL `loginView.do`(tx 자동), **eForm(Clipsoft `.cl-button`) → 좌표 기반 신뢰클릭** 필수, 간편인증 위젯은 **yeskey fincert**(정부24 oacx와 다름, 메인 오버레이). `apply_rpa.py`·`base.py`(`click_eform_button`) 갱신, 카카오톡/폼 도달까지 검증. **서비스 이동·신청 폼은 실런에서 확인 필요.**
- ⚠️ 위 두 흐름의 **카카오 승인 이후 구간**(세션 유지·서비스 페이지·발급/신청)은 사용자 폰 승인이 있어야 끝까지 검증 가능 → 실제 런 예정.

## 다음 할 일 (우선순위)
1. ✅ **[완료] [프론트] 로컬 에이전트 브릿지** — `backend.ts`가 localhost:8000 감지(`export let API_BASE` 라이브바인딩). `npm run deploy` 재배포(Supabase/onrender 제외한 폴리시만). **실제 Edge(headed)에서 라이브→로컬에이전트 도달 검증 완료**(headless는 PNA로 막힘, 데모 무관).
2. ✅ **[완료] [백엔드] 정부24 plus.gov.kr 갱신** — 로그인 폼 도달 검증. (카카오 승인 이후 서비스→발급 실런 검증 남음)
3. ✅ **[완료] [백엔드] 복지로 로그인 갱신** — 간편인증 폼 도달 검증. (신청 폼 실런 검증 남음)
4. **[실런] 정부24·복지로 카카오 승인 end-to-end** — 사용자 폰 승인으로 서비스→발급/신청→PDF까지 최종 확인 + 남은 셀렉터 보정.
5. **[프론트] "담은 복지 전부 원클릭 자동발급/신청" 버튼** → `/api/journey/run` 호출.
6. (추후) 에이전트를 **Tauri/Electron 설치본**으로 패키징.

### 1번 프론트 스펙 (`frontend/src/lib/backend.ts` 교체)
```ts
export let API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || ''
const LOCAL_AGENT = 'http://localhost:8000'
let cached: boolean | null = null
async function ping(base: string, ms: number) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal }); clearTimeout(t); return res.ok
  } catch { return false }
}
export async function checkBackend(timeoutMs = 1500): Promise<boolean> {
  if (cached !== null) return cached
  if (await ping(API_BASE, timeoutMs)) { cached = true; return cached }
  if (API_BASE !== LOCAL_AGENT && await ping(LOCAL_AGENT, timeoutMs)) { API_BASE = LOCAL_AGENT; cached = true; return cached }
  cached = false; return cached
}
export function resetBackendCache() { cached = null }
```

## 원칙 (반드시 지킬 것)
- **카카오 본인인증·신청 최종 제출은 사용자 직접**(법적·비가역). 완전 무인 대리승인은 명의도용이라 만들지 않는다.
- **가짜데이터 금지 / 자동화 현실 과장 금지.** 실제 검증된 것만 "된다"고 말한다.
- 커밋: **한국어 conventional commit, AI 서명 금지.** user.name/email은 BioCode67.
- **배포 라이브:** https://biocode67.github.io/modoo-bom/ (gh-pages). 재배포 `cd frontend && npm run deploy` + 소스 `git push origin main`(별개).
