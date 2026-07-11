# CLAUDE.md — 모두봄 (ModooBom)

> 개인 복지 자산 관리 AI Agent · 2026 AI·SW 중심대학 디지털 경진대회 SW부문
> 3주차 프로토타입 (version 0.3.0)

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 프로젝트 컨텍스트입니다.

---

## 무엇을 하는 프로젝트인가

사용자 프로필(나이·소득·가구유형·장애·자녀·생애이벤트 등)을 입력하면,
LangGraph 10노드 에이전트가 복지 정책 DB에서 적합한 혜택을 선별하고,
신청 가이드·예상 금액·필요 서류를 안내한 뒤, **실제 정부 사이트 RPA**로
서류 발급·복지 신청까지 자동화하는 풀스택 데모.

OpenAI 키가 없어도 **Mock 모드**로 전체 파이프라인이 동작한다(데모 핵심 장치).

---

## 기술 스택

### Backend (`backend/`) — Python 3.11+
- **FastAPI 0.115** + uvicorn — REST + WebSocket 서버
- **LangGraph 0.2.56** + LangChain 0.3 — 10노드 StateGraph 에이전트
- **langchain-anthropic** — LLM은 **Claude** 사용 (GPT 아님 — README 본문은 구버전 잔재)
- **ChromaDB 0.5.23** — 복지 정책 RAG (sentence-transformers 내장 임베딩, 별도 임베딩 API 불필요)
- **Playwright** — 정부24·건강보험공단·고용24 실제 브라우저 RPA
- **pydantic 2.10** — AgentState / UserProfile 스키마
- **pytest / pytest-asyncio** — Mock 모드 유닛+통합 테스트

### Frontend (`frontend/`) — Node 20+  ⚠️ 2026-06 전면 리디자인
- **React 18** + **Vite 6** + **TypeScript 5.7** + **TailwindCSS 3.4**
- **React Three Fiber / three / drei** — 3D 새싹 마스코트 히어로(코드 분할 lazy)
- **framer-motion** — 진입/스크롤/페이지 전환 애니메이션
- **@huggingface/transformers (transformers.js)** — **온디바이스 다국어 AI 의미 검색**용
  임베딩 모델(`multilingual-e5-small`)을 브라우저에서 직접 실행(지연 동적 import, 서버 전송 없음)
- **zustand (persist)** — 뷰 라우팅·관심목록·신청상태·프로필/결과 캐시 (localStorage)
- **lucide-react** — 아이콘 · Pretendard 폰트 · 봄/새싹 카툰 라이트 테마
- **클라이언트 복지 엔진**(`src/lib/welfare-engine.ts`) + 정책 120건(`src/data/policies.ts`)으로
  **백엔드 없이도 전 기능 동작**. 백엔드가 있으면(`src/lib/backend.ts` 감지) RPA 자동발급 등 활성화.
- 구 컴포넌트/WebSocket 훅/shadcn ui는 리디자인하며 제거됨. (백엔드 WS 엔드포인트는 유지)

#### 프론트 구조(신규)
```
src/
├── App.tsx                 # 셸: Navbar + 상태기반 뷰(home/analyze/explore/my) + ChatWidget
├── store/useAppStore.ts    # zustand persist 전역 상태
├── data/policies.ts        # 복지 정책 120건 (sample_data.py 포팅)
├── lib/
│   ├── welfare-engine.ts   # 자격판정·키워드·가이드·혜택계산 (mock_responses.py 포팅)
│   ├── format.ts · officialLinks.ts · backend.ts · utils.ts
├── three/                  # SproutMascot, HeroScene, MascotCanvas(lazy+폴백)
├── sections/               # Home(Hero/HowItWorks/Features/Faq/Footer), Analyze, Explore, My
├── components/             # ProfileWizard, ResultsView, PolicyCard, PolicyDetailDrawer,
│                           #   TrackedCard, CompareModal, DocumentCenter, ChatWidget, Navbar
└── ui/                     # SproutLogo, SectionHeading
```

