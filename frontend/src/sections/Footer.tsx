import { SproutLogo } from '@/ui/SproutLogo'

export function Footer() {
  return (
    <footer className="border-t border-sprout-100 bg-white/70 mt-8">
      <div className="page-container py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <SproutLogo withFace className="h-8 w-8" />
            <div>
              <p className="font-extrabold gradient-text leading-tight">모두봄</p>
              <p className="text-[11px] text-muted-foreground">모두의 봄날을 위한 복지 도우미</p>
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground">
            <p>2026 AI·SW 중심대학 디지털 경진대회 SW부문</p>
            <p className="mt-0.5 text-muted-foreground">React · Three.js · FastAPI · LangGraph · Claude AI</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="btn-ghost">복지로</a>
            <a href="https://www.gov.kr" target="_blank" rel="noopener noreferrer" className="btn-ghost">정부24</a>
            <a href="tel:129" className="btn-ghost">129 상담</a>
            {/* 피드백 채널 — 기존 복지앱의 '항의해도 응답 없음' 불만 대응: 닿는 창구를 명시 */}
            <a
              href="mailto:6wngud@gmail.com?subject=%5B%EB%AA%A8%EB%91%90%EB%B4%84%5D%20%EC%9D%98%EA%B2%AC%C2%B7%EB%B6%88%ED%8E%B8%20%EC%8B%A0%EA%B3%A0&body=%EA%B2%AA%EC%9C%BC%EC%8B%A0%20%EB%B6%88%ED%8E%B8%EC%9D%B4%EB%82%98%20%EB%B0%94%EB%9E%8C%EC%9D%84%20%EC%A0%81%EC%96%B4%EC%A3%BC%EC%84%B8%EC%9A%94.%20%EB%B9%A0%EB%A5%B4%EA%B2%8C%20%EA%B3%A0%EC%B9%A0%EA%B2%8C%EC%9A%94!%0A%0A%E2%80%A2%20%EC%96%B4%EB%96%A4%20%ED%99%94%EB%A9%B4%EC%97%90%EC%84%9C%3A%20%0A%E2%80%A2%20%EB%AC%B4%EC%97%87%EC%9D%B4%20%EB%B6%88%ED%8E%B8%ED%96%88%EB%82%98%EC%9A%94%3A%20"
              className="btn-ghost text-sprout-700"
            >
              💬 의견 보내기
            </a>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-center gap-3 text-[11px]">
          <a href={`${import.meta.env.BASE_URL}privacy.html`} className="text-muted-foreground hover:text-sprout-700 hover:underline">개인정보처리방침</a>
          <span className="text-muted-foreground/40">·</span>
          <a href={`${import.meta.env.BASE_URL}terms.html`} className="text-muted-foreground hover:text-sprout-700 hover:underline">이용약관</a>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          ⓘ 본 서비스의 분석 결과는 참고용이며, 최종 수급 자격은 주민센터·복지로에서 확인하세요.
        </p>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          데이터 출처: 한국사회보장정보원 복지서비스 공공데이터(2026 기준) + 자체 큐레이션 · 금액은 연도별로 변동될 수 있어요
        </p>
        {/* 지금 보는 번들의 버전·빌드일 — 화면 제보가 오면 최신 배포와 대조해 '이전 캐시'를 1초에 판정
            (PWA 캐시·미갱신 데스크탑 빌드로 옛 화면을 보고 있는 경우가 실제로 있었음) */}
        <p className="mt-1 text-center text-[10px] text-muted-foreground/70">
          모두봄 v{__APP_VERSION__} · 빌드 {__BUILD_DATE__}{__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}
        </p>
      </div>
    </footer>
  )
}
