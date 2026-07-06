import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Heart } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { buildActionFeed } from '@/lib/monitoring'

/**
 * 새싹이(에이전트)가 먼저 말을 거는 말풍선 — 마스코트를 '살아있는 에이전트'로 만든다.
 * - 처음 온 사용자: 편하게 한마디를 권하는 인사(몇 줄을 부드럽게 순환)
 * - 다시 온 사용자: **실제 저장 데이터**로 브리핑(담아둔 복지·지금 챙길 일 개수 — 날조 없음)
 * 재방문 브리핑은 '에이전트가 나를 기억하고 먼저 챙긴다'는 느낌의 핵심 장치.
 */
const GREETINGS = [
  '안녕하세요! 저 새싹이예요 🌱 어떤 상황이신지 편하게 한마디만 들려주세요.',
  '복잡한 서류 채우기는 없어요. 말하듯 알려주시면 딱 맞는 복지를 제가 찾아드릴게요.',
  '“72세인데 소득이 적어요”처럼요. 나머지는 제가 알아서 챙길게요!',
]

export function HeroAgentBubble({ onFocusInput }: { onFocusInput?: () => void }) {
  const profile = useAppStore((s) => s.profile)
  const result = useAppStore((s) => s.result)
  const tracked = useAppStore((s) => s.tracked)
  const setView = useAppStore((s) => s.setView)
  const [gi, setGi] = useState(0)

  // 지금 챙길 일(마감 임박·서류 미비·신청 권유 등)이 있는 저장 항목 수 — 실측
  const actionCount = useMemo(() => {
    if (!tracked.length) return 0
    try { return buildActionFeed(tracked, getPolicyMap()).length } catch { return 0 }
  }, [tracked])

  const primaryCount = useMemo(
    () => (result?.eligible_policies?.filter((p) => /^POL-/.test(p.id)).length ?? 0),
    [result],
  )

  // 재방문 여부 = 저장된 관심목록/이전 분석 결과가 있음
  const returning = tracked.length > 0 || !!result
  const name = profile?.name?.trim()

  // 신규 사용자 인사는 부드럽게 순환(에이전트가 살아있는 느낌)
  useEffect(() => {
    if (returning) return
    const t = setInterval(() => setGi((v) => (v + 1) % GREETINGS.length), 4200)
    return () => clearInterval(t)
  }, [returning])

  let body: React.ReactNode
  let cta: { label: string; onClick: () => void } | null = null

  if (returning) {
    const hi = name ? `${name}님, 다시 오셨네요! ` : '다시 오셨네요! '
    if (actionCount > 0) {
      body = <>{hi}담아두신 복지 중 <b>{actionCount}개</b>는 지금 챙길 일이 있어요. 제가 정리해 뒀어요.</>
      cta = { label: '나의 복지에서 확인', onClick: () => setView('my') }
    } else if (tracked.length > 0) {
      body = <>{hi}담아두신 복지 <b>{tracked.length}개</b>를 이어서 챙겨드릴까요?</>
      cta = { label: '나의 복지 열기', onClick: () => setView('my') }
    } else {
      body = <>{hi}지난번에 받을 수 있는 복지 <b>{primaryCount}개</b>를 찾아드렸어요. 이어서 보실래요?</>
      cta = { label: '지난 결과 보기', onClick: () => setView('analyze') }
    }
  } else {
    body = GREETINGS[gi]
    cta = onFocusInput ? { label: '한마디로 시작하기', onClick: onFocusInput } : null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="relative z-10 max-w-sm mx-auto lg:mx-0"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5 rounded-3xl rounded-bl-md border-2 border-sprout-200 bg-white/95 backdrop-blur px-4 py-3 shadow-soft">
        <span className="shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-sprout-100">
          <SproutLogo withFace className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold text-sprout-600">새싹이 · 복지 에이전트</p>
          <div className="mt-0.5 min-h-[2.5rem] text-sm font-medium text-foreground leading-relaxed">
            <AnimatePresence mode="wait">
              <motion.p
                key={returning ? 'ret' : gi}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3 }}
              >
                {body}
              </motion.p>
            </AnimatePresence>
          </div>
          {cta && (
            <button
              onClick={cta.onClick}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-sprout-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-sprout-600 transition-colors"
            >
              {returning ? <Heart className="h-3.5 w-3.5" /> : null}
              {cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* 말풍선 꼬리 — 마스코트 쪽을 향함 */}
      <div className="ml-6 h-3 w-3 -mt-1.5 rotate-45 border-b-2 border-r-2 border-sprout-200 bg-white/95" />
    </motion.div>
  )
}
