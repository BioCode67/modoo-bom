# 복지정책 카탈로그 ETL

"사이트마다 복지정책이 흩어져 있어 사용자가 불편한" 문제를 해결하기 위해,
**정부 공식 공개데이터**의 복지서비스 목록을 모아 단일 카탈로그
(`frontend/public/policies.json`)로 만든다. 프론트엔드는 이 파일을 런타임에
자동 병합(`src/data/catalog.ts`)하므로 **코드 수정·재빌드 없이** 정책 수를
수백~수천 건으로 확장·갱신할 수 있다.

> ⚠️ 가짜 데이터는 생성하지 않는다. 실제 공개데이터만 정규화한다.

## 방법 1 — CSV (키 불필요, 가장 쉬움 · 중앙부처 367건)

1. 공공데이터포털에서 **로그인 없이** CSV 다운로드:
   <https://www.data.go.kr/data/15083323/fileData.do> → `[다운로드]`
2. 변환:
   ```bash
   cd backend
   source venv/bin/activate
   python etl/ingest_welfare.py --csv ~/Downloads/한국사회보장정보원_복지서비스정보_*.csv
   ```
3. `frontend/public/policies.json` 생성됨 → 배포:
   ```bash
   cd ../frontend && npm run deploy
   ```

## 방법 2 — OpenAPI (무료 키 필요, 가장 포괄적 · 중앙부처 1,600+건 + 지자체 수천 건)

1. 공공데이터포털 회원가입 → **한국사회보장정보원_중앙부처복지서비스** 및
   **_지자체복지서비스**(B554287) "활용신청"(개발계정 즉시 승인).
2. 발급받은 **디코딩 키**를 환경변수로 설정하고 중앙+지자체 한 번에:
   ```bash
   export DATA_GO_KR_SERVICE_KEY='발급키'
   python etl/ingest_welfare.py --api --local
   ```
   - `--api` 중앙부처만 / `--local` 지자체만 / 둘 다 주면 합쳐서 수집.
   - 지자체 항목은 지역(`[서울특별시 강남구]`)이 대상에 표기되고 id가 `LOC-`로 부여됨.
3. 배포: `cd ../frontend && npm run deploy`

> CSV·API를 함께 줘도 됩니다(`--csv a.csv,b.csv --api --local`). id 기준 중복 제거됩니다.

## 동작
- 소스 필드 → 우리 `Policy` 스키마로 정규화(이름/소관부처/요약/신청URL 등).
- 서비스명·요약 키워드로 카테고리 자동 분류(노인/청년/장애인/저소득/주거/의료/고용/교육/문화/가족 …).
- id는 `GOV-<서비스ID>`로 부여(내장 시드 `POL-xxx`와 충돌 없음, 병합 시 중복 제거).
- 일부 필드(필요서류 등)는 소스에 없으면 비워두고 신청처/요약으로 보강.

## 출력 예시
```json
[{ "id": "GOV-...", "name": "...", "category": "노인", "target": "...",
   "benefit": "...", "eligibility": "...", "required_docs": [],
   "application": "https://www.bokjiro.go.kr", "department": "보건복지부",
   "renewal": "기관 안내 확인" }]
```

## 데이터 출처
- 한국사회보장정보원_복지서비스정보(중앙부처) — data.go.kr/data/15083323
- 한국사회보장정보원_중앙부처복지서비스(B554287 OpenAPI) — data.go.kr/data/15090532
- (확장) 지자체 복지서비스 데이터셋도 동일 방식으로 추가 가능
