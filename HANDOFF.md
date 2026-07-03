# 🧳 모두봄 — 새 노트북 인수인계 가이드 (손실 없이 그대로 이어가기)

> 학교 노트북 반납 등으로 작업 환경을 옮길 때, **코드·비밀키·클로드 작업기록**을 하나도 잃지 않고
> 다른 노트북에서 똑같이 이어가기 위한 안내입니다.

---

## 📦 지금 무엇이 어디에 있나

| 항목 | 위치 | 새 노트북에서 |
|---|---|---|
| **소스 코드 전체** | GitHub `BioCode67/modoo-bom` (모두 푸시됨) | `git clone` |
| **비밀키 `.env` 2개** | 로컬만 (gitignore, GitHub에 없음) | 백업본에서 **복원** |
| **클로드 대화기록/메모리** | 로컬 `~/.claude/...` (GitHub에 없음) | 백업본을 **복사** |
| **프로젝트 컨텍스트·작업흐름** | `CLAUDE.md`·`LAUNCH.md`·git log (GitHub) | 자동 따라옴 |
| node_modules / venv / 빌드물 | 로컬 (재생성 가능) | `npm install` / `pip install`로 재생성 |

> 라이브 사이트: https://biocode67.github.io/modoo-bom/ (GitHub Pages, `gh-pages` 브랜치)

---

## 1️⃣ 옮기기 전 — 현재 노트북에서 백업 만들기

프로젝트 루트에서 아래 스크립트를 실행하면 **비밀키 + 클로드 메모리 + (선택)대화기록**을
Desktop에 하나의 압축파일로 묶어줍니다. 이 파일을 **USB나 클라우드 드라이브(구글드라이브 등)** 로 옮기세요.

```bash
cd ~/Desktop/modoo-bom && bash scripts/backup-handoff.sh
```

- 만들어지는 파일: `~/Desktop/modoo-bom-handoff-YYYYMMDD.tar.gz`
- 포함: `frontend/.env`, `backend/.env`(비밀키), 클로드 메모리, (원하면) 대화기록 전체
- ⚠️ 이 압축파일은 **비밀키가 들어있으니 GitHub·공개된 곳에 올리지 마세요.** USB/개인 클라우드로만.

> 대화기록(≈115MB)이 너무 크면 스크립트가 물어봅니다(메모리만 담기 / 전체 담기 선택).

---

## 2️⃣ 새 노트북에서 — 명령어 **한 줄**로 전부 자동 (clone→복원→설치→실행)

**준비:** 구글드라이브의 백업(`modoo-bom-handoff-*.tar.gz`)을 새 노트북 **Downloads 폴더로 다운로드**만 해두세요.

그다음 터미널에 **이 한 줄**을 붙여넣으면 끝:
```bash
curl -fsSL https://raw.githubusercontent.com/BioCode67/modoo-bom/main/scripts/setup-new-laptop.sh | bash
```

이 한 줄이 알아서 다 합니다:
1. 코드 `git clone` → `~/Desktop/modoo-bom`
2. 백업 자동 복원 — `frontend/.env`·`backend/.env` **비밀키** + 클로드 **메모리·대화기록**(사용자명 달라도 경로 자동 계산)
3. `npm install` (의존성 설치)
4. `npm run dev` → 브라우저에서 **http://localhost:5173** (종료: Ctrl+C)

