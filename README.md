# 모두봄 (ModooBom)

> 내 복지 혜택, 모두 찾아드릴게요 🌱  
> 개인 복지 자산 관리 AI Agent · 2026 AI·SW 중심대학 디지털 경진대회 SW부문

### 🌐 라이브 데모 — **https://biocode67.github.io/modoo-bom/**

회원가입·백엔드 없이 바로 동작합니다. 프론트엔드는 **470여 개 복지 정책**(내장 큐레이션 120건
+ 한국사회보장정보원 공공데이터 367건)과 자격 판정 엔진을 **브라우저 안에서** 실행하므로 즉시 로딩되고 항상 켜져 있어요.
(OpenAI/Claude 키와 FastAPI 백엔드를 연결하면 LLM 분석·RPA 자동발급 등 고급 기능이 활성화됩니다.)

**주요 기능**
- 🔎 **확인/조회** — 1분 프로필 위저드 + 자격 판정(2026 정밀 선정기준), 470여 종 정책 탐색·검색, **대화형 AI 상담 챗봇**(연령·상황·소득으로 좁혀 추천)
- 🧮 **선택/관리** — 관심목록·신청 상태 관리·혜택 계산기·정책 비교, **복지 수혜 점수**(미수령 사각지대 +지금 챙길 TOP3)
- 📅 **사후관리** — 신청 준비·진행 점검·갱신 자동 알림(복지 비서), **복지 캘린더 + .ics 내보내기**
- 🚀 **신청** — 단계별 가이드, 서류 준비 도우미, 정부24·복지로 스마트 연동, **에이전트 반자동 신청**(백엔드 시, 인증·최종제출은 본인)
- 🔮 **혁신** — **생애주기 시뮬레이터**(미래 받을 복지), **긴급복지 빠른 진단**(위기 상황), **우리 가족 복지 한눈에**(가구 단위), **결과 공유**(이미지 카드)
- ♿ **접근성** — **음성 입력·음성 안내(TTS)**, 큰글씨, 인쇄/PDF("내 복지 안내서"), reduced-motion
- 🎨 **3D 카툰 UI / PWA** — 새싹 마스코트(React Three Fiber, 지연 로딩) + framer-motion, 반응형, **설치형·오프라인 PWA**

**품질**: ESLint(0) · 단위 테스트(vitest 81 + pytest 13) · TypeScript · ErrorBoundary · 주요 복지 금액 2026년 공식 출처 검증

### 🤖 자동 서류발급 · 자동 신청 (로컬 실행)

정부24·복지로·건강보험공단·고용24를 **에이전트가 직접 조작**해 서류를 발급하고 신청까지 진행합니다.
브라우저 자동화(Playwright) 백엔드가 필요하므로 **로컬에서** 실행하세요. (배포 정적 사이트는 공식 링크 안내만)

```bash
./run-local.sh        # 셋업(venv·패키지·Chromium·npm) + 백엔드(8000)+프론트(5173) 한 번에
#  → http://localhost:5173 접속 시 백엔드가 감지되어 '자동발급/자동신청' 버튼이 활성화
```
- 📄 **자동 발급**: 나의 복지 → *서류 준비 도우미* → 서류별 `자동` 버튼
- 🚀 **자동 신청**: 정책 상세 → *에이전트로 신청 시작*
- 🔐 **카카오 본인인증과 최종 제출은 본인이 직접** 합니다(정부 사이트 법적 요건 — 무인 대행 불가). 나머지(로그인 화면 이동·양식 자동작성·발급/제출 직전까지)는 에이전트가 운전합니다.

### 배포 (정적 사이트)

```bash
cd frontend
npm run deploy   # 빌드 후 gh-pages 브랜치로 배포 → GitHub Pages
```

### 복지정책 카탈로그 확장 (전체 정책 담기)

기본 제공 470여 건(내장 큐레이션 120 + 공공데이터 367, 이미 병합됨) 외에 **정부 공식 공개데이터**로
수천 건까지 더 확장할 수 있어요. 프론트가 `public/policies.json`을 런타임에 자동 병합하므로 **코드 수정 없이** 늘어납니다.

```bash
cd backend && source venv/bin/activate
# (쉬움) 키 없이 — 복지로 중앙부처 367건 CSV를 받아서:
#   https://www.data.go.kr/data/15083323/fileData.do → 다운로드
python etl/ingest_welfare.py --csv ~/Downloads/한국사회보장정보원_복지서비스정보_*.csv
# (포괄) 무료 키로 — 중앙부처 1,600+건:
#   export DATA_GO_KR_SERVICE_KEY=발급키 ; python etl/ingest_welfare.py --api
cd ../frontend && npm run deploy
```
자세한 안내: [backend/etl/README.md](backend/etl/README.md)

