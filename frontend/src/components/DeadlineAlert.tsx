import { AlarmClock, ArrowRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { deadlineHint } from '@/lib/deadline'

/**
 * 마감 임박 복지 상단 경고 — '몰라서·늦어서 못 받는' 핵심 문제 대응.
 * 자격 있는 복지 중 기한이 짧은(urgent) 것을 눈에 띄게 먼저 안내(놓침 방지).
 */
export function DeadlineAlert({
  policies,
  onOpen,
}: {
  policies: (Policy | EligiblePolicy)[]
  onOpen: (p: Policy | EligiblePolicy) => void
}) {
  const urgent = policies
    .map((p) => ({ p, d: deadlineHint(p) }))
    .filter((x): x is { p: Policy | EligiblePolicy; d: { label: string; urgent: boolean } } => !!x.d?.urgent)
  if (urgent.length === 0) return null

  return (
    <div className="mt-4 rounded-2xl border-2 border-rose-200 bg-rose-50 p-4">
      <p className="font-bold text-rose-700 flex items-center gap-1.5">
        <AlarmClock className="h-5 w-5" /> 서둘러야 할 복지 {urgent.length}건 — 기한이 짧아요
      </p>
      <p className="mt-0.5 text-xs text-rose-700/90">지금 확인하지 않으면 놓칠 수 있어요. 눌러서 신청 방법을 확인하세요.</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {urgent.slice(0, 6).map(({ p, d }) => (
          <button
            key={p.id}
            onClick={() => onOpen(p)}
            className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:border-rose-500 transition-colors"
          >
            ⏰ {p.name} · {d.label}<ArrowRight className="h-3 w-3" />
          </button>
        ))}
      </div>
    </div>
  )
}
