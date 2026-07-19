import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'
import { SproutLogo } from '@/ui/SproutLogo'

const HeroScene = lazy(() => import('./HeroScene'))

/** WebGL 사용 가능 여부 — 없으면 <Canvas>가 "Error creating WebGL context"를 던져 앱 전체가 오류화면으로 죽는다.
 *  카카오톡/네이버 인앱 웹뷰·구형 안드로이드·GPU 차단 브라우저에서 흔함(공유 링크로 들어오는 투표 동선의 핵심 기기). */
function hasWebGL(): boolean {
  if (typeof document === 'undefined') return true
  try {
    const canvas = document.createElement('canvas')
    return !!(
      (window as unknown as { WebGLRenderingContext?: unknown }).WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

/**
 * 데이터 절약·저속 연결·저사양 기기면 270KB 3D(three.js)를 받지 않는다.
 * 복지 서비스 특성상 알뜰폰·제한 데이터 사용자가 많아 성능과 데이터 비용 형평성을 함께 고려.
 * WebGL 미지원 기기도 여기서 걸러 정적 마스코트로 폴백(첫 화면이 오류화면으로 죽는 것 방지, 감사 CRITICAL).
 */
export function shouldSkipHeavy3D(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
    deviceMemory?: number
  }
  const c = nav.connection
  if (c?.saveData) return true
  if (c?.effectiveType && /(slow-2g|2g)/.test(c.effectiveType)) return true
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 1) return true
  if (!hasWebGL()) return true
  return false
}

/** 3D 서브트리 전용 에러 경계 — <Canvas> WebGL 예외나 lazy 청크 로드 실패(rejected import)는 Suspense가
 *  못 잡아 최상위 ErrorBoundary(전체 오류화면)까지 올라간다. 여기서 삼켜 정적 마스코트로 '품위 있게' 강등한다. */
class Canvas3DBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* 첫 화면은 반드시 살린다 — 3D만 포기하고 2D로 */ }
  render() { return this.state.failed ? <StaticMascot /> : this.props.children }
}

/** 정적 폴백 — reduced-motion 또는 3D 로딩 전. CSS 애니메이션만 사용. */
function StaticMascot({ animate = true }: { animate?: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute h-56 w-56 rounded-full bg-sprout-200/50 blur-3xl" />
      <SproutLogo withFace className={`relative h-48 w-48 drop-shadow-xl ${animate ? 'animate-float' : ''}`} />
      {animate && (
        <span aria-hidden="true">
          <span className="absolute left-[18%] top-[24%] text-3xl animate-float-slow">🪙</span>
          <span className="absolute right-[16%] top-[20%] text-2xl animate-float">⭐</span>
          <span className="absolute right-[22%] bottom-[24%] text-2xl animate-float-slow">📄</span>
          <span className="absolute left-[20%] bottom-[22%] text-2xl animate-float">💚</span>
        </span>
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
  // 데이터 절약·저사양 기기는 3D 청크 자체를 받지 않음(최초 1회 측정)
  const [skipHeavy] = useState(shouldSkipHeavy3D)
  // GPU 컨텍스트 상실 시 2D로 강등(마운트 후 빈 캔버스로 남는 것 방지)
  const [contextLost, setContextLost] = useState(false)

  return (
    <div ref={ref} className="h-full w-full">
      {reduce || skipHeavy || !ready || contextLost ? (
        <StaticMascot animate={!reduce} />
      ) : (
        <Canvas3DBoundary>
          <Suspense fallback={<StaticMascot />}>
            <HeroScene animate onContextLost={() => setContextLost(true)} />
          </Suspense>
        </Canvas3DBoundary>
      )}
    </div>
  )
}

export { StaticMascot }
