# 모두봄 (ModooBom)

> 내 복지 혜택, 모두 찾아드릴게요 🌱  
> 개인 복지 자산 관리 AI Agent · 2026 AI·SW 중심대학 디지털 경진대회 SW부문

### 🌐 라이브 데모 — **https://biocode67.github.io/modoo-bom/**

회원가입·백엔드 없이 바로 동작합니다. 프론트엔드는 120여 개 복지 정책 데이터와
자격 판정 엔진을 **브라우저 안에서** 실행하므로 즉시 로딩되고 항상 켜져 있어요.
(OpenAI/Claude 키와 FastAPI 백엔드를 연결하면 LLM 분석·RPA 자동발급 등 고급 기능이 활성화됩니다.)

**주요 기능**
- 🔎 **확인/조회** — 1분 프로필 위저드 + AI 자격 판정, 120여 종 정책 탐색·검색
- 🧮 **선택/관리** — 관심목록·신청 상태 관리·혜택 계산기·정책 비교(나의 복지)
- 🚀 **신청** — 단계별 가이드, 서류 준비 도우미, 정부24·복지로 스마트 연동
- 🎨 **3D 카툰 UI** — 새싹 마스코트(React Three Fiber) + framer-motion, 반응형·큰글씨·reduced-motion 대응

### 배포 (정적 사이트)

```bash
cd frontend
npm run deploy   # 빌드 후 gh-pages 브랜치로 배포 → GitHub Pages
```

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

```
[React 18 + Vite + shadcn/ui]
         ↕ WebSocket (실시간 노드 이벤트 스트리밍)
[FastAPI + LangGraph 10노드 StateGraph]
         ↕
[ChromaDB RAG (120건)] + [Claude / Mock] + [정부24 API Mock]
```

### LangGraph 10노드 플로우

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
| `POST` | `/api/admin/seed` | ChromaDB 50건 시딩 |
| `GET` | `/api/admin/env` | 환경변수 상태 확인 |

---

## 파일 구조

```
modoo-bom/
├── backend/
│   ├── main.py                      # FastAPI 진입점
│   ├── requirements.txt
│   ├── agents/
│   │   ├── state.py                 # AgentState (Pydantic + operator.add)
│   │   ├── graph.py                 # LangGraph StateGraph 조립
│   │   ├── mock_responses.py        # Anthropic API 없이 동작하는 Mock
│   │   └── nodes/                   # 10개 노드 (각 파일)
│   ├── rag/
│   │   ├── sample_data.py           # 복지 정책 50건
│   │   ├── embedder.py              # ChromaDB 임베딩 + 검색
│   │   └── chromadb_client.py
│   ├── api/
│   │   ├── routes.py                # REST API
│   │   └── websocket.py             # WebSocket 스트리밍
│   ├── mocks/gov24_api.py           # 정부24 API Mock
│   └── tests/
│       ├── conftest.py
│       └── test_mock_mode.py        # 유닛 + 통합 테스트
└── frontend/
    ├── src/
    │   ├── App.tsx                  # 3단계 상태: idle→running→complete
    │   ├── hooks/useAgentWebSocket.ts
    │   ├── components/
    │   │   ├── NodeStatusPanel.tsx  # 실시간 노드 상태 + 실행시간
    │   │   ├── ProfileForm.tsx      # 4종 데모 프로필
    │   │   ├── Dashboard.tsx        # 탭형 결과 대시보드
    │   │   ├── PolicyList.tsx
    │   │   └── DocumentList.tsx
    │   └── types/index.ts
    └── package.json
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
