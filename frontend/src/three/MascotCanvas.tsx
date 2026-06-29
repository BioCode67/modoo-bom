import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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

/** 브라우저가 한가해지고(idle) 요소가 화면에 보일 때만 true → 3D 청크 지연 로드 */
function useDeferredMount(ref: React.RefObject<HTMLElement>) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let done = false
    const trigger = () => { if (!done) { done = true; setReady(true) } }

    // 화면에 보일 때만 (홈 히어로는 보통 즉시 보임)
    let io: IntersectionObserver | null = null
    if (ref.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // 보이면 유휴 시점에 마운트(첫 페인트/상호작용을 막지 않음)
          const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
          if (ric) ric(trigger, { timeout: 1800 })
          else setTimeout(trigger, 600)
        }
      }, { rootMargin: '120px' })
      io.observe(ref.current)
    } else {
      setTimeout(trigger, 800)
    }
    return () => io?.disconnect()
  }, [ref])
  return ready
}

/**
 * 히어로 3D 캔버스. reduced-motion이면 3D를 마운트하지 않고 정적 마스코트 표시.
 * 그 외엔 유휴+가시 시점에 코드 분할된 HeroScene을 지연 로드(그 전엔 정적 마스코트).
 */
export function MascotCanvas() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const ready = useDeferredMount(ref)

  return (
    <div ref={ref} className="h-full w-full">
      {reduce || !ready ? (
        <StaticMascot animate={!reduce} />
      ) : (
        <Suspense fallback={<StaticMascot />}>
          <HeroScene animate />
        </Suspense>
      )}
    </div>
  )
}

export { StaticMascot }
