/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// 빌드타임 주입 상수(vite.config.ts define) — 푸터 버전 표기로 '지금 보는 번들'을 즉시 진단
// (스테일 캐시 제보 대응: 화면의 v·빌드일이 최신 배포와 다르면 새로고침 안내로 1초 판정)
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
// 빌드 커밋 short SHA(git 없으면 빈 문자열) — 데스크탑 exe 신선도를 커밋 단위로 확정
declare const __BUILD_SHA__: string
