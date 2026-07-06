import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Wallet, Scale, Sparkles, Compass, Printer, Cloud, ChevronDown, Wrench } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { usePolicyMap } from '@/data/useCatalog'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { TrackedCard, STATUS_META } from '@/components/TrackedCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { InterestSubscribe } from '@/components/InterestSubscribe'
import { CompareModal } from '@/components/CompareModal'
import { DocumentCenter } from '@/components/DocumentCenter'
import { AgentSummary } from '@/components/AgentSummary'
import { AgentBriefing } from '@/components/AgentBriefing'
import { JourneyStepper } from '@/components/JourneyStepper'
import { MonitorFeed } from '@/components/MonitorFeed'
import { WelfareCalendar } from '@/components/WelfareCalendar'
import { HouseholdAnalyzer } from '@/components/HouseholdAnalyzer'
import { useAppStore, type AppStatus } from '@/store/useAppStore'
import { useAuthCtx } from '@/lib/authContext'
import { sumCashMonthly, formatWon } from '@/lib/format'
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
  const [showTools, setShowTools] = useState(false) // 보조 도구(캘린더·가구분석·자동화요약) 접기 — 요소 과다로 길 잃지 않게
  const POLICY_MAP = usePolicyMap()  // 반응형 — 외부 정책 지연 병합 시 자동 갱신(담아둔 공공데이터 정책 깨짐 방지)

  // 현금성 지원만 합산(바우처·서비스·현물 제외) — 결과화면과 동일 기준으로 과장 없이.
  const totalMonthly = useMemo(
    () => sumCashMonthly(tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean)),
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
        {/* 담은 게 없어도 관심 분야는 구독할 수 있게 — 능동 안내의 진입점 */}
        <div className="mx-auto mt-8 max-w-xl text-left">
          <InterestSubscribe onOpenPolicy={(id) => { const p = POLICY_MAP[id]; if (p) setSelected(p) }} />
        </div>
        <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
      </div>
    )
  }

  return (
    <div className="page-container py-8 sm:py-10">
      {/* AI 에이전트 브리핑 — 먼저 챙길 일을 능동적으로 보고 */}
      <AgentBriefing onOpen={setSelected} />

      {/* 복지 여정 지도 — 찾기 → 서류 → 신청 → 관리 중 지금 어디쯤인지 + 다음 한 걸음 */}
      <JourneyStepper />

      {/* 관심 분야 알림 구독 — 구독 분야에서 받을 수 있는데 안 담은 복지를 능동 안내 */}
      <InterestSubscribe onOpenPolicy={(id) => { const p = POLICY_MAP[id]; if (p) setSelected(p) }} />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">나의 복지 <Heart className="inline h-6 w-6 text-peach-400 fill-peach-400" /></h1>
        <p className="text-muted-foreground mt-1">담아둔 복지의 신청 준비와 진행 상황을 한눈에 관리하세요.</p>
        <SyncBadge />

        {/* 요약/계산기 */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard icon={<Heart className="h-5 w-5" />} value={`${tracked.length}개`} label="담은 복지" />
          <SummaryCard icon={<Wallet className="h-5 w-5" />} value={totalMonthly > 0 ? formatWon(totalMonthly) : '-'} sub={totalMonthly > 0 ? `연 최대 ${formatWon(totalMonthly * 12)}` : undefined} label="월 최대 현금지원" highlight />
          <SummaryCard icon={<span className="text-lg">📮</span>} value={`${applied}개`} label="신청 진행" />
        </div>
      </motion.div>

      {/* ② 신청 — 담은 복지 목록(각 카드에서 상태·서류·다음 할 일 관리) */}
      <section id="journey-apply" className="scroll-mt-24">
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
      </section>

      {/* ① 서류 발급 — 담은 복지에 필요한 서류를 미리 준비 */}
      <section id="journey-docs" className="scroll-mt-24">
        <DocumentCenter />
      </section>

      {/* ③ 상태확인·관리 — 마감·갱신·점검 알림(사후관리) */}
      <section id="journey-manage" className="mt-8 scroll-mt-24">
        <MonitorFeed onOpenItem={(id) => setSelected(POLICY_MAP[id] ?? null)} />
      </section>

      {/* 보조 도구 — 기본은 접어두어 시야를 흐리지 않게(복지 캘린더·가구분석·자동화 요약) */}
      <div className="mt-8">
        <button
          onClick={() => setShowTools((v) => !v)}
          aria-expanded={showTools}
          className="w-full flex items-center gap-2 rounded-2xl border border-sprout-100 bg-white px-4 py-3 text-sm font-bold text-foreground hover:border-sprout-200 transition-colors"
        >
          <Wrench className="h-4 w-4 text-sprout-500" />
          복지 도구 더보기
          <span className="text-xs font-normal text-muted-foreground">복지 캘린더 · 가구 분석 · 자동화 요약</span>
          <ChevronDown className={cn('h-4 w-4 ml-auto transition-transform', showTools && 'rotate-180')} />
        </button>
        {showTools && (
          <div className="mt-2">
            <WelfareCalendar />
            <HouseholdAnalyzer onOpen={setSelected} />
            <AgentSummary />
          </div>
        )}
      </div>

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
      {compare && <CompareModal policies={comparePolicies} onClose={() => setCompare(false)} />}
    </div>
  )
}

/** 로그인/동기화 상태 배지 — 미설정 시 숨김(현행 동일) */
function SyncBadge() {
  const { enabled, user, name, syncing } = useAuthCtx()
  if (!enabled) return null
  if (user) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sprout-700 bg-sprout-50 rounded-full px-3 py-1">
        <Cloud className="h-3.5 w-3.5" /> {name}님 · {syncing ? '동기화 중…' : '기기 간 동기화 켜짐'}
      </p>
    )
  }
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
      🔒 로그인하면 다른 기기·브라우저에서도 신청 현황을 이어볼 수 있어요 (우측 상단 ‘로그인’)
    </p>
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
