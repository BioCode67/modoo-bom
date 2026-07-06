import { motion } from 'framer-motion'
import { Heart, Sparkles, ArrowRight } from 'lucide-react'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { parseMonthly, formatWon, categoryMeta, PRIORITY_META, isCashBenefit, sumCashMonthly } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

/**
 * 복지 수혜 점수 — "받을 수 있는데 안 챙긴" 사각지대를 점수·금액으로 드러내 행동을 유도.
 * 복지 미수령 해소가 모두봄의 핵심 미션.
 */
export function WelfareScore({ eligible, onOpen }: { eligible: EligiblePolicy[]; onOpen: (p: Policy | EligiblePolicy) => void }) {
  const { isSaved, toggleSaved } = useAppStore()
  if (eligible.length === 0) return null

  const captured = eligible.filter((p) => isSaved(p.id))
  const score = Math.round((captured.length / eligible.length) * 100)
  const unacted = eligible
    .filter((p) => !isSaved(p.id))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 }
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority]
      return parseMonthly(b.benefit) - parseMonthly(a.benefit)
    })
  const top3 = unacted.slice(0, 3)
  // '놓치고 있는 잠재 혜택' 합계도 현금성만 — 서비스 한도·바우처를 현금처럼 더하지 않는다(정직성).
  const potential = sumCashMonthly(unacted.filter((p) => p.priority === 'high'))

  // 게이지(원형)
  const R = 36, C = 2 * Math.PI * R
  const dash = (score / 100) * C
  const color = score >= 80 ? '#22c55e' : score >= 40 ? '#facc15' : '#fb923c'

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-6 card-cute p-5 sm:p-6">
      <div className="flex items-center gap-5 flex-wrap">
        <div className="relative shrink-0">
          <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
            <circle cx="50" cy="50" r={R} fill="none" stroke="#eef6f0" strokeWidth="11" />
            <motion.circle cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`} initial={{ strokeDasharray: `0 ${C}` }} animate={{ strokeDasharray: `${dash} ${C - dash}` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold" style={{ color }}>{score}</span>
            <span className="text-[10px] text-muted-foreground">점</span>
          </div>
        </div>

        <div className="flex-1 min-w-[200px]">
          <h2 className="text-lg font-extrabold flex items-center gap-1.5"><Heart className="h-5 w-5 text-peach-400" /> 내 복지 수혜 점수</h2>
          <p className="text-sm text-muted-foreground mt-1">
            받을 수 있는 <b className="text-foreground">{eligible.length}개</b> 중 <b className="text-sprout-700">{captured.length}개</b>를 챙겼어요.
          </p>
          {potential > 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-peach-100 px-3 py-1.5 text-sm font-bold text-peach-600">
              <Sparkles className="h-4 w-4" /> 지금 챙기면 월 +{formatWon(potential)} 더!
            </p>
          ) : (
            <p className="mt-2 text-sm font-semibold text-sprout-700">강력 추천 복지를 모두 챙기셨어요! 🎉</p>
          )}
        </div>
      </div>

      {top3.length > 0 && (
        <div className="mt-4 dotted-divider pt-4">
          <p className="text-sm font-bold mb-2">⚡ 지금 바로 챙기면 좋은 복지</p>
          <ul className="space-y-2">
            {top3.map((p) => {
              // 현금성일 때만 '월 N까지' 금액 표기(서비스 한도·바우처를 개인 현금처럼 적지 않음)
              const m = isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0
              return (
                <li key={p.id} className="flex items-center gap-2.5 rounded-2xl border border-sprout-100 p-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-lg">{categoryMeta(p.category).emoji}</span>
                  <button onClick={() => onOpen(p)} className="flex-1 min-w-0 text-left">
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold text-sm truncate">{p.name}</span>
                      <span className={cn('chip text-[10px] !px-1.5 !py-0 border shrink-0', PRIORITY_META[p.priority].cls)}>{PRIORITY_META[p.priority].label}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{m > 0 ? `월 ${formatWon(m)}까지` : p.benefit.slice(0, 22)}</span>
                  </button>
                  <button onClick={() => toggleSaved({ id: p.id, name: p.name, category: p.category })} className="btn-primary !px-3 !py-1.5 text-xs shrink-0">
                    담기 <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </motion.section>
  )
}
