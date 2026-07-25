import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Wallet, Scale, Sparkles, Compass, Printer, Cloud, ChevronDown, Wrench, UserPlus, FileText, BellRing } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { usePolicyMap } from '@/data/useCatalog'
import type { EligiblePolicy, AnalysisResult } from '@/lib/welfare-engine'
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
import { AnnualCashflow } from '@/components/AnnualCashflow'
import { DeadlineAlert } from '@/components/DeadlineAlert'
import { WelfareRoadmap } from '@/components/WelfareRoadmap'
import { PriorityRecommend } from '@/components/PriorityRecommend'
import { DocPlanCard } from '@/components/DocPlanCard'
import { PaymentSchedule } from '@/components/PaymentSchedule'
import { useAppStore, type AppStatus } from '@/store/useAppStore'
import { hasPendingIssue, ISSUE_DOC_EVENT, ISSUE_ALL_EVENT } from '@/lib/issueBridge'
import { countLiveIssuance } from '@/lib/liveTasks'
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

type MyTab = 'saved' | 'docs' | 'manage'

export function My() {
  const { tracked, setView, resetForNextUser, profile } = useAppStore()
  const [filter, setFilter] = useState<AppStatus | 'all'>('all')
  const [reportCopied, setReportCopied] = useState(false) // '리포트 복사' 피드백
  // 잡다한 세로 스크롤 대신 한 번에 한 섹션만 — 정보 과다 완화.
  // 챗·통화·오토파일럿의 발급 명령(issueBridge 보류)을 안고 착지하면 '서류 발급' 탭으로 바로 —
  // 기본 탭(담은 복지)에 가려 발급이 시작조차 안 되거나, 한참 뒤 탭 진입 때 돌발 시작되는 것 방지.
  const [tab, setTab] = useState<MyTab>(() => (hasPendingIssue() ? 'docs' : 'saved'))
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [compare, setCompare] = useState(false)
  const [showTools, setShowTools] = useState(false) // 보조 도구(캘린더·가구분석·자동화요약) 접기 — 요소 과다로 길 잃지 않게
  const POLICY_MAP = usePolicyMap()  // 반응형 — 외부 정책 지연 병합 시 자동 갱신(담아둔 공공데이터 정책 깨짐 방지)

  // My가 이미 떠 있는 동안 발급 명령이 오면(챗 CTA 등) 탭만 '서류 발급'으로 —
  // 보류 소비·발급 시작은 상시 마운트된 DocumentCenter의 기존 리스너가 그대로 맡는다(이중 소비 없음).
  useEffect(() => {
    const toDocs = () => setTab('docs')
    window.addEventListener(ISSUE_DOC_EVENT, toDocs)
    window.addEventListener(ISSUE_ALL_EVENT, toDocs)
    return () => {
      window.removeEventListener(ISSUE_DOC_EVENT, toDocs)
      window.removeEventListener(ISSUE_ALL_EVENT, toDocs)
    }
  }, [])

  // 탭 밖 진행 미니 스트립 — 서류 섹션은 숨김 상태로도 폴링을 계속하지만, 눈에 안 보이면 사용자는
  // 멈춘 줄 안다. liveTasks(시작 remember·종결 forget)가 진실원이라 '실제로 돌고 있는 것만' 센다.
  // 변화 기반 setState(같은 값이면 리렌더 0회 — 프로젝트 폴링 컨벤션과 동일).
  const [liveIssuing, setLiveIssuing] = useState(0)
  useEffect(() => {
    const tick = () => setLiveIssuing((prev) => { const n = countLiveIssuance(); return prev === n ? prev : n })
    tick()
    const t = window.setInterval(tick, 4000)
    return () => window.clearInterval(t)
  }, [])

  // 현금성 지원만 합산(바우처·서비스·현물 제외) — 결과화면과 동일 기준으로 과장 없이.
  const totalMonthly = useMemo(
    () => sumCashMonthly(tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean)),
    [tracked, POLICY_MAP],
  )
  const applied = tracked.filter((t) => t.status === 'applied' || t.status === 'done').length
  const shown = filter === 'all' ? tracked : tracked.filter((t) => t.status === filter)
  const comparePolicies = tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean).slice(0, 4)

  // 공용 기기·시연·현장 상담 전환 — 이 기기에 남은 '내 기록'을 한 번에 비우고 새 사용자로 시작.
  // (로그인이 없는 온디바이스 설계라, 같은 브라우저를 다른 사람이 쓰면 기록이 이어 보이므로 명시적 초기화 제공)
  const startNewUser = () => {
    if (!window.confirm('이 기기에 저장된 내 정보(담은 복지·프로필·진행 기록·발급 기록)를 모두 지우고 새 사용자로 시작할까요?\n\n※ 다른 사람에게 넘기거나 공용 기기에서 쓸 때 사용하세요. 지운 기록은 되돌릴 수 없어요.')) return
    resetForNextUser()
    setView('home')
  }

  // 담은 복지 목록을 텍스트 리포트로 복사 — 카톡·메일로 가족·사회복지사에게 전달(이름 기본 제외)
  const copyMyReport = async () => {
    const pols = tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean)
    const docs = Array.from(new Set(pols.flatMap((p) => p.required_docs || [])))
    const pseudo = { eligible_policies: pols, required_docs: docs } as unknown as AnalysisResult
    try {
      const { buildWelfareReport } = await import('@/lib/welfareReport')  // 클릭 시에만 로드
      await navigator.clipboard.writeText(buildWelfareReport(profile, pseudo, { includeName: false, now: new Date() }))
      setReportCopied(true)
      setTimeout(() => setReportCopied(false), 2000)
    } catch { /* 클립보드 미허용 등 무시 */ }
  }

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
        {/* 담은 복지가 없어도 데스크탑 에이전트가 있으면 '서류 발급 도우미'(슬림)는 동작 —
            심사·첫 사용이 빈 화면에서 끝나지 않게(웹에선 DocumentCenter가 null 반환, 표시 변화 없음) */}
        <div className="text-left"><DocumentCenter /></div>
        <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
      </div>
    )
  }

  const TABS: { key: MyTab; label: string; icon: typeof Heart; count?: number }[] = [
    { key: 'saved', label: '담은 복지', icon: Heart, count: tracked.length },
    { key: 'docs', label: '서류 발급', icon: FileText },
    { key: 'manage', label: '진행 관리', icon: BellRing },
  ]

  return (
    <div className="page-container py-8 sm:py-10">
      {/* ── 헤더 + 요약(항상 보이는 개요) ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold">나의 복지 <Heart className="inline h-6 w-6 text-peach-400 fill-peach-400" /></h1>
            <p className="text-muted-foreground mt-1 text-sm">담아둔 복지의 준비·진행을 한눈에 관리하세요.</p>
          </div>
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
            {/* 담은 복지 목록을 텍스트로 복사 — 가족·사회복지사에게 전달 */}
            {tracked.length > 0 && (
              <button
                onClick={copyMyReport}
                className="inline-flex items-center gap-1.5 rounded-full border border-sprout-200 bg-white px-3 py-1.5 text-xs font-semibold text-sprout-700 hover:border-sprout-300 transition-colors"
                aria-label="담은 복지 리포트 텍스트 복사"
              >
                <FileText className="h-3.5 w-3.5" /> {reportCopied ? '복사됨!' : '리포트 복사'}
              </button>
            )}
            {/* 공용 기기·다른 사람에게 넘길 때 — 이 기기의 내 기록을 비우고 새로 시작 */}
            <button
              onClick={startNewUser}
              className="inline-flex items-center gap-1.5 rounded-full border border-sprout-200 bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-sprout-300 hover:text-foreground transition-colors"
              title="이 기기에 저장된 내 정보를 지우고 새 사용자로 시작해요"
            >
              <UserPlus className="h-3.5 w-3.5" /> 새 사용자로 시작
            </button>
          </div>
        </div>
        <SyncBadge />

        {/* 요약 3종 */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard icon={<Heart className="h-5 w-5" />} value={`${tracked.length}개`} label="담은 복지" />
          <SummaryCard icon={<Wallet className="h-5 w-5" />} value={totalMonthly > 0 ? formatWon(totalMonthly) : '-'} sub={totalMonthly > 0 ? `연 최대 ${formatWon(totalMonthly * 12)}` : undefined} label="월 최대 현금지원" highlight />
          <SummaryCard icon={<span className="text-lg">📮</span>} value={`${applied}개`} label="신청 진행" />
        </div>
        {totalMonthly > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            ※ ‘월 최대 현금지원’은 담은 복지 중 <b>현금으로 받는 지원</b>만 더한 <b>이론상 최대치</b>예요. 중복으로 받을 수 없는 경우·가구원수·실제 자격에 따라 받는 금액은 달라질 수 있어요.
          </p>
        )}
      </motion.div>

      {/* 복지 여정 지도 — '지금 뭘 하면 되는지' 딱 하나. 단계를 누르면 아래 해당 탭으로 전환된다. */}
      <div className="mt-5">
        <JourneyStepper onGo={(stage) => setTab(stage === 'docs' ? 'docs' : stage === 'manage' ? 'manage' : 'saved')} />
      </div>

      {/* 담은 복지 중 마감 임박 — 놓침 방지(액션 직결이라 탭과 무관하게 항상 노출) */}
      <DeadlineAlert policies={tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean)} onOpen={setSelected} />

      {/* ── 탭 네비게이션 — 한 번에 한 섹션만(정보 과다 완화) ── */}
      <div role="tablist" aria-label="나의 복지 섹션" className="mt-6 flex gap-1 rounded-2xl border border-sprout-100 bg-sprout-50/70 p-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn('flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-bold transition-all',
                active ? 'bg-white text-sprout-800 shadow-soft' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.label}</span>
              {t.count != null && t.count > 0 && (
                <span className={cn('rounded-full px-1.5 text-[11px] font-extrabold', active ? 'bg-sprout-100 text-sprout-700' : 'bg-muted text-muted-foreground')}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* 탭 밖 진행 미니 스트립 — 다른 탭에 있어도 진행 중 발급을 놓치지 않게(탭 전환 원버튼) */}
      {tab !== 'docs' && liveIssuing > 0 && (
        <button
          type="button"
          onClick={() => setTab('docs')}
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-bold text-amber-800 hover:bg-amber-100 transition-colors"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          서류 발급이 진행 중이에요 ({liveIssuing}건) — 진행 상황 보러 가기
        </button>
      )}

      {/* ── 탭 내용 ── */}
      <div className="mt-4">
        {/* 담은 복지 — 목록·상태·비교(각 카드에서 상태·서류·다음 할 일 관리) */}
        {tab === 'saved' && (
          <section id="journey-apply" aria-label="담은 복지">
            {/* AI 브리핑 — 먼저 챙길 일을 능동적으로 보고(기본 탭에 배치해 상단 중복 스택 제거) */}
            <AgentBriefing onOpen={setSelected} />
            {/* 복지 신청 로드맵 — 담은 복지를 '무엇을 어떤 순서로' 실행 계획으로 */}
            <WelfareRoadmap onOpen={setSelected} />
            {/* 먼저 챙기세요 — 우선순위 점수로 '무엇부터'(3개 이상일 때만 자체 렌더) */}
            <PriorityRecommend onOpen={setSelected} />
            {/* 필터 + 비교/인쇄 */}
            <div className="flex items-center gap-2 overflow-x-auto nice-scroll pb-1">
              {FILTERS.map((f) => {
                const count = f.key === 'all' ? tracked.length : tracked.filter((t) => t.status === f.key).length
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    aria-pressed={filter === f.key}
                    className={cn('shrink-0 rounded-full px-4 py-2 text-sm font-semibold border-2 transition-all',
                      filter === f.key ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
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
        )}

        {/* 서류 발급 — 담은 복지에 필요한 서류를 미리 준비.
            발급·여정 진행 중 다른 탭으로 옮겨도 폴링·인증 대기 알림음이 끊기지 않게(8분 인증 타임아웃 방지)
            언마운트하지 않고 hidden(display:none)으로 숨기기만 한다 — 숨김 중 포커스·스크린리더 노출 없음. */}
        <section id="journey-docs" aria-label="서류 발급" className={tab === 'docs' ? undefined : 'hidden'}>
          {/* 서류 중심 통합 정리 — 재사용·유효기간(3개월)·공동이용 생략 배지를 한눈에 */}
          <DocPlanCard onOpen={setSelected} />
          <DocumentCenter />
        </section>

        {/* 진행 관리 — 마감·갱신·점검 알림(사후관리) */}
        {tab === 'manage' && (
          <section id="journey-manage" aria-label="진행 관리">
            {/* 신청·수급 중 급여의 다음 입금 예정일 — applied·done만 자체 렌더 */}
            <PaymentSchedule />
            <MonitorFeed onOpenItem={(id) => setSelected(POLICY_MAP[id] ?? null)} />
          </section>
        )}
      </div>

      {/* 보조 도구 — 기본은 접어두어 시야를 흐리지 않게(복지 캘린더·가구분석·자동화 요약) */}
      <div className="mt-8">
        <button
          onClick={() => setShowTools((v) => !v)}
          aria-expanded={showTools}
          className="w-full flex items-center gap-2 rounded-2xl border border-sprout-100 bg-white px-4 py-3 text-sm font-bold text-foreground hover:border-sprout-200 transition-colors"
        >
          <Wrench className="h-4 w-4 text-sprout-500" />
          복지 도구 더보기
          <span className="text-xs font-normal text-muted-foreground">알림 구독 · 연간 현금흐름 · 캘린더 · 가구 분석 · 자동화 요약</span>
          <ChevronDown className={cn('h-4 w-4 ml-auto transition-transform', showTools && 'rotate-180')} />
        </button>
        {showTools && (
          <div className="mt-2">
            {/* 관심 분야 알림 구독 — 안 담은 복지 능동 안내(발견용, 신청 흐름과 분리해 여기로) */}
            <InterestSubscribe onOpenPolicy={(id) => { const p = POLICY_MAP[id]; if (p) setSelected(p) }} />
            {/* 담은 복지의 연간 현금흐름 — 앞으로 12개월 누적 수령액(부가 정보) */}
            <AnnualCashflow policies={tracked.map((t) => POLICY_MAP[t.policyId]).filter(Boolean)} />
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
    <div className={cn('rounded-2xl px-4 py-4', highlight ? 'bg-gradient-to-br from-sprout-700 to-emerald-700 text-white shadow-soft' : 'card-cute')}>
      <div className={cn('flex items-center gap-1', highlight ? 'text-white' : 'text-sprout-500')}>{icon}</div>
      <p className={cn('text-xl font-extrabold mt-1', highlight ? 'text-white' : 'text-foreground')}>{value}</p>
      {sub && <p className={cn('text-[11px]', highlight ? 'text-white' : 'text-muted-foreground')}>{sub}</p>}
      <p className={cn('text-xs font-semibold', highlight ? 'text-white' : 'text-muted-foreground')}>{label}</p>
    </div>
  )
}