### 복지정책 카탈로그 (확장 가능)
- 프론트는 **동적 카탈로그**(`src/data/catalog.ts`): 내장 시드 190건(POL 124·SUP 33·PRV 21·HOU 7·FIN 5) + 런타임에 `public/policies.json` 병합
  (`useCatalog` 훅으로 자동 리렌더). 엔진/탐색기/챗봇/대시보드/모니터링 모두 `getCatalog()`/`getPolicyMap()` 사용.
- **ETL**(`backend/etl/ingest_welfare.py`): 공공데이터(한국사회보장정보원 중앙부처 복지서비스)를 Policy 스키마로
  정규화해 `frontend/public/policies.json` 생성. CSV 모드(키 불필요, 367건) / OpenAPI 모드(B554287, 1,600+건).
  실데이터만 처리(가짜 미생성). 확장 후 `npm run deploy`로 반영. → "사이트마다 흩어진 정책" 문제 해결책.

### 에이전트 자동화 / 사후관리 — 정직한 현실 (중요)
실제 동작 범위를 과장하지 말 것. 코드 검증 기준:
- **서류 발급/신청 RPA**(`backend/rpa/*.py`, Playwright): 정부24·복지로·건보·고용24 **실제 페이지 자동화**. chromium 설치됨, 스택 구동 확인. 단 **headed 모드 + 카카오 본인인증은 사용자가 직접**, **최종 제출도 사용자 확인**(비가역·법적 행위라 의도된 안전장치). `apply_rpa`는 로그인→서비스 딥링크 이동→'신청하기' 클릭→양식에 이름·생년월일·연락처 자동 입력까지 진행 후 **제출 직전 정지**. **정적 배포 사이트에선 백엔드가 없어 미동작** → 공식 링크 안내로 폴백.
- **완전 무인 자동 제출은 설계상 불가**(정부 본인인증 필수 + 비가역). human-in-the-loop가 정답.
- **사후관리/모니터링**: 과거 `result_tracker`는 `random.choice`로 가짜 상태를 날조 → **제거함**. 이제 정직한 안내만. 실제 추적은 **프론트 `나의 복지`의 모니터링 엔진**(`src/lib/monitoring.ts`)이 사용자 기록(신청일/점검일)+정책 갱신주기로 서류미비·신청권유·진행점검·갱신임박을 산출(배포에서도 동작). 정부 서버 실시간 상태조회는 사용자 세션 없이는 불가 → 공식 조회 링크로 안내.
- **무설치(확장 없이) 1급 경로 — 2026-07 강화**: ① 서류·신청 딥링크 정밀화 — 등·초본(CappBizCD 13100000015)·가족관계(97400000004) 등 정부24 민원 직행 + 복지로 신청 딥링크 6종(`quickApply.KNOWN_APPLY_URLS`, wlfareInfoNm 라이브 대조) — 전부 실측 검증, `npm run check:links`로 상시 재검증(19종). ② **이어서 발급**: 서류 도우미 배너 CTA가 남은 전자증명서 서류를 순서대로 안내(정부24 로그인 유지 — 확장의 연쇄발급을 무설치 재현), 발급완료는 `docDone`(persist)으로 기억. ③ **복귀 확인 반자동 기록**(`ReturnConfirm`+`returnPrompt`): 정부 탭에서 돌아오면 '완료하셨나요?' 1탭 확인 — 사용자가 '네'를 눌러야만 applied/발급완료 기록(클릭=완료 날조 금지). ④ 팝업 차단 감지(oneTapApply `opened`), 프리필은 '이름 값만' 복사+신청 키트 순차 복사(정부 폼은 필드별 input). `isCertIssuable`은 URL 정규식 → `docLink().issue`('wallet'|'online') 명시 필드로 승격(가족사진·이직확인서 거짓양성 제거).
- 프론트 자동화 게이팅: `src/lib/useBackend.ts`(백엔드 감지) → 있으면 RPA(`AgentSubmitButton`/`DocumentCenter`), 없으면 가이드.

