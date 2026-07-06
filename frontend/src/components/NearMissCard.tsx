import { useMemo, useState } from 'react'
import { Target, ChevronDown } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { getNearMisses } from '@/lib/nearMiss'

/**
 * '아깝게 놓친 복지' — 에이전트가 "이건 봤는데 딱 한 조건만 벗어나 아쉽다"고 근거를 대는 섹션.
 * 규칙 엔진이 '판단(추론)'을 한다는 인상을 주고, 상황이 바뀌면 열리는 후보라 사후관리와 연결.
 */
export function NearMissCard({ profile, onOpen }: { profile: UserProfile; onOpen: (p: Policy | EligiblePolicy) => void }) {
  const misses = useMemo(() => getNearMisses(profile), [profile])
  const [open, setOpen] = useState(false)
  if (misses.length === 0) return null

  return (
    <div className="mt-8">
      <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4">
        <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 text-left">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Target className="h-4 w-4" /></span>
          <span className="flex-1 min-w-0">
            <span className="text-sm font-extrabold block">아깝게 놓친 복지 <span className="text-amber-700">{misses.length}</span>건</span>
            <span className="text-xs text-muted-foreground">딱 한 조건만 조금 벗어났어요 — 상황이 바뀌면 열려요. 에이전트가 계속 지켜볼게요.</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <ul className="mt-3 space-y-2">
            {misses.map(({ policy, reason }) => (
              <li key={policy.id}>
                <button
                  onClick={() => onOpen(policy)}
                  className="w-full text-left rounded-xl bg-white border border-amber-100 p-3 hover:border-amber-300 transition-colors"
                >
                  <p className="text-sm font-bold">{policy.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{reason}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
