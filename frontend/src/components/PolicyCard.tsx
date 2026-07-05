import { motion } from 'framer-motion'
import { Heart, ChevronRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { categoryMeta, parseMonthly, formatWon, isCashBenefit, PRIORITY_META } from '@/lib/format'
import { deadlineHint } from '@/lib/deadline'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

function isEligible(p: Policy | EligiblePolicy): p is EligiblePolicy {
  return 'priority' in p && 'reason' in p
}

export function PolicyCard({
  policy,
  onOpen,
  index = 0,
}: {
  policy: Policy | EligiblePolicy
  onOpen: (p: Policy | EligiblePolicy) => void
  index?: number
}) {
  const { isSaved, toggleSaved } = useAppStore()
  const saved = isSaved(policy.id)
  const meta = categoryMeta(policy.category)
  // 현금성 혜택일 때만 '월 N까지' 배지 — 감면·할인·바우처(예: 다자녀 전기요금 감면)를 현금처럼 오표기하지 않게.
  const monthly = isCashBenefit(policy.benefit) ? parseMonthly(policy.benefit) : 0
  const eligible = isEligible(policy)
  // 지자체(LOC) 정책은 target 앞 "[시도 시군구]"에서 지역 배지 추출(시군구 우선)
  const rm = policy.id.startsWith('LOC-') ? policy.target.match(/^\[([^\]]+)\]/) : null
  const region = rm ? (rm[1].split(/\s+/).pop() || rm[1]) : ''
  const targetText = rm ? policy.target.replace(/^\[[^\]]+\]\s*/, '') : policy.target
  const deadline = deadlineHint(policy) // 신청 기한 힌트(있으면 ⏰ 배지)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      className="card-cute card-hover p-5 flex flex-col h-full cursor-pointer group"
      onClick={() => onOpen(policy)}
      // 키보드 접근성: 카드 전체가 상세 열기 버튼(Enter/Space) — 키보드 사용자도 5천여 정책 상세 진입 가능
      role="button"
      tabIndex={0}
      aria-label={`${policy.name} 상세 보기`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(policy) }
      }}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl', meta.cls)}>
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-muted-foreground">{policy.category}</span>
            {region && <span className="text-[10px] font-semibold text-sky2-700 bg-sky2-50 rounded-full px-1.5 py-0.5">📍 {region}</span>}
            {deadline && (
              <span className={cn('text-[10px] font-semibold rounded-full px-1.5 py-0.5', deadline.urgent ? 'text-rose-700 bg-rose-50' : 'text-amber-700 bg-amber-50')}>
                ⏰ {deadline.label}
              </span>
            )}
            {eligible && (
              <span className={cn('chip text-[10px] !px-2 !py-0.5 border', PRIORITY_META[policy.priority].cls)}>
                {PRIORITY_META[policy.priority].emoji} {PRIORITY_META[policy.priority].label}
              </span>
            )}
          </div>
          <h3 className="font-bold text-[15px] leading-snug mt-0.5 truncate">{policy.name}</h3>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
          }}
          aria-label={saved ? '관심목록에서 제거' : '관심목록에 추가'}
          className={cn(
            'shrink-0 rounded-full p-2 transition-all active:scale-90',
            saved ? 'bg-peach-100 text-peach-500' : 'bg-muted text-muted-foreground hover:bg-peach-50 hover:text-peach-400',
          )}
        >
          <Heart className={cn('h-4 w-4', saved && 'fill-current')} />
        </button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{targetText}</p>

      {eligible && (policy as EligiblePolicy).reason && (
        <div className="mt-2 rounded-xl bg-sprout-50 px-3 py-2 text-xs text-sprout-700 line-clamp-2">
          ✓ {(policy as EligiblePolicy).reason}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between">
        {monthly > 0 ? (
          <span className="text-sm font-extrabold text-sprout-600">
            월 {formatWon(monthly)}<span className="text-[11px] font-medium text-muted-foreground"> 까지</span>
          </span>
        ) : (
          <span className="text-xs font-semibold text-muted-foreground line-clamp-1">{policy.benefit.slice(0, 18)}…</span>
        )}
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-sprout-600 group-hover:gap-1.5 transition-all">
          자세히 <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.div>
  )
}