### 배포 — GitHub Pages (정적)
- **라이브: https://biocode67.github.io/modoo-bom/** · `gh-pages` 브랜치 서빙(legacy build)
- 재배포: `cd frontend && npm run deploy` (build → gh-pages 푸시)
- Vite `base`는 빌드 시 `/modoo-bom/`, 개발 시 `/` (vite.config.ts)
- ⚠️ 푸시 토큰에 `workflow` 스코프가 없어 `.github/workflows`는 푸시 불가 → Actions 대신
  `gh-pages` 브랜치 + Pages REST API 방식으로 배포함.

### 기능·품질 현황 (전문화 완료)
- **데이터**: 시드 190건(정밀 규칙·검증 금액; 정부 124 + 지원사업 SUP 33 + 주택공고 HOU 7 + 서민금융 FIN 5) + **민간재단 큐레이션 21건**(`src/data/privatePolicies.ts`, PRV-###:
  현대차 정몽구 스칼러십·관정·삼성꿈장학·미래에셋(장학) + 심장재단·백혈병어린이·아산SOS·초록우산·밀알(의료·위기·장애) —
  전 항목 공식 사이트 실측 검증·URL 생존 확인, 심사·선발형 명시, 엔진에선 저신뢰 '관련 복지'로만 노출(과장 방지))
  + 한국사회보장정보원 공공데이터 OpenAPI(B554287)로
  **중앙부처 367 + 지자체 4,598 = 약 4,965건 실데이터**(`public/policies.json`, 약 3.3MB·gh-pages gzip 전송)를
  런타임 병합 → 총 **약 5,250건**. 이름 기준 디듑(시드 우선). 가짜 데이터 미생성 원칙.
  키는 `backend/.env`의 `DATA_GO_KR_SERVICE_KEY`, 수집은 `python etl/ingest_welfare.py --csv <중앙CSV> --local`
  (ETL은 https+페이지 재시도로 견고). 더 받으려면 중앙부처(15090532)도 활용신청 후 `--api`.
  + **정책서민금융 큐레이션 5건**(`src/data/financialPolicies.ts`, FIN-###: 소액생계비대출·햇살론유스·햇살론 일반/특례·미소금융 —
  서민금융진흥원 kinfa.or.kr 2026 실측·URL 생존). **대출**이라 benefit에 '대출·상환' 명시(현금성 합산 제외), PRV처럼 저신뢰
  '관련 복지'로만 노출. ⚠️신용 '하위 N%'는 benefit에만(eligibility/target에 두면 incomeCeiling이 소득상한으로 오게이트).
  → 정부24·복지로·보건복지부는 이미 B554287 아그리게이터로 커버. 서민금융진흥원은 그 밖의 저소득·청년 금융 안전망 출처.
- **⭐ 온디바이스 다국어 AI 의미 검색(헤드라인)**: 브라우저에서 직접 도는 신경망 임베딩
  (`multilingual-e5-small`, `src/lib/semanticSearch.ts`)으로 복지를 **의미**로 매칭.
  한국어·English·Tiếng Việt 등 **다국어 교차검색**(외국인·다문화 사각지대). 정책 벡터는 빌드 시
  사전계산(`npm run embed`→`public/policy-embeddings.json`), 런타임은 질의만 임베딩. 탐색의 'AI 의미 검색'
  토글(옵트인 지연로드)+입력 언어 자동감지(`detectLang.ts`)+홈 카드 CTA. **서버 전송 없음**(프라이버시).
  **AI 답변 카드**(`aiAnswer.ts`: 검색결과 기반 요약, 환각 없음)+**음성 대화**(자국어로 말하면 음성으로 답)+
  **다국어 음성 입력**+정책 상세 **"AI로 비슷한 복지"**(`relatedPolicies`: 임베딩만, 모델 불필요)+모델 로딩 중 키워드 폴백.
  운영: 첫 로드 ~128MB(CDN), 이후 캐시로 즉시 → 데모 전 프리워밍 권장. 미사용 WASM은 배포 시 제거(`scripts/clean-wasm.mjs`).
- **분석 엔진**: 시드는 키워드/규칙 기반 정밀 자격판정, 공공데이터(요약형)는 자연어 신호 추론으로
  '관련 복지'를 낮은 신뢰도로 제시(`inferFromText`). 결과는 핵심(POL-)·관련(GOV/LOC-)으로 분리 표시.
