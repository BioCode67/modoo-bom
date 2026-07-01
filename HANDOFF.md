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

## 2️⃣ 새 노트북에서 — 코드 내려받고 복원

```bash
# (1) 코드 클론
cd ~/Desktop
git clone https://github.com/BioCode67/modoo-bom.git
cd modoo-bom

# (2) 비밀키 복원 — 백업 압축을 푼 뒤 .env 2개를 제자리에 복사
#     (압축파일을 홈에 두고) 
tar -xzf ~/modoo-bom-handoff-YYYYMMDD.tar.gz -C ~/handoff-restore
cp ~/handoff-restore/frontend.env  frontend/.env
cp ~/handoff-restore/backend.env   backend/.env

# (3) 프론트엔드 의존성 + 실행
cd frontend && npm install && npm run dev     # http://localhost:5173

# (4) (선택) 백엔드 — RPA/에이전트 쓸 때만
cd ../backend && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt && uvicorn main:app --reload --port 8000
```

`.env`가 없어도 앱은 **전 기능 동작**합니다(로그인·백엔드 RPA만 비활성). 값 구조는 `frontend/.env.example`,
`backend/.env.example` 참고. 실제 값은 백업본에 있습니다.

---

## 3️⃣ 클로드 코드 작업기록 이어가기 (대화·메모리)

클로드 코드 기록은 클라우드 동기화가 안 되므로 **로컬 폴더를 복사**해야 합니다.

- 대화기록: `~/.claude/projects/-Users-<사용자명>-Desktop/`  (JSONL 파일들)
- 메모리: `~/.claude/projects/-Users-<사용자명>/memory/`  (`MEMORY.md` + 개별 메모)

**새 노트북에서:**
1. 백업 압축의 `claude-memory/`·`claude-history/`를 새 노트북 `~/.claude/projects/` 아래에 복사.
2. ⚠️ 폴더 이름은 **경로가 인코딩**돼 있습니다(`-Users-it` = `/Users/it`). 새 노트북 사용자명이 다르면
   폴더명을 새 경로에 맞게 바꾸세요. 예: 사용자명이 `kim`이면
   `-Users-it-Desktop` → `-Users-kim-Desktop`, `-Users-it` → `-Users-kim`.
3. 같은 사용자명(`it`)이면 그대로 두면 됩니다.

> **가장 중요한 컨텍스트는 이미 `CLAUDE.md`(레포)와 `memory/`에 정리돼 있습니다.** 대화기록(JSONL)이
> 없어도, 새 노트북에서 클로드 코드를 프로젝트 폴더에서 열면 `CLAUDE.md`·메모리를 읽어 흐름을 이어갑니다.

---

## 4️⃣ 작업 흐름·의사결정은 어디에 남아있나 (읽을거리)

- **`CLAUDE.md`** — 프로젝트 전체 구조·기능·데이터·품질·자동화 현실·주의점 (항상 최신 유지)
- **`LAUNCH.md`** — 앱스토어/Play 출시 단계
- **`~/.claude/.../memory/`** — 배포 방식·토큰 제약·최근 작업 요약 등 핵심 메모
- **git log** — 커밋 하나하나가 작업 단위(한국어 설명). `git log --oneline` 로 전체 흐름 확인

---

## 5️⃣ 배포(재확인)

- 재배포: `cd frontend && npm run deploy` (gh-pages 갱신) + `git push origin main`(소스) — **둘은 별개**
- 로그인 끄고 배포(OAuth 등록 전): `mv frontend/.env .env.hold && npm run deploy && mv .env.hold .env`
- ⚠️ 이 계정 PAT에 `workflow` 스코프가 없어 `.github/workflows`는 푸시 불가 → gh-pages 방식 유지

---

## ✅ 체크리스트

- [ ] 현재 노트북: `bash scripts/backup-handoff.sh` 실행 → 압축파일 USB/클라우드로 이동
- [ ] (혹시 로컬에 안 밀어둔 변경 있나) `git status` 깨끗한지 확인 → 있으면 커밋·푸시
- [ ] 새 노트북: `git clone` → `.env` 복원 → `npm install`
- [ ] 새 노트북: 클로드 메모리/대화기록 폴더 복사(사용자명 다르면 폴더명 변경)
- [ ] 새 노트북: 프로젝트 폴더에서 클로드 코드 열기 → `CLAUDE.md`·메모리로 흐름 이어짐
