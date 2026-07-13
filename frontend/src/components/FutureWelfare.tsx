import { motion } from 'framer-motion'
import { Sparkles, ChevronRight, TrendingUp } from 'lucide-react'
import type { UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { simulateFuture } from '@/lib/simulate'
import { formatWon, categoryMeta } from '@/lib/format'

/**
 * "앞으로 받을 복지 미리보기" — 생애 변화별로 새로 열리는 복지를 보여준다.
 * 사용자가 미래를 대비하도록 돕는 혁신 기능(클라이언트 엔진 시뮬레이션).
 */
export function FutureWelfare({ profile, onOpen }: { profile: UserProfile; onOpen: (p: Policy | EligiblePolicy) => void }) {
  const scenarios = simulateFuture(profile)
  if (scenarios.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-peach-400" /> 앞으로 받을 수 있는 복지
      </h2>
      <p className="text-sm text-muted-foreground mt-1">생애에 이런 변화가 생기면 새로 챙길 수 있는 혜택이에요. 미리 준비하세요.</p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenarios.map((s, i) => (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: (i % 2) * 0.08 }}
            className="card-cute p-5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-peach-100 text-2xl">{s.emoji}</div>
              <div className="min-w-0">
                <p className="font-bold leading-tight">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="chip-sprout">복지 {s.newPolicies.length}개 추가</span>
              {s.monthlyGain > 0 && (
                <span className="chip-peach"><TrendingUp className="h-3.5 w-3.5" /> 월 +{formatWon(s.monthlyGain)}</span>
              )}
            </div>
            {s.monthlyGain > 0 && (
              // ‘순증’ 과장 방지 — 기초연금은 생계급여 수급자에게 소득으로 잡혀 생계급여가 감액(줬다 뺏는 연금)되므로
              //   실제 순증은 더 적을 수 있다. ResultsView와 동일한 정직성 캐비앳(감사 5차 확정).
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                ※ <b>‘최대’ 추정치</b>예요 — 중복수급 제한·기존 급여 감액(예: 기초연금을 받으면 생계급여가 줄어드는 경우)은 반영 전이라, 실제 늘어나는 금액은 더 적을 수 있어요.
              </p>
            )}

            <ul className="mt-3 space-y-1.5">
              {s.newPolicies.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => onOpen(p)}
                    className="w-full flex items-center gap-2 text-left text-sm rounded-xl px-2.5 py-1.5 hover:bg-sprout-50 transition-colors group"
                  >
                    <span>{categoryMeta(p.category).emoji}</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    <ChevronRight className="h-4 w-4 text-sprout-400 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