- **기능**: 3D 카툰 히어로(지연 마운트), 프로필 위저드+분석, **자연어 한 문장 즉시 분석**(`QuickAsk`/`parseQuery`, 음성 포함),
  **기초생활보장 급여 계산기**(2026 공식값, 가구원수→소득% + 생계·의료·주거·교육급여 **가구별 월 소득상한·게이지**, 탐색 상단 노출),
  **도메인 검색**(`lib/search.ts`: 생활어→행정용어 동의어 17군 + 개념단위 관련도 랭킹 — '노인 일자리' 다단어·'전세→주거' 생활어 매칭),
  정책 탐색(검색·정렬·금액필터·**지역(시도+시군구 2차)필터**·증분렌더, **지자체 지역배지**, **신청기한 ⏰배지**(`deadline.ts`)),
  나의 복지(관심·상태관리·**현금성** 혜택계산·비교·**사후관리 모니터링**), **'맨 위로' 버튼**(`ScrollTop`),
  서류 준비 도우미, **신청 키트**(공식 신청 딥링크 + **신청 자동화 흐름 스테퍼**(`ApplyFlow`: 추천·정보작성·서류=자동, 인증·제출=본인) + 내 정보 미리채움, `ApplyKit`/`prefill.ts`),
  에이전트 신청(백엔드 시), 가이드형 복지 챗봇, **음성 입력**(Web Speech)·**TTS 읽어주기**,
  **결과 인쇄/PDF**·**이미지 카드 공유**(Web Share), **복지 캘린더 .ics**, 생애주기 시뮬레이터, 가구분석,
  긴급복지 진단, 복지 점수·TOP3, **대표문의 전화 tel: 연결**, **포트폴리오 차트**(SVG), 온보딩,
  **로그인·동기화**(카카오·구글, Supabase 무료 티어, 선택 — 미설정 시 인증 UI 숨김 + supabase-js 트리셰이킹 제외, 설정은 `supabase/SETUP.md`),
  **PWA**(설치형·오프라인·autoUpdate·beforeinstallprompt), 큰글씨·고대비·ESC·ARIA·focus-visible 접근성, ErrorBoundary.
- **품질 게이트(모두 통과)**: `npm run lint`(eslint9 flat, react-hooks, 0건) · `npm test`(vitest **478**) ·
  `tsc --noEmit` · `npm run build` · E2E 스모크(`frontend/e2e/smoke.py`, 실브라우저 10여정 + e2e:chat/save/fin/ext) / 백엔드 `pytest`(64). 변경마다 브라우저 회귀 검증.
- **견고성 감사(2026-07)**: 다중에이전트 감사로 백엔드 확정결함 8건(extract_json dict 보장·RPA 태스크
  강한참조·chat 세션유지·카탈로그 파싱·검색캐시 사본·ETL _pick 섀도잉) + 프론트 5건(sidoOf 도우선·
  household_type/children_ages 무가드 접근·빈 카테고리 오매칭·parseMonthly 범위) 수정, 회귀 테스트로 고정.
- **데이터 정확성(2026 검증)**: 기초연금·장애인연금·아동수당(9세 확대)·생계급여(32%)·한부모(23만/65%)·
  청년도약(33,000)·교육급여·보육료·긴급복지·노인일자리·국가장학금을 보건복지부 등 공식 출처로 검증·정정.
  엔진 소득 자격판정은 2026 정밀 선정기준(생계32·의료40·주거48·교육/차상위50)으로 동작.
  `parseMonthly`는 '월 N만원' 표기까지 환산(원-우선)해 합계·정렬·현금성 필터가 정확.
- **scripts**(frontend): `dev` `build` `preview` `lint` `test` `deploy`.
- 데이터 확장은 `backend/etl/ingest_welfare.py`(CSV/--api/--local) → `public/policies.json`(런타임 병합).
  지자체 데이터는 data.go.kr 세션 게이트로 자동 다운로드 불가 → 사용자 다운로드 또는 무료 OpenAPI 키 필요.

---

## 실행 방법

