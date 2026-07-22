import { useMemo, useState } from 'react'
import { ListOrdered, ChevronDown } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { usePolicyMap } from '@/data/useCatalog'
import { useAppStore } from '@/store/useAppStore'
import { rankPolicies, DIFFICULTY_LABEL, type RankedPolicy } from '@/lib/priority'
import { cn } from '@/lib/utils'

/**
 * 먼저 챙기세요 — 담아둔(아직 신청 전) 복지를 우선순위 점수로 정렬해 '무엇부터 할지' 추천.
 * 점수 근거(금액·시급성·확실성·편의)를 그대로 보여줘 납득 가능하게 한다(투명 랭킹).
 * 신청 전(idle·tracking) 항목이 3개 미만이면 굳이 줄 세우지 않는다(미표시).
 */
export function PriorityRecommend({ onOpen }: { onOpen?: (p: Policy) => void }) {
  const tracked = useAppStore((s) => s.tracked)
  const POLICY_MAP = usePolicyMap()
  const [expanded, setExpanded] = useState<string | null>(null)

  const ranked = useMemo(() => {
    const policies = tracked
      .filter((t) => t.status === 'idle' || t.status === 'tracking')
      .map((t) => POLICY_MAP[t.policyId])
      .filter(Boolean)
    return rankPolicies(policies).slice(0, 5)
  }, [tracked, POLICY_MAP])

  if (ranked.length < 3) return null

  return (
    <section className="mt-8 card-cute p-4">
      <h2 className="text-lg font-extrabold flex items-center gap-2"><ListOrdered className="h-5 w-5 text-sun-500" /> 먼저 챙기세요</h2>
      <p className="text-sm text-muted-foreground mt-1">담아둔 복지를 금액·시급성·자격 확실성·신청 편의로 점수 내어 추천 순서예요.</p>
      <ol className="mt-3 space-y-2">
        {ranked.map((r, i) => (
          <PriorityRow key={r.policy.id} rank={i + 1} r={r}
            expanded={expanded === r.policy.id}
            onToggle={() => setExpanded((k) => (k === r.policy.id ? null : r.policy.id))}
            onOpen={() => onOpen?.(r.policy as Policy)} />
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-muted-foreground">※ 점수는 우선순위 가늠자예요. 실제 금액·자격은 신청 기관 심사로 확정돼요.</p>
    </section>
  )
}

function PriorityRow({ rank, r, expanded, onToggle, onOpen }: {
  rank: number; r: RankedPolicy; expanded: boolean; onToggle: () => void; onOpen: () => void
}) {
  const pct = Math.min(100, r.score)
  return (
    <li className="rounded-xl border border-sprout-100 bg-white/70">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-extrabold',
          rank === 1 ? 'bg-sun-200 text-yellow-800' : 'bg-muted text-muted-foreground')}>{rank}</span>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-bold truncate hover:underline">{r.policy.name}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden max-w-[140px]">
              <span className="block h-full rounded-full bg-gradient-to-r from-sprout-400 to-sprout-600" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-[11px] font-bold text-sprout-700 tabular-nums">{r.score}점</span>
          </span>
        </button>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">신청 {DIFFICULTY_LABEL[r.difficulty]}</span>
        <button onClick={onToggle} aria-expanded={expanded} aria-label="점수 근거" className="shrink-0 text-muted-foreground">
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-sprout-100 px-3 py-2">
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {r.factors.map((f) => (
              <li key={f.label} className="text-[11px]">
                <span className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{f.label}</span>
                  <span className="tabular-nums text-muted-foreground">{f.score}/{f.max}</span>
                </span>
                <span className="mt-0.5 block h-1 rounded-full bg-muted overflow-hidden">
                  <span className="block h-full rounded-full bg-sprout-400" style={{ width: `${(f.score / f.max) * 100}%` }} />
                </span>
                <span className="mt-0.5 block text-muted-foreground truncate">{f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
