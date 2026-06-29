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
            <p className="mt-0.5 text-muted-foreground/70">React · Three.js · FastAPI · LangGraph · Claude AI</p>
          </div>
          <div className="flex gap-2">
            <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="btn-ghost">복지로</a>
            <a href="https://www.gov.kr" target="_blank" rel="noopener noreferrer" className="btn-ghost">정부24</a>
            <a href="tel:129" className="btn-ghost">129 상담</a>
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground/60">
          ⓘ 본 서비스의 분석 결과는 참고용이며, 최종 수급 자격은 주민센터·복지로에서 확인하세요.
        </p>
      </div>
    </footer>
  )
}