### 로컬 개발 (권장)
```bash
# 1) 백엔드
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # ANTHROPIC_API_KEY 입력 (없으면 Mock 모드 자동)
uvicorn main:app --reload --port 8000
# 헬스체크: http://localhost:8000/api/health · API 문서: /docs

# 2) 프론트엔드 (새 터미널)
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

### 시연용 일괄 실행 (macOS, screen 기반)
```bash
./start.sh   # 백엔드+프론트+caffeinate를 screen 세션으로 백그라운드 기동, 브라우저 자동 오픈
./stop.sh    # 모든 screen 세션 + uvicorn/vite 프로세스 종료
# 로그: tail -f /tmp/modoo-backend.log  /  /tmp/modoo-frontend.log
```

### Docker Compose
```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build   # 또는 키 없이 Mock 모드
```

### 테스트
```bash
cd backend && source venv/bin/activate
pytest tests/ -v
```

---

## Mock 모드 (중요)

`ANTHROPIC_API_KEY`가 비어있거나 `"mock"`이면 자동으로 Mock 모드 동작
(`backend/agents/mock_responses.py:is_mock_mode()`).

- LLM 호출 대신 **키워드·규칙 기반 로직**으로 모든 노드가 결과 생성
- ChromaDB 시딩은 스킵, 검색은 `rag/sample_data.py`의 정책 목록에서 키워드 매칭
- Production 모드에서 LLM 호출이 실패하면 챗봇 등은 Mock 응답으로 폴백
- 데모는 기본적으로 이 모드를 전제로 설계됨

---

## 아키텍처

```
[React 18 + Vite + shadcn/ui]
        ↕ WebSocket (/ws/analyze, /ws/chat)
[FastAPI + LangGraph 10노드 StateGraph]
        ↕
[ChromaDB RAG] + [Claude / Mock] + [Playwright RPA(정부24·건보·고용24)]
```

### LangGraph 10노드 (`backend/agents/graph.py`)
```
① profile_analyzer   프로필 분석 + 검색 키워드 추출
② policy_search      ChromaDB RAG 검색 (Mock: 키워드 매칭)
③ eligibility_check  Claude 자격 판별 (Mock: 규칙 기반)
④ reflection_check   ⇆ ③ 재판별 루프 (MAX_RETRIES=2, 통과 시 다음 단계)
⑤ guide_generator   신청 가이드 생성
⑥ doc_retrieval      정부24 API Mock 서류 취득
⑦ portfolio_manager  복지 포트폴리오 요약
⑧ notification_agent 생애이벤트 Push 알림
⑨ result_tracker     신청 결과 추적
⑩ orchestrator       최종 안내 메시지
```
- 공유 상태는 `agents/state.py`의 `AgentState`(pydantic). `events` 필드는
  `operator.add` 리듀서 → 각 노드는 **새 이벤트만** 반환하면 자동 누적.
- WebSocket은 `astream(stream_mode="values")`로 매 노드 누적 상태를 받아
  새 이벤트만 클라이언트로 흘려보냄 (`api/websocket.py`).

### WebSocket 메시지 포맷
```jsonc
// client → server
{ "type": "start_analysis", "profile": { ... } }
// server → client
{ "type": "node_event", "node": "...", "status": "running|done|error", "message": "...", "data": {...} }
{ "type": "complete", "result": { "eligible_policies": [...], ... } }
```

---

## 디렉터리 구조

```
modoo-bom/
├── docker-compose.yml          # backend(8000) + frontend(5173)
├── start.sh / stop.sh          # macOS screen 기반 시연 스크립트
├── backend/
│   ├── main.py                 # FastAPI 엔트리 (lifespan에서 ChromaDB 시딩)
│   ├── requirements.txt
│   ├── .env.example            # ANTHROPIC_API_KEY / CLAUDE_MODEL / CHROMA_PERSIST_DIR / CORS_ORIGINS
│   ├── agents/
│   │   ├── state.py            # AgentState, UserProfile, NodeEvent
│   │   ├── graph.py            # 10노드 StateGraph 조립 + reflection 라우팅
│   │   ├── mock_responses.py   # 키/없이 동작하는 Mock 로직
│   │   ├── utils.py
│   │   └── nodes/              # 10개 노드 각 파일
│   ├── rag/
│   │   ├── sample_data.py      # 복지 정책 샘플 데이터
│   │   ├── embedder.py         # 시딩/검색 (seed_chromadb, search_policies, warmup)
│   │   └── chromadb_client.py
│   ├── api/
│   │   ├── routes.py           # REST API
│   │   ├── websocket.py        # /ws/analyze 스트리밍
│   │   └── chat.py             # /ws/chat 복지 Q&A 챗봇 (RAG + Mock 폴백)
│   ├── mocks/
│   │   ├── gov24_api.py        # 정부24 API Mock + 발급문서 HTML 스토어
│   │   └── document_generator.py
│   ├── rpa/                    # Playwright 실제 브라우저 자동화
│   │   ├── base.py             # 브라우저 컨텍스트/스크린샷 유틸
│   │   ├── manager.py          # RPATask 생명주기 + 지원 문서/서비스 목록
│   │   ├── gov24_rpa.py        # 정부24 (등본·초본·가족관계·장애인증명)
│   │   ├── nhis_rpa.py         # 건강보험 자격득실확인서 (카카오 간편인증)
│   │   ├── work24_rpa.py       # 고용보험 피보험자격 이력
│   │   └── apply_rpa.py        # 복지 서비스 신청 자동화
│   └── tests/                  # conftest.py, test_mock_mode.py
└── frontend/
    ├── src/
    │   ├── App.tsx             # idle→running→complete 3단계 화면
    │   ├── hooks/
    │   │   ├── useAgentWebSocket.ts   # 노드 스트리밍 수신
    │   │   └── useSpeechInput.ts      # Web Speech API 음성 입력
    │   ├── lib/benefit-calc.ts        # 혜택 금액 계산기
    │   ├── components/         # ProfileForm, NodeStatusPanel, Dashboard, ChatBot,
    │   │                       #   PolicyList, DocumentList, ApplyPanel, RpaDocumentPanel,
    │   │                       #   WelfareCalculator, LocalOfficeInfo, ui/*
    │   └── types/index.ts
    ├── package.json
    └── vite.config.ts
