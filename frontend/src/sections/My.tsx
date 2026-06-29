import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Wallet, Scale, Sparkles, Compass, Printer } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { getPolicyMap } from '@/data/catalog'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { TrackedCard, STATUS_META } from '@/components/TrackedCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { CompareModal } from '@/components/CompareModal'
import { DocumentCenter } from '@/components/DocumentCenter'
import { MonitorFeed } from '@/components/MonitorFeed'
import { WelfareCalendar } from '@/components/WelfareCalendar'
import { useAppStore, type AppStatus } from '@/store/useAppStore'
import { parseMonthly, formatWon } from '@/lib/format'
import { StaticMascot } from '@/three/MascotCanvas'
import { cn } from '@/lib/utils'

const FILTERS: { key: AppStatus | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'idle', label: '관심' },
  { key: 'tracking', label: '준비 중' },
  { key: 'applied', label: '신청 완료' },
  { key: 'done', label: '수급 중' },
]

export function My() {
  const { tracked, setView } = useAppStore()
  const [filter, setFilter] = useState<AppStatus | 'all'>('all')
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [compare, setCompare] = useState(false)
  const POLICY_MAP = getPolicyMap()

  const totalMonthly = useMemo(
    () => tracked.reduce((sum, t) => sum + (POLICY_MAP[t.policyId] ? parseMonthly(POLICY_MAP[t.policyId].benefit) : 0), 0),
    [tracked, POLICY_MAP],
  )
  const applied = tracked.filter((t) => t.status === 'applied' || t.status === 'done').length
  const shown = filter === 'all' ? tracked : tracked.filter((t) => t.status === filter)
  const comparePolicies = tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean).slice(0, 4)

  if (tracked.length === 0) {
    return (
      <div className="page-container py-16 text-center">
        <div className="mx-auto h-40 w-40"><StaticMascot /></div>
        <h1 className="mt-4 text-2xl font-extrabold">아직 담은 복지가 없어요</h1>
        <p className="mt-2 text-muted-foreground">마음에 드는 복지를 관심목록에 담으면<br />여기서 신청 준비와 진행 상황을 관리할 수 있어요.</p>
        <div className="mt-6 flex gap-2 justify-center">
          <button onClick={() => setView('analyze')} className="btn-primary"><Sparkles className="h-4 w-4" /> 내 복지 찾기</button>
          <button onClick={() => setView('explore')} className="btn-secondary"><Compass className="h-4 w-4" /> 정책 둘러보기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">나의 복지 <Heart className="inline h-6 w-6 text-peach-400 fill-peach-400" /></h1>
        <p className="text-muted-foreground mt-1">담아둔 복지의 신청 준비와 진행 상황을 한눈에 관리하세요.</p>

        {/* 요약/계산기 */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard icon={<Heart className="h-5 w-5" />} value={`${tracked.length}개`} label="담은 복지" />
          <SummaryCard icon={<Wallet className="h-5 w-5" />} value={totalMonthly > 0 ? formatWon(totalMonthly) : '-'} sub={totalMonthly > 0 ? `연 ${formatWon(totalMonthly * 12)}` : undefined} label="예상 월 합계" highlight />
          <SummaryCard icon={<span className="text-lg">📮</span>} value={`${applied}개`} label="신청 진행" />
        </div>
      </motion.div>

      {/* 복지 비서 알림 (사후관리/점검) */}
      <div className="mt-6">
        <MonitorFeed onOpenItem={(id) => setSelected(POLICY_MAP[id] ?? null)} />
      </div>

      {/* 필터 + 비교 */}
      <div className="mt-6 flex items-center gap-2 overflow-x-auto nice-scroll pb-1">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? tracked.length : tracked.filter((t) => t.status === f.key).length
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn('shrink-0 rounded-full px-4 py-2 text-sm font-semibold border-2 transition-all',
                filter === f.key ? 'bg-sprout-500 border-sprout-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
            >
              {f.key !== 'all' && STATUS_META[f.key].emoji} {f.label} {count > 0 && <span className="opacity-70">{count}</span>}
            </button>
          )
        })}
        <div className="shrink-0 ml-auto flex gap-2">
          {comparePolicies.length >= 2 && (
            <button onClick={() => setCompare(true)} className="btn-secondary !py-2 !px-3 text-xs"><Scale className="h-4 w-4" /> 비교</button>
          )}
          <button onClick={() => window.print()} className="btn-secondary !py-2 !px-3 text-xs"><Printer className="h-4 w-4" /> 인쇄·저장</button>
        </div>
      </div>

      {/* 목록 */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence>
          {shown.map((item) => (
            <TrackedCard key={item.policyId} item={item} policy={POLICY_MAP[item.policyId]} onOpen={() => setSelected(POLICY_MAP[item.policyId] ?? null)} />
          ))}
        </AnimatePresence>
      </div>
      {shown.length === 0 && <p className="py-12 text-center text-muted-foreground">해당 상태의 복지가 없어요.</p>}

      <WelfareCalendar />

      <DocumentCenter />

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} />
      {compare && <CompareModal policies={comparePolicies} onClose={() => setCompare(false)} />}
    </div>
  )
}

function SummaryCard({ icon, value, label, sub, highlight }: { icon: React.ReactNode; value: string; label: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-2xl px-4 py-4', highlight ? 'bg-gradient-to-br from-sprout-500 to-emerald-500 text-white shadow-soft' : 'card-cute')}>
      <div className={cn('flex items-center gap-1', highlight ? 'text-white/90' : 'text-sprout-500')}>{icon}</div>
      <p className={cn('text-xl font-extrabold mt-1', highlight ? 'text-white' : 'text-foreground')}>{value}</p>
      {sub && <p className={cn('text-[11px]', highlight ? 'text-white/80' : 'text-muted-foreground')}>{sub}</p>}
      <p className={cn('text-xs font-semibold', highlight ? 'text-white/80' : 'text-muted-foreground')}>{label}</p>
    </div>
  )
}