### 로그인 · 클라우드 동기화 (선택)

로그인 없이도 모든 기능이 동작하지만, **카카오·구글 로그인**을 켜면 **기기 간 '나의 복지' 신청 현황**이
동기화됩니다. 정적 사이트에서 서버 없이 동작하도록 **Supabase**(무료)를 사용하며, 미설정 시에는
관련 코드가 빌드에서 제외되어 **콜드스타트에 영향이 없습니다**(로그인 UI도 숨김).

```bash
# 1) Supabase 프로젝트 생성 + supabase/schema.sql 실행 (RLS 포함)
# 2) Authentication → Providers 에서 Kakao/Google 활성화
# 3) frontend/.env 에 URL/anon key 입력 후
cd frontend && npm run deploy
```
설정 절차 전체: [supabase/SETUP.md](supabase/SETUP.md)

---

## 지금 바로 실행하기 (풀스택 로컬 개발)

### 준비물

- Python 3.11+
- Node.js 20+
- (선택) Anthropic(Claude) API 키 — **없어도 Mock 모드로 전체 동작함**

---

### 1단계 — 백엔드 실행

```bash
cd modoo-bom/backend

# 가상환경 생성 & 활성화
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정
cp .env.example .env
# .env 파일 열어서 ANTHROPIC_API_KEY 입력 (없으면 그냥 두면 Mock 모드 자동 동작)

# 서버 실행
uvicorn main:app --reload --port 8000
```

서버가 뜨면 브라우저에서 확인:
- 헬스체크: http://localhost:8000/api/health
- API 문서: http://localhost:8000/docs

---

### 2단계 — 프론트엔드 실행

```bash
# 새 터미널에서
cd modoo-bom/frontend

npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속

---

### Mock 모드 (Anthropic 키 없이 테스트)

`.env`에 `ANTHROPIC_API_KEY`를 설정하지 않으면 자동으로 **Mock 모드** 동작:

| 노드 | Mock 동작 |
|------|-----------|
| profile_analyzer | 키워드 규칙 기반 추출 |
| policy_search | 샘플 120건에서 키워드 매칭 |
| eligibility_check | 연령·소득·장애 규칙 판별 |
| reflection_check | 규칙 기반 검증 |
| guide_generator | 템플릿 가이드 |
| doc_retrieval | 정부24 API Mock (지연 시뮬레이션) |
| orchestrator | 마크다운 요약 생성 |

---

### 3단계 — 테스트 실행

```bash
cd modoo-bom/backend
source venv/bin/activate

# pytest 설치 (requirements.txt에 없으면)
pip install pytest pytest-asyncio

# 전체 테스트
pytest tests/ -v

# 특정 테스트
pytest tests/test_mock_mode.py::test_full_graph_mock_elderly -v
```

---

### Docker Compose로 한 번에 실행

```bash
cd modoo-bom

# ANTHROPIC_API_KEY 없으면 Mock 모드로 자동 동작
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build

# 또는 Mock 모드
docker compose up --build
```

---

## 데모 시나리오 (추천 순서)

웹 UI에서 **빠른 데모 프로필** 버튼을 클릭하세요:

| 프로필 | 기대 결과 |
|--------|-----------|
| 독거 노인 (72세) | 기초연금, 노인 일자리, 맞춤돌봄서비스 등 |
| 청년 취준생 (26세) | 실업급여, 국민취업지원, 청년 월세지원 등 |
| 신혼 출산 가정 (32세) | 부모급여, 아동수당, 국민행복카드 등 |
| 중증장애인 (45세) | 장애인연금, 활동지원서비스 등 |

각 프로필은 **10노드 LangGraph**를 실행하며, 우측 패널에서 노드별 실행 시간과 결과를 실시간으로 확인할 수 있습니다.

---

## 아키텍처

**이중 모드** — 배포(정적)에서는 백엔드 없이 완전 동작, 백엔드 연결 시 LLM·RPA 고급 기능 활성화.

```
[프론트엔드 — 항상 동작 / GitHub Pages]
  React 18 + Vite + TypeScript + TailwindCSS
  React Three Fiber(3D) · framer-motion · zustand(persist) · PWA
  └ 클라이언트 복지 엔진(welfare-engine.ts) + 정책 카탈로그(catalog.ts)
        ↕  (백엔드 감지 시에만)
[백엔드 — 선택 / 로컬·서버]
  FastAPI + LangGraph 10노드 + Claude(langchain-anthropic) + ChromaDB RAG
  + Playwright RPA(정부24·복지로·건보·고용24)
        ↕
