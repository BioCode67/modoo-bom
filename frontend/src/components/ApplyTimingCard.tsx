import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { AlarmClock } from 'lucide-react'
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { applyTiming, type TimingKind } from '@/lib/applyTiming'

/**
 * 신청 골든타임 카드 — '언제 신청해야 한 푼도 안 잃나'를 이 사람 상황에 맞춰 짚어 준다.
 * 순수 로직(applyTiming)이 시간이 중요한 알림만 고르고 여기선 표시만. 걸린 게 없으면 렌더 안 함.
 * 신청주의(신청한 달부터 지급)라 타이밍이 곧 돈 — 그래서 결과 화면 맨 위에 둔다.
 */

const KIND_META: Record<TimingKind, { emoji: string }> = {
  retroactive: { emoji: '⏪' },
  preapply: { emoji: '📅' },
  deadline: { emoji: '⏰' },
}

export function ApplyTimingCard({ profile, eligible }: { profile: UserProfile; eligible: EligiblePolicy[] }) {
  const alerts = useMemo(() => applyTiming(profile, eligible), [profile, eligible])
  if (alerts.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="mt-5 card-cute p-5 border-2 border-orange-200 bg-gradient-to-br from-orange-50/70 to-white"
      aria-label="신청 골든타임"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-orange-600">
          <AlarmClock className="h-4 w-4" />
        </span>
        <p className="font-extrabold text-[15px]">신청 골든타임 — 시간이 곧 돈이에요</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">복지는 대부분 신청한 달부터 지급돼요. 지금 서두르면 놓치지 않을 항목만 골랐어요.</p>

      <ul className="mt-3 space-y-2.5">
        {alerts.map((a) => (
          <li
            key={a.kind}
            className={`rounded-2xl border p-3.5 ${a.urgency === 'high' ? 'border-rose-200 bg-rose-50/50' : 'border-orange-100 bg-white/70'}`}
          >
            <div className="flex items-center gap-1.5">
              <span aria-hidden>{KIND_META[a.kind].emoji}</span>
              <p className={`text-sm font-bold ${a.urgency === 'high' ? 'text-rose-700' : 'text-orange-700'}`}>{a.title}</p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-foreground/85">{a.detail}</p>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">놓치면 · {a.lossRisk}</p>
            {a.policyNames.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {a.policyNames.slice(0, 4).map((n) => (
                  <span key={n} className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">{n}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </motion.section>
  )
}
