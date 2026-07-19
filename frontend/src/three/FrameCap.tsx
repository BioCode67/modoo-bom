import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * 프레임레이트 캡 드라이버 — Canvas frameloop="demand"와 짝지어 쓴다.
 *
 * 왜: 히어로 3D가 60fps 상시 렌더로 구형 PC 메인스레드를 계속 점유했다
 * (Lighthouse 4x 스로틀 실측: 570ms급 롱태스크 반복, TBT 115초·Perf 51).
 * 부드러운 카툰 씬은 30fps로도 시각 차이가 미미해, 초당 절반만 invalidate한다.
 * 추가로 ①탭이 백그라운드면 ②캔버스가 뷰포트 밖이면 렌더를 완전히 멈춘다.
 */
export function FrameCap({ fps = 30, delayMs = 1500 }: { fps?: number; delayMs?: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    let visible = !document.hidden
    let inView = true
    let id: ReturnType<typeof setInterval> | null = null
    let delayId: ReturnType<typeof setTimeout> | null = null

    const tick = () => { if (visible && inView) invalidate() }
    const start = () => { if (id == null) id = setInterval(tick, Math.max(16, Math.round(1000 / fps))) }
    const onVis = () => { visible = !document.hidden }

    // 캔버스가 화면에 안 보이면(스크롤 아웃) 렌더 정지 — 홈 아래 섹션 탐색 중 CPU 0
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((es) => { inView = es[0]?.isIntersecting !== false }, { threshold: 0 })
      : null
    io?.observe(gl.domElement)

    document.addEventListener('visibilitychange', onVis)
    // 첫 프레임(정지 장면)은 즉시 그리고, 연속 애니메이션은 로드가 잠잠해진 뒤 시작 —
    // 페이지 로드 구간의 메인스레드 블로킹(TBT)을 줄인다(헤드라인 읽는 1.5초간 정지여도 무해)
    invalidate()
    delayId = setTimeout(start, Math.max(0, delayMs))
    return () => {
      if (id != null) clearInterval(id)
      if (delayId != null) clearTimeout(delayId)
      document.removeEventListener('visibilitychange', onVis)
      io?.disconnect()
    }
  }, [fps, delayMs, invalidate, gl])
  return null
}
