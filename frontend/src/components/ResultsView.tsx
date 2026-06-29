import { useState } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw, Heart, TrendingUp, Bell, PartyPopper, Printer } from 'lucide-react'
import type { AnalysisResult, UserProfile, EligiblePolicy } from '@/lib/welfare-engine'
import type { Policy } from '@/data/policies'
import { PolicyCard } from '@/components/PolicyCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { BenefitBreakdown, CategoryDistribution } from '@/components/BenefitCharts'
import { formatWon } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

export function ResultsView({ result, profile, onReset }: { result: AnalysisResult; profile: UserProfile; onReset: () => void }) {
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const setView = useAppStore((s) => s.setView)
  const eligible = result.eligible_policies
  const monthly = result.portfolio_summary.total_monthly ?? 0
  const highCount = eligible.filter((p) => p.priority === 'high').length

  return (
    <div className="page-container py-8 sm:py-10">
      {/* 헤더 요약 */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-cute p-6 sm:p-8 bg-gradient-to-br from-sprout-50 via-white to-sky2-50 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-sprout-200/40 blur-2xl" />
        <div className="relative">
          <span className="chip-sprout inline-flex"><PartyPopper className="h-3.5 w-3.5" /> 분석 완료</span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold leading-tight">
            {profile.name || '회원'}님이 받을 수 있는 복지는<br />
            <span className="gradient-text">{eligible.length}개</span>예요! 🎉
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">{result.profile_summary}</p>

          <div className="mt-5 grid grid-cols-3 gap-3 max-w-lg">
            <StatBox icon={<Heart className="h-4 w-4" />} value={`${eligible.length}개`} label="수혜 가능" />
            <StatBox icon={<TrendingUp className="h-4 w-4" />} value={monthly > 0 ? `월 ${formatWon(monthly)}` : '-'} label="예상 합계" highlight />
            <StatBox icon={<Bell className="h-4 w-4" />} value={`${highCount}개`} label="강력 추천" />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={onReset} className="btn-secondary !py-2.5"><RotateCcw className="h-4 w-4" /> 다시 분석</button>
            <button onClick={() => setView('my')} className="btn-primary !py-2.5"><Heart className="h-4 w-4" /> 나의 복지에서 관리</button>
            <button onClick={() => window.print()} className="btn-secondary !py-2.5"><Printer className="h-4 w-4" /> 인쇄·저장</button>
          </div>
        </div>
      </motion.div>

      {/* 알림 */}
      {result.notifications.length > 0 && (
        <div className="mt-5 space-y-2">
          {result.notifications.map((n, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * i }}
              className="flex items-start gap-3 rounded-2xl bg-sun-100 border border-sun-200 px-4 py-3">
              <Bell className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-yellow-900">{n.title}</p>
                <p className="text-xs text-yellow-800/90">{n.message}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* 포트폴리오 분석 (전문 시각화) */}
      {eligible.length > 0 && (
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BenefitBreakdown policies={eligible} />
          <CategoryDistribution policies={eligible} />
        </section>
      )}

      {/* 정책 목록 */}
      {eligible.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="text-4xl mb-2">🤔</p>
          현재 입력 기준으로는 딱 맞는 정책을 찾지 못했어요.<br />
          조건을 조금 바꿔 다시 분석하거나, 정책 탐색에서 직접 둘러보세요.
        </div>
      ) : (
        <>
          <h2 className="mt-8 mb-3 text-lg font-extrabold">맞춤 복지 혜택 <span className="text-sprout-500">{eligible.length}</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {eligible.map((p, i) => (
              <PolicyCard key={p.id} policy={p} index={i} onOpen={setSelected} />
            ))}
          </div>
        </>
      )}

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function StatBox({ icon, value, label, highlight }: { icon: React.ReactNode; value: string; label: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-3 text-center ${highlight ? 'bg-sprout-500 text-white' : 'bg-white border border-sprout-100'}`}>
      <div className={`flex items-center justify-center gap-1 ${highlight ? 'text-white/90' : 'text-sprout-500'}`}>{icon}</div>
      <p className={`text-base font-extrabold mt-0.5 ${highlight ? 'text-white' : 'text-foreground'}`}>{value}</p>
      <p className={`text-[11px] font-semibold ${highlight ? 'text-white/80' : 'text-muted-foreground'}`}>{label}</p>
    </div>
  )
}
