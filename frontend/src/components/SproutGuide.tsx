import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useBackend } from '@/lib/useBackend'
import { guideTip } from '@/lib/guideTips'
import { shouldSkipHeavy3D } from '@/three/MascotCanvas'
import { SproutLogo } from '@/ui/SproutLogo'

const GuideScene = lazy(() => import('@/three/GuideScene'))
const OFF_KEY = 'modoobom-guide-off'

/** 3D 실패(청크 로드·WebGL 예외) 시 2D 새싹으로 조용히 강등 — 가이드 때문에 앱이 죽으면 본말전도 */
class GuideBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* 2D로 강등만 */ }
  render() { return this.state.failed ? <Sprout2D /> : this.props.children }
}

function Sprout2D() {
  return <SproutLogo withFace className="h-full w-full p-2 animate-float" />
}

/**
 * 🌱 새싹이 가이드 — 화면 구석의 작은 3D 새싹이가 '지금 뭘 하면 되는지' 한 문장으로 안내한다.
 * (추천까지는 좋은데 다음 행동이 헷갈린다는 피드백의 답)
 *
 * · 화면(분석/탐색/나의복지)·상태(결과 유무·담김 수·에이전트 연결)에 따라 문구가 바뀐다(guideTips).
 * · 홈은 미표시 — 히어로의 큰 새싹이와 중복 안내 금지.
 * · 3D는 히어로와 같은 three 청크 재사용(추가 다운로드 없음) + 저사양·reduced-motion·WebGL 불가면 2D 폴백.
 * · ✕로 접고(마스코트만 남음, 다시 누르면 펼침), '다시 보지 않기'는 이 기기에서 영구 숨김.
 */
export function SproutGuide() {
  const view = useAppStore((s) => s.view)
  const trackedCount = useAppStore((s) => s.tracked.length)
  const hasResult = useAppStore((s) => !!s.result)
  // 진행상태(서류 준비·신청 시작) — '그다음에 뭘 하지?' 헷갈림에 다음 행동을 콕 집어 안내하기 위한 신호
  const docsIssued = useAppStore((s) => Object.keys(s.docDone).length > 0)
  const appliedCount = useAppStore((s) => s.tracked.filter((t) => t.status === 'applied' || t.status === 'done').length)
  const { ready, caps } = useBackend()
  const agentOn = ready === true && !!caps?.rpa
  const reduce = useReducedMotion()

  const [off, setOff] = useState(() => {
    try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false }
  })
  const [open, setOpen] = useState(true)
  const [skip3D] = useState(shouldSkipHeavy3D)
  const [contextLost, setContextLost] = useState(false)

  // 화면이 바뀌면 새 안내를 잠깐 펼쳤다가 자동으로 접는다 — 말풍선이 목록·카드 같은 콘텐츠를
  //   계속 가리지 않게(시각 감사: 결과·나의복지·탐색에서 첫 카드를 덮음). 마스코트는 남고, 다시 누르면
  //   언제든 펼쳐 읽을 수 있으며 aria-live 로 스크린리더엔 등장 즉시 전달된다(자동 접힘이 정보 손실이 아님).
  //   ⬇︎ 사용자가 콘텐츠를 보려고 '스크롤하는 순간' 즉시 접어(once) 가림을 없앤다 + 5.5초 백스톱 타이머.
  useEffect(() => {
    setOpen(true)
    const t = setTimeout(() => setOpen(false), 5500)
    const collapse = () => setOpen(false)
    window.addEventListener('scroll', collapse, { passive: true, once: true })
    return () => { clearTimeout(t); window.removeEventListener('scroll', collapse) }
  }, [view])

  const tip = guideTip(view, { hasResult, trackedCount, agentOn, docsIssued, appliedCount })
  if (off || !tip) return null

  const turnOff = () => {
    try { localStorage.setItem(OFF_KEY, '1') } catch { /* 프라이빗 모드 등 — 이번 세션만 숨김 */ }
    setOff(true)
  }

  return (
    <div className="fixed left-3 sm:left-4 bottom-36 md:bottom-20 z-40 flex items-end gap-2"
      role="complementary" aria-label="새싹이 도우미">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? '새싹이 안내 접기' : '새싹이 안내 보기'}
        aria-expanded={open}
        className="h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem] shrink-0 overflow-hidden rounded-full border-2 border-sprout-200 bg-white/85 shadow-cute backdrop-blur transition-transform hover:scale-105 active:scale-95"
      >
        {reduce || skip3D || contextLost ? (
          <Sprout2D />
        ) : (
          <GuideBoundary>
            <Suspense fallback={<Sprout2D />}>
              <GuideScene onContextLost={() => setContextLost(true)} />
            </Suspense>
          </GuideBoundary>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.18 }}
            className="relative mb-1 max-w-[14.5rem] sm:max-w-[17rem] rounded-2xl rounded-bl-sm border-2 border-sprout-100 bg-white/95 px-3 py-2.5 pr-7 shadow-cute backdrop-blur"
          >
            <p className="text-xs font-semibold leading-relaxed text-foreground" aria-live="polite">{tip}</p>
            <button onClick={turnOff} className="mt-1 text-[10px] font-semibold text-muted-foreground/80 hover:underline">
              다시 보지 않기
            </button>
            <button onClick={() => setOpen(false)} aria-label="안내 접기"
              className="absolute right-1.5 top-1.5 rounded-full p-1 text-muted-foreground hover:bg-muted">
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
