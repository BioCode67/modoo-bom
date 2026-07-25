import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { usePolicyMap } from '@/data/useCatalog'
import { useAppStore } from '@/store/useAppStore'
import { buildPaymentSchedule, dDayLabel, formatPayDate } from '@/lib/paymentSchedule'
import { cn } from '@/lib/utils'

/**
 * 다음 지급 예정일 — 신청·수급 중인 현금 급여가 통장에 들어오는 날을 가까운 순으로.
 * 지급일이 널리 알려진 주요 급여만 표시(paymentSchedule에서 보수적으로 매핑). 신청/수급(applied·done)
 * 상태 항목에만 적용해 '아직 신청도 안 했는데 입금일' 같은 오해를 막는다. 없으면 렌더하지 않음.
 */
export function PaymentSchedule() {
  const tracked = useAppStore((s) => s.tracked)
  const POLICY_MAP = usePolicyMap()

  const entries = useMemo(() => {
    const policies = tracked
      .filter((t) => t.status === 'applied' || t.status === 'done')
      .map((t) => POLICY_MAP[t.policyId])
      .filter(Boolean)
    return buildPaymentSchedule(policies, new Date())
  }, [tracked, POLICY_MAP])

  if (entries.length === 0) return null

  return (
    <section className="mt-8 card-cute p-4">
      <h2 className="text-lg font-extrabold flex items-center gap-2"><CalendarClock className="h-5 w-5 text-peach-500" /> 다음 지급 예정일</h2>
      <p className="text-sm text-muted-foreground mt-1">신청·수급 중인 현금 급여가 통장에 들어오는 날이에요.</p>
      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.policy.id} className="flex items-center gap-3 rounded-xl border border-sprout-100 bg-white/70 px-3 py-2">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-peach-50 text-peach-700 leading-none">
              <span className="text-[10px] font-bold">{e.nextDate.getMonth() + 1}월</span>
              <span className="text-base font-extrabold">{e.nextDate.getDate()}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold truncate">{e.policy.name}</span>
              <span className="block text-[11px] text-muted-foreground">{formatPayDate(e.nextDate)}{e.weekendAdjusted && ' · 주말이라 앞당김'}</span>
            </span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', e.dDay <= 3 ? 'bg-peach-100 text-peach-700' : 'bg-muted text-muted-foreground')}>
              {dDayLabel(e.dDay)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">※ 지급일은 공휴일이면 앞당겨질 수 있고 기관·급여별로 달라요. 실제 수급 중일 때 적용돼요.</p>
    </section>
  )
}