[공공데이터 ETL] 한국사회보장정보원 복지서비스 → public/policies.json
```

- **클라이언트 엔진**: 백엔드 `mock_responses.py`의 자격판정·키워드·가이드·혜택계산을 TS로 포팅 → 브라우저에서 즉시 실행.
- **백엔드(선택)**: 아래 LangGraph 10노드 파이프라인 + 실제 RPA. 프론트가 `useBackend`로 감지해 있으면 연결.

### (선택 백엔드) LangGraph 10노드 플로우

```
① profile_analyzer   → 프로필 분석 + 키워드 추출
② policy_search      → ChromaDB RAG 검색 (Mock: 키워드 매칭)
③ eligibility_check  → Claude 자격 판별 (Mock: 규칙 기반)
④ reflection_check   ⇆ ③ (검증 실패 시 최대 2회 재판별)
⑤ guide_generator   → 신청 가이드 생성
⑥ doc_retrieval      → 정부24 API Mock 서류 자동 취득
⑦ portfolio_manager  → 복지 포트폴리오 요약
⑧ notification_agent → 생애이벤트 Push 알림
⑨ result_tracker     → 신청 결과 추적
⑩ orchestrator       → 최종 안내 메시지 생성
```

### WebSocket 메시지 포맷

```json
// 클라이언트 → 서버
{ "type": "start_analysis", "profile": { ... } }

// 서버 → 클라이언트 (스트리밍)
{ "type": "node_event", "node": "profile_analyzer", "status": "running", "message": "..." }
{ "type": "node_event", "node": "profile_analyzer", "status": "done", "data": { ... } }

// 완료
{ "type": "complete", "result": { "eligible_policies": [...], ... } }
```

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `WS` | `/ws/analyze` | LangGraph 실행 + 실시간 스트리밍 |
| `GET` | `/api/health` | 서버 상태 + DB 정보 |
| `POST` | `/api/search` | 복지 정책 RAG 검색 |
| `POST` | `/api/documents/issue` | 서류 발급 (Mock) |
| `POST` | `/api/admin/seed` | ChromaDB 120건 시딩 |
| `GET` | `/api/admin/env` | 환경변수 상태 확인 |

---

## 파일 구조

```
modoo-bom/
├── backend/                         # 선택 — FastAPI + LangGraph + RPA
│   ├── main.py                      # FastAPI 진입점 (REST + WebSocket)
│   ├── agents/                      # state.py, graph.py, mock_responses.py, nodes/(10노드)
│   ├── rag/sample_data.py           # 복지 정책 120건 (+ embedder/chromadb)
│   ├── api/                         # routes.py(REST), websocket.py, chat.py
│   ├── rpa/                         # Playwright 자동화: gov24/nhis/work24/apply + base/manager
│   ├── etl/ingest_welfare.py        # 공공데이터 → policies.json (중앙 --api / 지자체 --local / CSV)
│   └── tests/test_mock_mode.py      # pytest 12
└── frontend/                        # 메인 — 백엔드 없이 동작 (정적 배포)
    ├── src/
    │   ├── App.tsx                  # 셸 + 상태기반 뷰(home/analyze/explore/my) + 챗봇/공유/인쇄
    │   ├── data/                    # policies.ts(120건 시드), catalog.ts(런타임 병합), useCatalog
    │   ├── lib/                     # welfare-engine, simulate, monitoring, calendar, emergency,
    │   │                            #   guidedChat, share, useSpeech, useTTS, useBackend, format …
    │   ├── store/useAppStore.ts     # zustand persist (관심·상태·프로필·rpaInfo)
    │   ├── three/                   # SproutMascot, HeroScene, MascotCanvas(지연 로딩)
    │   ├── sections/                # Home(Hero/HowItWorks/Features/Faq), Analyze, Explore, My
    │   ├── components/              # ProfileWizard, ResultsView, WelfareScore, FutureWelfare,
    │   │                            #   MonitorFeed, WelfareCalendar, HouseholdAnalyzer,
    │   │                            #   EmergencyHelp, DocumentCenter, AgentSubmitButton,
    │   │                            #   PolicyCard/Drawer, BenefitCharts, ChatWidget, ShareButton …
    │   └── lib/*.test.ts            # vitest 15 (engine/simulate)
    └── public/                      # favicon, 404.html, robots.txt, (policies.json: ETL 생성)
```

---

## 팀 모두봄

| 이름 | 역할 |
|------|------|
| 김주형 | PM / 백엔드 (LangGraph, FastAPI) |
| 류다영 | AI·ML (RAG, Reflection Loop) |
| 신주현 | 데이터 (ChromaDB, ETL) |
| 이준영 | 프론트엔드 (React, WebSocket) |
| 장지웅 | 기획·UX |