```

---

## 주요 API 엔드포인트 (`/api`)

| Method | Path | 설명 |
|--------|------|------|
| WS  | `/ws/analyze` | LangGraph 실행 + 실시간 노드 스트리밍 |
| WS  | `/ws/chat` | 복지 Q&A 챗봇 (RAG + Mock 폴백) |
| GET | `/api/health` | 상태 + mock/production 모드 + ChromaDB 건수 |
| POST| `/api/search` | 복지 정책 RAG 검색 |
| POST| `/api/estimate` | 프로필 기반 혜택 금액 즉시 추정 (AI 미사용) |
| POST| `/api/documents/issue` | Mock 서류 발급 |
| GET | `/api/documents/view/{receipt}` | 발급 서류 HTML 뷰 |
| GET | `/api/documents/rpa-supported` | RPA 지원 서류 목록 |
| POST| `/api/documents/rpa-issue` | 실제 브라우저 RPA 서류 발급 시작 → task_id |
| GET | `/api/documents/rpa-status/{task_id}` | RPA 진행 상태(스크린샷 포함) |
| GET | `/api/apply/supported` | 신청 자동화 지원 서비스 목록 |
| POST| `/api/apply/start` | 복지 서비스 신청 RPA 시작 |
| GET | `/api/apply/status/{task_id}` | 신청 RPA 상태 |
| POST| `/api/admin/seed` | ChromaDB 시딩 (Mock 모드 스킵) |
| GET | `/api/admin/env` | 환경변수 상태(마스킹) |

### RPA 지원 항목 (`rpa/manager.py`) — 2026-07 확장(6→11→15종)
- **서류 15종**: 주민등록등본/초본·가족관계증명서·장애인증명서 + **소득금액증명·지방세 납세증명서·
  지방세 세목별 과세증명서·기초생활수급자 증명서·한부모가족 증명서**(정부24, `gov24_rpa.DOC_CAPP` 단일소스,
  CappBizCD는 CDP local_agent·확장과 동일 검증) + **국세 납세증명서·출입국사실증명·병적증명서·건강보험료
  납부확인서**(07-11 AA020 실측 확장 — 납부확인서는 영숫자 코드) + 건강보험 자격득실확인서(건보) +
  고용보험 피보험자격 이력내역서(고용24). 프론트 `officialLinks.LOCAL_RPA_DOCS`와 반드시 일치.
  보류: 차상위계층 확인서(폼 미확인·자격한정), 국민연금 가입증명(정부24 즉시발급 불가 — 3일 신청 민원).
  **인증수단 선택**(카카오·PASS·네이버·토스): `base.AUTH_PROVIDERS`+`click_provider_in_anyid`, 요청 `auth_provider`.
- **신청 서비스**: 하드코딩 6종(기초연금·아동수당·부모급여·청년내일저축·첫만남·생계급여) **+ 일반화** —
  `apply_rpa.resolve_apply_url`이 정책의 복지로 딥링크(`profile.apply_url`, wlfareInfoId)를 우선 사용해
  6종 밖 임의 복지로 정책도 신청(`_valid_bokjiro_url`로 복지로 https 호스트만 허용).
- **연쇄 발급('전부 자동발급')**: `orchestrator` journey 엔진 → `/api/journey/run`·`/status`(local_server+routes,
  `journey_view`가 현재단계 라이브 카카오 안내 병합). 데스크탑앱·확장 양쪽에서 한 번 인증에 순차 발급.
- **데스크탑앱**: PyInstaller onedir(`agent_entry.py`→`local_server`, 시스템 크롬, dist-app 동일출처 서빙, chromium 미번들)
  빌드·기동 검증됨(78MB ZIP). ⚠️ 아직 GitHub Releases 미게시(사용자 자격증명 필요) — 홈 RpaShowcase에 Windows CTA(릴리스 페이지).

---

## 컨벤션

- **커밋 메시지**: Conventional Commits + 한국어 설명.
  예) `feat(frontend): 음성 입력 기능 추가`, `fix(rpa): 카카오톡 클릭 좌표 방식 교체`
  스코프: `frontend` / `backend` / `rpa` / `voice` 등.
- **AI 서명 금지**: 커밋·코드·파일 어디에도 `Co-Authored-By: Claude`나
  "Generated with" 류 흔적을 넣지 않는다.
- **주석/문서**: 한국어 위주. 함수 docstring에 흐름을 단계별로 적는 스타일.
- **노드 추가 패턴**: `agents/nodes/`에 노드 파일 작성 → `graph.py`에 등록·엣지 연결 →
  Mock 분기는 `mock_responses.py`에 대응 함수 추가 → `AgentState`에 필요한 필드 추가.
- **신규 기능은 Mock 모드에서도 동작**해야 한다(데모 전제).

---

## 알려진 상태 / 주의점

- LLM은 전 구간 **Anthropic Claude**(`langchain-anthropic`) 사용. 키는
  `ANTHROPIC_API_KEY`. (과거 README에 남아있던 OpenAI/GPT-4o 표기는 정리 완료)
- `CLAUDE_MODEL` 기본값은 모든 파일에서 **`claude-sonnet-4-6`** 으로 통일됨
  (10노드를 매 분석마다 실행하므로 비용·속도 기준 Sonnet). 노드/라우트/`.env.example`/
  docker-compose/chat 모두 일치. 모델 교체는 `.env`의 `CLAUDE_MODEL` 한 곳으로 제어.
- RPA(`nhis_rpa.py` 등)는 **실제 정부 사이트 + 카카오 간편인증**에 의존 → 사이트 DOM
  변경에 취약. 최근 커밋 다수가 카카오톡 클릭/폼 입력 안정화 작업.
- 미완성 표식은 거의 없음. `PolicyList.tsx`에 "신청 가이드 정보가 준비 중입니다"
  플레이스홀더 한 곳 존재.
- `sample_data.py`에는 복지 정책 **120건**이 들어있어 UI의 "120+" 표기와 일치.
  단, 헬스체크의 `seeded` 플래그는 60건 이상이면 true인 하한 기준임.
