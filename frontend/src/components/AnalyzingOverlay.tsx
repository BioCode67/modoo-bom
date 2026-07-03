import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { SproutLogo } from '@/ui/SproutLogo'
import { cn } from '@/lib/utils'

const STEPS = [
  '프로필을 살펴보고 있어요',
  '딱 맞는 정책을 검색하고 있어요',
  '자격 조건을 하나씩 확인 중이에요',
  '결과를 다시 한 번 검증하고 있어요',
  '신청 방법을 정리하고 있어요',
  '필요한 서류를 챙기고 있어요',
  '예상 혜택 금액을 계산하고 있어요',
  '맞춤 안내를 완성하고 있어요',
]

/** 클라이언트 분석은 즉시 끝나지만, 살아있는 느낌을 위해 단계별로 보여준 뒤 onDone 호출 */
export function AnalyzingOverlay({ onDone }: { onDone: () => void }) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    let i = 0
    const timer = setInterval(() => {
      i += 1
      if (i >= STEPS.length) {
        clearInterval(timer)
        setTimeout(onDone, 450)
      } else {
        setActive(i)
      }
    }, 320)
    return () => clearInterval(timer)
  }, [onDone])

  return (
    <div className="page-container py-12 sm:py-20 flex flex-col items-center text-center" aria-busy="true">
      {/* 스크린리더: 분석 시작/진행 안내(시각적 단계 목록은 장식) */}
      <p className="sr-only" role="status" aria-live="polite">복지를 분석하고 있어요. {STEPS[active]}</p>
      <motion.div animate={{ y: [0, -12, 0] }} transition={{ repeat: Infinity, duration: 1.6 }} className="relative">
        <div className="absolute inset-0 -z-10 m-auto h-40 w-40 rounded-full bg-sprout-200/50 blur-2xl" />
        <SproutLogo withFace className="h-32 w-32 drop-shadow-xl" />
      </motion.div>
      <h2 className="mt-6 text-2xl font-extrabold">AI가 복지를 찾고 있어요 <span className="gradient-text">🔎</span></h2>
      <p className="text-muted-foreground mt-1">잠시만 기다려 주세요…</p>

      <div className="mt-8 w-full max-w-md space-y-2 text-left">
        {STEPS.map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: i <= active ? 1 : 0.4 }}
            className={cn('flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors',
              i < active ? 'bg-sprout-50 text-sprout-700' : i === active ? 'bg-sprout-100 text-sprout-700' : 'bg-muted/40 text-muted-foreground')}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
              {i < active ? <Check className="h-4 w-4 text-success-500" /> : i === active ? <Loader2 className="h-4 w-4 animate-spin text-sprout-500" /> : <span className="text-xs text-muted-foreground">{i + 1}</span>}
            </span>
            {s}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
