# 데이터 출처 (DATA_SOURCES)

> 모두봄은 **가짜/Mock 복지 데이터를 만들지 않습니다.** 아래의 정부 공식 공개데이터만
> 정규화·구조화해 사용합니다. 각 수집 경로와 라이선스, 실제 수집 건수를 명시합니다.

## 1. 복지 정책 카탈로그 — `frontend/public/policies.json`

| 항목 | 내용 |
|---|---|
| 원천 | 공공데이터포털(data.go.kr) **한국사회보장정보원 복지서비스정보** |
| 중앙부처 API | `NationalWelfareInformationsV001` (활용신청 B554287) — 목록 `NationalWelfarelistV001` + 상세 `NationalWelfaredetailedV001` |
| 지자체 API | `LocalGovernmentWelfareInformations/LcgvWelfarelist` |
| 공개 CSV(키 불필요) | 한국사회보장정보원_복지서비스정보 (data.go.kr/data/15083323) |
| 인증 | 디코딩 서비스키(`DATA_GO_KR_SERVICE_KEY`, `backend/.env`) |
| 라이선스 | 공공데이터 이용약관(출처표시, 상업적 이용 가능) — data.go.kr 각 데이터셋 고지 |
| ETL | `backend/etl/ingest_welfare.py` (`--api` 중앙 / `--local` 지자체 / `--csv` / `--enrich` 상세승격) |

### 수집·구조화 필드
- 기본(목록): `name`, `category`(키워드 추론), `target`, `benefit`, `eligibility`,
  `application`(실제 복지로/온라인 신청 딥링크), `department`, `contact`
- 상세 승격(`--enrich`, 중앙부처 상세 API): `benefit`=지원내용(alwServCn),
  `target`=대상 상세(tgtrDtlCn), `eligibility`=선정기준(slctCritCn),
  `required_docs`=서식/구비서류(servSeCode 040), `application`=온라인 신청 실제 URL(servSeCode 020),
  `apply_method`=신청방법(070), `contact`=대표문의(rprsCtadr), `crtr_yr`=기준연도
- 파생(원문 기반, `enrich_fields`): `amount_krw`/`amount_text`(실제 지원내용 문장의 금액 파싱, 월 우선),
  `is_cash`(현금성 여부), `conditions`(나이/소득/가구 조건 태그)
  → **금액을 지어내지 않습니다.** 원문에 금액이 없으면 `amount_krw=null`.

### 실제 수집·구조화 건수 (현재 policies.json 기준)
- 중앙부처(GOV-): **463건** · 지자체(LOC-): **4,598건** → **합계 5,061건** (이름 기준 디듑, 시드 우선)
- 텍스트 파생(`--derive`, 실제 지원내용/대상 문장 파싱): **현금성 1,368건 · 조건태그 3,304건 · 금액추출 79건**
  - 금액추출이 79건인 이유: 공공데이터 목록은 요약형이라 금액이 문장에 드러난 항목만 파싱(값을 지어내지 않음).
    정밀 금액은 ① 시드 120건(수작업 검증) ② 상세 승격(`--enrich`)으로 보강.

### 재생성 방법
```bash
cd backend && source venv/Scripts/activate   # (Windows: venv\Scripts\activate)
export DATA_GO_KR_SERVICE_KEY=<디코딩키>
python etl/ingest_welfare.py --api --local     # 목록 수집 → policies.json
python etl/ingest_welfare.py --derive          # (네트워크 불필요) 금액/조건/현금성 파생필드 부여
python etl/ingest_welfare.py --enrich          # (상세 API) 중앙부처 금액·서류·온라인신청URL 승격
# 프론트 반영: cd ../frontend && npm run deploy
```
> ⚠️ **상세 API 쿼터**: `NationalWelfaredetailedV001` 은 일일 호출 쿼터가 있어("API token quota exceeded")
> `--enrich` 는 쿼터 리셋(자정 KST 경) 후 실행 권장. `--derive` 는 쿼터와 무관하게 항상 동작.

## 2. 정밀 시드 정책 — `frontend/src/data/policies.ts` / `backend/rag/sample_data.py`
- 기초연금·생계급여·청년도약계좌·국가장학금 등 **고가치 현금성 지원 120건**을
  2026년 공식 선정기준·금액으로 수작업 검증(보건복지부·복지로·한국장학재단 등 공식 고지 기준).
- 공공데이터(요약형)보다 정확한 규칙 판정을 위해 유지. 카탈로그와 이름 기준 디듑(시드 우선).

## 3. RAG 색인 — ChromaDB
- `backend/rag/seed_from_catalog.py` 가 위 카탈로그를 임베딩(sentence-transformers 내장)해 시딩.
- 메모리 제약 배포(예: Render 무료 512MB)에서는 `--limit`/`RAG_MAX_DOCS` 로 현금성·상세보유 정책 우선 시딩,
  또는 임베딩 없이 **BM25/키워드 폴백**(`backend/rag/bm25_search.py`)으로 동작.

## 4. 개인정보 원칙
- 사용자 프로필·인증정보(주민번호 등)는 **서버에 저장/로깅하지 않습니다.**
  분석·RPA 처리 중 메모리에서만 사용하고 응답 후 폐기합니다. (로컬 에이전트 RPA는 사용자 PC에서 실행)
