# 로컬 데스크탑 앱 빌드(--mode app) 전용 환경.
# 백엔드(localhost:8000)가 프론트까지 직접 서빙 → API/WS는 '동일 출처'로 호출한다.
# 그래서 VITE_API_BASE는 비워둔다(''): backend.ts가 동일출처 백엔드를 감지해 AI+RPA를 모두
# localhost:8000으로 라우팅한다. 동일 출처라 CORS·PNA·LNA 권한 프롬프트가 전혀 없어
# 자동 서류발급이 매끄럽게 동작한다.
VITE_API_BASE=

# 로그인·동기화(Supabase)는 로컬 앱에서 기본 비활성(번들 경량화·PII 최소화).
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
