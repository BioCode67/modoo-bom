import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { Features } from './Features'
import { Faq } from './Faq'
import { Footer } from './Footer'
import { EmergencyHelp } from '@/components/EmergencyHelp'
import { RpaShowcase } from '@/components/RpaShowcase'
import { ForeignerWelcome } from '@/components/ForeignerWelcome'

// '우리 동네 지도'는 시도 경계 좌표(koreaGeo, 43KB)를 끌고 온다 — 홈 첫 페인트의 파스 비용에서 제외하고
// 스크롤로 가까워질 때(600px 전) 청크를 로드한다(저사양 PC·데스크탑앱 첫 화면 체감 개선, 오프라인 원칙 유지).
const LocalWelfare = lazy(() => import('@/components/LocalWelfare').then((m) => ({ default: m.LocalWelfare })))

function LocalWelfareInView() {
  const [near, setNear] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (!('IntersectionObserver' in window)) { setNear(true); return } // 미지원 브라우저는 즉시 로드(기능 무손실)
    const io = new IntersectionObserver(
      (es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect() } },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  // 자리표시 높이로 하단 섹션 밀림(CLS) 최소화 — 실제 섹션과 유사한 높이의 빈 자리
  return (
    <div ref={ref}>
      {near ? (
        <Suspense fallback={<div className="min-h-[28rem]" aria-hidden />}>
          <LocalWelfare />
        </Suspense>
      ) : (
        <div className="min-h-[28rem]" aria-hidden />
      )}
    </div>
  )
}

export function Home() {
  return (
    <>
      <Hero />
      <EmergencyHelp />
      <HowItWorks />
      <Features />
      <LocalWelfareInView />
      <ForeignerWelcome />
      <RpaShowcase />
      <Faq />
      <Footer />
    </>
  )
}
