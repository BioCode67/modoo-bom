# 배포 체크리스트 (DEPLOY_CHECKLIST) — Render 상시배포

> 대상: 프로젝트 소유자가 **Render 대시보드에서 직접** 수행하는 절차.
> 목표: 클라우드 백엔드(AI 분석·추천·챗봇·검색)를 상시 가동하고, 배포된 프론트(github.io)와 연결.
> 실제 RPA(서류발급/자동신청)는 클라우드가 아닌 **로컬 에이전트**가 담당한다(→ DEMO_GUIDE.md).

## 0. 준비물
- GitHub 저장소: `BioCode67/modoo-bom` (이미 푸시됨)
- (권장) 무료 AI 키 1개: **Google Gemini** — https://aistudio.google.com/app/apikey
  - 없어도 규칙기반으로 동작하지만, 진짜 AI 분석/챗봇을 켜려면 필요.

## 1. Render 웹 서비스 생성
1. https://render.com 로그인 → **New +** → **Web Service**
2. **Build and deploy from a Git repository** → `BioCode67/modoo-bom` 연결
3. 설정:
   - **Name**: `modoo-bom-api`
   - **Region**: Singapore (한국 근접)
   - **Root Directory**: `backend`
   - **Runtime**: `Docker` (backend/Dockerfile 자동 감지)
   - **Instance Type**: `Free`
4. (대안) 저장소 루트의 **`render.yaml`** 로 **Blueprint** 생성해도 됨(New + → Blueprint).

## 2. 환경변수 (Environment) 입력
| Key | Value | 비고 |
|---|---|---|
| `RAG_LIGHT` | `1` | **필수**. BM25 검색으로 512MB OOM 방지(임베딩 미로드) |
| `RPA_DISABLED` | `1` | **필수**. 클라우드에서 RPA 비활성(개인정보 서버 유입 차단) |
| `CORS_ORIGINS` | `https://biocode67.github.io,http://localhost:5173` | **필수**. 배포 웹 허용 |
| `AI_PROVIDER` | `gemini` | 무료 Gemini 사용 |
| `GEMINI_API_KEY` | `(발급받은 키)` | 있으면 AI 활성, 없으면 규칙기반 |
| `GEMINI_MODEL` | `gemini-2.0-flash` | 기본 무료 모델 |
| `CHROMA_PERSIST_DIR` | `/tmp/chroma_db` | (경량 모드에선 미사용) |

> Groq를 쓰려면 `AI_PROVIDER=groq` + `GROQ_API_KEY` 입력. 아무 키도 없으면 규칙기반으로 동작.

## 3. 배포 & 헬스체크
1. **Create Web Service** → 빌드/배포 대기(수 분)
2. 발급된 URL 확인 (예: `https://modoo-bom-api.onrender.com`)
3. 브라우저로 **`<URL>/api/health`** 열기 → 다음 확인:
   ```json
   { "status": "ok",
     "capabilities": { "ai": true, "rpa": false, "ai_provider": "gemini:gemini-2.0-flash", "rag": "bm25(경량)" } }
   ```
   - `ai: true` 면 AI 키 인식 성공. `false` 면 키/AI_PROVIDER 재확인.

## 4. 프론트와 연결 (재배포)
1. 로컬에서 `frontend/.env.production` 편집:
   ```
   VITE_API_BASE=https://modoo-bom-api.onrender.com   # ← 3번에서 받은 실제 URL
   ```
2. 재배포:
   ```bash
   cd frontend && npm run deploy
   ```
3. https://biocode67.github.io/modoo-bom/ 접속 → 첫 접속은 **콜드스타트(30~60초)**.
   프론트가 자동으로 웨이크업 재시도하므로 잠시 기다리면 AI 기능이 활성화됨.

## 5. 최종 확인
- [ ] `/api/health` 가 `ai:true` 반환
- [ ] 배포 웹에서 복지 분석/챗봇이 AI로 응답(규칙기반 문구가 아니라 자연스러운 답변)
- [ ] 배포 웹에 **"자동발급 가능" 배지가 뜨지 않음**(클라우드 `rpa:false` 이므로 정상)
- [ ] 서류/신청은 공식 링크로 연결됨

## 6. 무료 티어 주의
- **콜드스타트**: 15분 무접속 시 슬립. 발표 직전 `/api/health` 를 한 번 열어 **미리 깨워두기**.
- **월 사용시간 한도**(Free 750h/월): 단일 서비스면 상시 가동 가능.
- 디스크 비영구: 경량(BM25) 모드라 재시작해도 policies.json 인메모리 색인만 재구축(빠름).

## 7. 롤백
- 프론트만 되돌리려면: 직전 `gh-pages` 커밋으로 되돌리고 재배포.
- 백엔드는 Render 대시보드 → Deploys → 이전 성공 배포 **Rollback**.
