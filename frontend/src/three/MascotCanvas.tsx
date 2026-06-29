import { lazy, Suspense } from 'react'
import { useReducedMotion } from 'framer-motion'
import { SproutLogo } from '@/ui/SproutLogo'

const HeroScene = lazy(() => import('./HeroScene'))

/** 정적 폴백 — reduced-motion 또는 3D 로딩 전. CSS 애니메이션만 사용. */
function StaticMascot({ animate = true }: { animate?: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute h-56 w-56 rounded-full bg-sprout-200/50 blur-3xl" />
      <SproutLogo withFace className={`relative h-48 w-48 drop-shadow-xl ${animate ? 'animate-float' : ''}`} />
      {animate && (
        <>
          <span className="absolute left-[18%] top-[24%] text-3xl animate-float-slow">🪙</span>
          <span className="absolute right-[16%] top-[20%] text-2xl animate-float">⭐</span>
          <span className="absolute right-[22%] bottom-[24%] text-2xl animate-float-slow">📄</span>
          <span className="absolute left-[20%] bottom-[22%] text-2xl animate-float">💚</span>
        </>
      )}
    </div>
  )
}

/**
 * 히어로 3D 캔버스. reduced-motion이면 3D를 아예 마운트하지 않고 정적 마스코트 표시.
 * 그 외엔 코드 분할된 HeroScene을 lazy 로드(폴백: 정적 마스코트).
 */
export function MascotCanvas() {
  const reduce = useReducedMotion()
  if (reduce) return <StaticMascot animate={false} />
  return (
    <Suspense fallback={<StaticMascot />}>
      <HeroScene animate />
    </Suspense>
  )
}

export { StaticMascot }