> 백업 파일이 없어도 앱은 **전 기능 동작**(로그인·백엔드 RPA만 비활성). 나중에 `bash scripts/restore-handoff.sh` 로 복원 가능.
> git/node가 없다는 메시지가 뜨면 안내대로 `xcode-select --install`(git), [nodejs.org](https://nodejs.org)(node LTS) 설치 후 다시 실행.
>
> **백엔드(RPA)까지** 쓰려면: `cd ~/Desktop/modoo-bom/backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`

---

## 3️⃣ 클로드 코드 작업기록 (자동 복원됨)

위 `restore-handoff.sh` 가 클로드 메모리·대화기록까지 복원하므로 **수동 작업이 없습니다.**
(수동으로 하려면: 백업의 `claude-memory/`→`~/.claude/projects/-Users-<사용자명>/memory/`,
`claude-history/`→`~/.claude/projects/-Users-<사용자명>-Desktop/`. `-Users-it`은 경로 인코딩이라 사용자명이 다르면 그 부분만 교체.)

> **핵심 컨텍스트는 이미 `CLAUDE.md`(레포)와 `memory/`에 정리돼 있어**, 대화기록이 없어도 새 노트북에서
> 프로젝트 폴더에서 클로드 코드를 열면 흐름을 이어갑니다. 대화기록까지 복원하면 지난 대화도 열람돼요.

---

## 4️⃣ 작업 흐름·의사결정은 어디에 남아있나 (읽을거리)

- **`CLAUDE.md`** — 프로젝트 전체 구조·기능·데이터·품질·자동화 현실·주의점 (항상 최신 유지)
- **`LAUNCH.md`** — 앱스토어/Play 출시 단계
- **`~/.claude/.../memory/`** — 배포 방식·토큰 제약·최근 작업 요약 등 핵심 메모
- **git log** — 커밋 하나하나가 작업 단위(한국어 설명). `git log --oneline` 로 전체 흐름 확인

---

## 5️⃣ 배포(재확인)

- 재배포: `cd frontend && npm run deploy` (gh-pages 갱신) + `git push origin main`(소스) — **둘은 별개**
- ⚠️ **Pages 빌드 무실행 이슈(실제 발생 2026-07-03)**: deploy가 Published 돼도 라이브가 구 버전을 계속 서빙하고
  새 에셋이 404면, gh-pages 브랜치는 정상인데 **GitHub Pages 빌드가 조용히 실행 안 된 것** →
  `npm run deploy` 한 번 더(새 커밋이 빌드 재트리거)로 해결. 검증: 라이브 index.html이 참조하는 번들 해시가
  dist와 일치하는지 curl로 확인.
- 로그인 끄고 배포(OAuth 등록 전): `mv frontend/.env .env.hold && npm run deploy && mv .env.hold .env`
- ⚠️ 이 계정 PAT에 `workflow` 스코프가 없어 `.github/workflows`는 푸시 불가 → gh-pages 방식 유지

---

## 6️⃣ 프로젝트 현재 상태 & 열린 TODO (2026-07-03 세션)

> 새 노트북에서 클로드 코드를 열면 이 절부터 읽고 이어가면 됩니다. 상세는 `CLAUDE.md`·`DATA_SOURCES.md`·
> `DEPLOY_CHECKLIST.md`·`DEMO_GUIDE.md`, 그리고 `~/.claude/.../memory/`(백업에 포함).

**핵심 성과 (이번 세션의 큰 축 = 크롬 확장)**
- **크롬 확장(`extension/`)이 핵심 기능**: 배포 사이트에서 **로컬서버 없이** 사용자 브라우저 안에서
  정부 서류발급·복지신청을 자동화. 순수 웹은 동일출처 정책으로 정부사이트 조작 불가 → 확장이 답.
- **접근 사이트 6개**(정부24·건강보험공단·고용24·국민연금공단·복지로·한국장학재단) —
  전부 실서버에서 **로그인→간편인증 클릭까지 자동 도달** 검증(`extension/validate_live.py`).
  본인인증(카카오)·최종제출은 사용자 직접(설계상 안전장치). 완전 무인 아님.
- 서류 다수 + **복지로 신청은 카탈로그 전 정책 일반화**(프론트가 정책의 실제 딥링크를 확장에 전달).
- 능동형 에이전트 3종: 선제 생애 타임라인(`lib/lifeAgent.ts`)·연속성 카드(`lib/continuity.ts`)·
  에이전트 브리핑(`components/AgentBriefing.tsx`). 전부 온디바이스(서버 미전송).
- **챗봇 → 개인화·행동형 에이전트 승격**(`lib/chatAgent.ts`): 프로필 기반 "내가 뭐 받을 수 있어?" 답변,
  답변 속 복지 채팅에서 바로 담기, 대화 맥락 기억("그거/첫번째/다 담아줘"=`matchSaveIntent`),
  열면 급한 마감·서류 먼저 브리핑. 전부 규칙엔진(LLM/서버 없음).
- **UI 테마**: '정부24 블루' 리테마를 시도했으나 사용자 판단으로 **원래 봄/새싹 초록 테마로 되돌림**(revert).
  단, 상태 의미색 분리(`success-*` 팔레트, KRDS식 브랜드≠상태색)는 유지 — 현재 값이 초록이라 시각 차이는
  없지만, 이후 브랜드색을 바꿔도 성공 표시는 안전하게 초록으로 남는 구조.
- **'D-3 고정' 일정 버그 수정**(`lib/calendar.ts`): 준비 일정이 `Date.now()+3일`로 매번 리셋되던 것을
  `savedAt` 앵커로 → 실제 카운트다운. 급한 기한 정책은 하루 앞당김 + 실제 기한 텍스트 노출.
- 설치: 지금은 `chrome://extensions` 개발자모드 로드. 웹스토어 제출 패키지 준비됨(`extension/build.ps1`,`STORE.md`).

**열린 TODO (우선순위 순)**
1. **[완료] 복지로 wlfareInfoId 정정 — 죽은 2건이 아니라 6건 전부 오류였음**: 라이브 복지로에서 각 ID의
   페이지 `wlfareInfoNm`을 실측 대조한 결과 `SERVICE_URLS`(및 `apply_rpa.py` `SERVICE_APPLY_URLS`) 6개가
   모두 잘못됨을 발견. 부모급여·첫만남은 죽은 ID(147byte), 나머지는 타 서비스로 재배정(아동수당 ID→국가보훈
   명예수당, 청년내일저축 ID→참전유공자 명예수당, 생계급여 ID→에너지 취약계층 조명기기 등). `policies.json`의
   올바른 ID로 6건 교체(기초연금 WLF00001164/아동수당 WLF00001171/부모급여 WLF00004657/청년내일저축 WLF00000060/
   첫만남 WLF00004656/생계급여 WLF00001132). 검증법: `moveTWAT52011M.do?wlfareInfoId=<ID>` 응답의 `wlfareInfoNm` 확인.
2. **[완료] 정부24 코드 감사(재검증)**: 9종 CappBizCD 전부 `AA020InfoCappView.do?CappBizCD=<코드>` title(EUC-KR)
   실측으로 올바름 확인(가족관계 97400000004·장애인 14600000273 포함, 커밋 40aa81d 유효). 백엔드 3종도 일치.
   6개 사이트 로그인/발급 URL 생존도 실측 확인(gov24·nhis·work24·nps·bokjiro·gov24발급 모두 응답).
3. **end-to-end 미검증**: 본인인증 이후(폼작성→발급/제출)는 실계정 필요 → 미확인. 데모 준비 때 실계정 1건 끝까지 시연(`DEMO_GUIDE.md`).
4. **[일부 완료] 쉬운 말 2차 정비**: 프로필 위저드 소득 섹션('기준 중위소득'→쉬운 설명+생활어 병기)·장애 정도
   (폐지된 1/2/3급→현행 '심한/심하지 않은 장애', 저장값은 엔진 호환 유지) 정비 완료. 용어사전에 '장애 정도' 항목
   추가, 신청서 미리채움도 `disabilityLabel()`로 현행 용어 일관화(+테스트 4). 결과 화면(Glossary 링크로 커버됨)·
   챗봇은 이미 쉬운 말이라 손 안 댐. 남으면 결과 카드 세부 문구 정도.
5. **웹스토어 실제 제출**(개발자 등록 $5) → 일반인 원클릭 설치.
6. **[신규] 백엔드 패리티**: 민간재단 9건(PRV-###)은 프론트 시드에만 있음 — 백엔드 `rag/sample_data.py`(Mock/RAG)에는
   미반영. 백엔드 경유 분석(WS)에는 민간재단이 안 나옴. venv 구축 후 이식+pytest 확인 필요(프론트 단독 데모엔 무관).
7. **홈택스/LH 등 추가 사이트**: 홈택스=무거운 SPA(실계정 보정 필요), LH·근로복지공단=공동인증서 중심(다른 방식). 보류 중.

**검증/품질 도구**
- 실사이트 셀렉터 점검: `cd backend && python ../extension/validate_live.py "<서류명>"` (본인인증 직전까지, 개인정보 미사용)
- 코드/URL 데이터 감사: `AA020InfoCappView.do?CappBizCD=<코드>` title 확인, 복지로 `moveTWAT52011M.do?wlfareInfoId=<ID>` len 확인
- 품질 게이트: 프론트 `tsc/lint/test(206)/build`, 백엔드 `pytest(13)` — 변경마다 통과 유지.

## ✅ 체크리스트

- [ ] 현재 노트북: `bash scripts/backup-handoff.sh` 실행 → 압축파일 USB/클라우드로 이동
- [ ] (혹시 로컬에 안 밀어둔 변경 있나) `git status` 깨끗한지 확인 → 있으면 커밋·푸시
- [ ] 새 노트북: `git clone` → `.env` 복원 → `npm install`
- [ ] 새 노트북: 클로드 메모리/대화기록 폴더 복사(사용자명 다르면 폴더명 변경)
- [ ] 새 노트북: 프로젝트 폴더에서 클로드 코드 열기 → `CLAUDE.md`·메모리로 흐름 이어짐
