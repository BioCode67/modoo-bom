import { motion } from 'framer-motion'
import { Search, FileText, Send, BellRing, Check, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { usePolicyMap } from '@/data/useCatalog'
import { computeJourney, JOURNEY_STAGES, type JourneyStage } from '@/lib/journey'
import { cn } from '@/lib/utils'

const META: Record<JourneyStage, { icon: typeof Search; label: string; anchor?: string }> = {
  find: { icon: Search, label: '복지 찾기' },
  docs: { icon: FileText, label: '서류 발급', anchor: 'journey-docs' },
  apply: { icon: Send, label: '신청', anchor: 'journey-apply' },
  manage: { icon: BellRing, label: '상태확인·관리', anchor: 'journey-manage' },
}

// 현재 단계별 '다음 한 걸음' 안내 — 딱 하나의 행동만 또렷하게(요소 과다로 길 잃지 않게)
const NEXT: Record<JourneyStage, { title: string; body: string; cta: string }> = {
  find: { title: '먼저 내 복지를 찾아볼까요?', body: '나이·소득·상황만 알려주시면 받을 수 있는 복지를 찾아드려요.', cta: '내 복지 찾기' },
  docs: { title: '다음: 필요한 서류 발급', body: '담아둔 복지에 필요한 서류를 미리 발급해두면 신청이 훨씬 빨라져요. 설치 없이 웹에서 바로요.', cta: '서류 발급하러 가기' },
  apply: { title: '다음: 신청하기', body: '서류가 준비됐어요. 이제 신청하고, 각 복지 카드에서 상태를 ‘신청 완료’로 바꿔주세요.', cta: '신청할 복지 보기' },
  manage: { title: '잘하고 계세요! 🎉', body: '신청한 복지의 마감·갱신·점검은 새싹이가 계속 지켜보고 먼저 알려드릴게요.', cta: '진행 상황 보기' },
}

function scrollToAnchor(id: string) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 복지 여정 스텝퍼 — 찾기 → 서류 → 신청 → 관리의 4단계 지도.
 * 현재 위치를 강조하고, '다음 한 걸음' 버튼으로 해당 섹션(서류·목록·알림)으로 데려간다.
 * 각 단계 노드도 눌러 해당 섹션으로 이동 가능(방향 감각 제공).
 *
 * context:
 *  - 'my'(기본): 나의 복지 화면 — 현재 단계 섹션으로 스크롤.
 *  - 'result': 결과 화면(찾기 직후) — 찾기 완료를 보여주고 '나의 복지에서 이어가기'로 흐름을 잇는다.
 */
export function JourneyStepper({ context = 'my' }: { context?: 'my' | 'result' } = {}) {
  const { tracked, docDone, setView } = useAppStore()
  const map = usePolicyMap()
  const isResult = context === 'result'
  // 담은 복지 중 필요 서류가 하나라도 있는지 — 없으면(공공데이터만 담은 경우) 서류 단계를 건너뛴다.
  const needsDocs = isResult ? true : tracked.some((t) => (map[t.policyId]?.required_docs?.length ?? 0) > 0)
  const j = computeJourney(tracked, docDone, isResult, needsDocs)
  let next = isResult
    ? { title: '복지 찾기 완료! 🎉', body: '이제 마음에 드는 복지를 담고, 서류 발급·신청·관리를 이어서 진행해요.', cta: '나의 복지에서 이어가기' }
    : NEXT[j.current]
  // 서류가 필요 없어 건너뛴 경우 — '서류가 준비됐어요'는 부정확. 에이전트가 상황을 파악했음을 정직히 안내.
  if (!isResult && j.current === 'apply' && !needsDocs) {
    next = { ...next, body: '담아둔 복지는 따로 준비할 서류가 없어요. 바로 신청하고, 각 복지 카드에서 상태를 ‘신청 완료’로 바꿔주세요.' }
  }

  const go = (stage: JourneyStage) => {
    if (stage === 'find') { setView('analyze'); return }
    if (isResult) { setView('my'); return } // 결과 화면엔 서류·목록 섹션이 없으니 나의 복지로 이어준다
    const anchor = META[stage].anchor
    if (anchor) scrollToAnchor(anchor)
  }
  const goNext = () => (isResult ? setView('my') : go(j.current))

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="card-cute p-4 sm:p-5 mb-5 bg-gradient-to-br from-white to-sprout-50/60"
      aria-label="복지 여정 안내"
    >
      {/* 4단계 지도 */}
      <ol className="flex items-center">
        {JOURNEY_STAGES.map((stage, i) => {
          const m = META[stage]
          const Icon = m.icon
          const isDone = j.done[stage]
          const isCurrent = j.current === stage
          return (
            <li key={stage} className={cn('flex items-center', i < JOURNEY_STAGES.length - 1 && 'flex-1')}>
              <button
                onClick={() => go(stage)}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex flex-col items-center gap-1 shrink-0 group"
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                  isDone ? 'bg-sprout-500 border-sprout-500 text-white'
                    : isCurrent ? 'bg-white border-sprout-500 text-sprout-700 ring-4 ring-sprout-100'
                    : 'bg-white border-muted text-muted-foreground')}>
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={cn('text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-colors',
                  isCurrent ? 'text-sprout-700' : isDone ? 'text-sprout-700' : 'text-muted-foreground')}>
                  {m.label}
                </span>
              </button>
              {i < JOURNEY_STAGES.length - 1 && (
                <span className={cn('h-0.5 flex-1 mx-1 sm:mx-2 rounded-full -mt-4', isDone ? 'bg-sprout-400' : 'bg-muted')} aria-hidden />
              )}
            </li>
          )
        })}
      </ol>

      {/* 다음 한 걸음 */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-sprout-50 border border-sprout-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-sprout-800">{next.title}</p>
          <p className="text-xs text-sprout-700/90 mt-0.5 leading-relaxed">{next.body}</p>
        </div>
        <button
          onClick={goNext}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full bg-sprout-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-sprout-600 transition-colors"
        >
          {next.cta} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.section>
  )
}
