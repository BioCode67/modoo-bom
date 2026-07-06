import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, ArrowUpRight, ArrowDownRight, ChevronRight, Sparkles } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import { predictTimeline } from '@/lib/lifeAgent'
import { formatWon } from '@/lib/format'

/**
 * 선제적 생애 타임라인 — "앞으로 언제 무엇이 열리고 닫히는지"를 시간순으로 미리 챙겨준다.
 * 능동형 AI 에이전트 관점의 핵심 화면(가정형 시나리오와 달리 확정 생애 임계점 기반).
 */
export function LifeTimeline({ profile, onOpen }: { profile: UserProfile; onOpen: (p: Policy | EligiblePolicy) => void }) {
  const events = useMemo(() => predictTimeline(profile), [profile])
  if (events.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-sprout-500" /> 에이전트가 미리 챙기는 내 복지 미래
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        {profile.name || '회원'}님의 나이·가족에 따라 <b>앞으로 자동으로 바뀌는 복지</b>예요. 미리 준비하면 놓치지 않아요.
        <span className="block mt-0.5 text-xs">🔒 브라우저 안에서만 계산돼요. 서버로 전송되지 않아요.</span>
      </p>

      <div className="mt-5 relative pl-6">
        {/* 세로 타임라인 라인 */}
        <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-sprout-100" aria-hidden />
        <div className="space-y-4">
          {events.map((e, i) => (
            <motion.div
              key={e.year + e.trigger}
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="relative"
            >
              {/* 타임라인 점 */}
              <div className="absolute -left-[18px] top-2 h-4 w-4 rounded-full bg-white border-2 border-sprout-400 flex items-center justify-center text-[10px]">{e.emoji}</div>
              <div className="card-cute p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="chip-sprout !py-0.5 text-[11px]">{e.whenLabel}</span>
                    <p className="font-bold mt-1">{e.trigger}</p>
                  </div>
                  {e.monthlyDelta !== 0 && (
                    <span className={`inline-flex items-center gap-1 text-sm font-extrabold ${e.monthlyDelta > 0 ? 'text-sprout-700' : 'text-amber-700'}`}>
                      {e.monthlyDelta > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      월 {formatWon(Math.abs(e.monthlyDelta))} {e.monthlyDelta > 0 ? '증가' : '감소'}
                    </span>
                  )}
                </div>

                {e.gained.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-sprout-700 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> 새로 열리는 복지</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.gained.map((p) => (
                        <button key={p.id} onClick={() => onOpen(p)}
                          className="inline-flex items-center gap-1 rounded-full bg-sprout-50 border border-sprout-200 px-2.5 py-1 text-xs font-semibold hover:bg-sprout-100">
                          {p.name} <ChevronRight className="h-3 w-3 opacity-60" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {e.lost.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-amber-700">⏳ 곧 종료되는 복지 (지금 챙기거나 전환 준비)</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {e.lost.map((p) => (
                        <button key={p.id} onClick={() => onOpen(p)}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-semibold hover:bg-amber-100">
                          {p.name} <ChevronRight className="h-3 w-3 opacity-60" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-3 text-xs text-muted-foreground bg-sprout-50/60 rounded-xl p-2.5 leading-relaxed">
                  💡 {e.prep}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
