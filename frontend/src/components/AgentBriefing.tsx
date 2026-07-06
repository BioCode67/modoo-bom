import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { AlarmClock, FileText, RefreshCw, CalendarClock, CheckCircle2, ChevronRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { buildActionFeed } from '@/lib/monitoring'
import { predictTimeline } from '@/lib/lifeAgent'
import { SproutLogo } from '@/ui/SproutLogo'

const KIND_META: Record<string, { icon: typeof AlarmClock; word: string }> = {
  submit: { icon: AlarmClock, word: '신청 마감' },
  docs: { icon: FileText, word: '서류 준비' },
  recheck: { icon: RefreshCw, word: '진행 점검' },
  renew: { icon: RefreshCw, word: '갱신 시기' },
}

/**
 * AI 에이전트 브리핑 — 에이전트가 1인칭으로 "제가 살펴봤어요"라며 지금 챙길 일을 먼저 보고한다.
 * 담아둔 복지의 마감·서류·점검 알림(모니터링) + 앞으로 열릴 복지(타임라인)를 능동적으로 요약.
 * 모두 브라우저 안에서 계산(서버 미전송).
 */
export function AgentBriefing({ onOpen }: { onOpen: (p: Policy | EligiblePolicy) => void }) {
  const { tracked, profile, docDone } = useAppStore()
  const map = getPolicyMap()

  const feed = useMemo(() => buildActionFeed(tracked, map, docDone), [tracked, map, docDone])
  const nextEvent = useMemo(() => (profile ? predictTimeline(profile)[0] : undefined), [profile])

  const urgent = feed.filter((f) => f.alert.level === 'high')
  const todo = feed.filter((f) => f.alert.level !== 'info')
  const topItems = (urgent.length ? urgent : todo).slice(0, 3)
  const name = profile?.name || '회원'

  const nothing = todo.length === 0 && !nextEvent

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="card-cute p-5 border-2 border-sprout-200 bg-gradient-to-br from-sprout-50 via-white to-sky2-50 mb-6"
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-sprout-100">
          <SproutLogo withFace className="h-8 w-8" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold text-sprout-600">새싹이 · 복지 에이전트</p>
          <h2 className="font-extrabold leading-tight">오늘의 복지 브리핑</h2>
        </div>
        <span className="chip-sprout !py-0.5 text-[11px] ml-auto shrink-0">제가 먼저 확인했어요</span>
      </div>

      {nothing ? (
        <p className="text-sm mt-2 flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success-500" />
          {name}님, 지금 급히 챙길 일은 없어요. 담아두신 복지 {tracked.length}건은 제가 계속 지켜볼게요.
        </p>
      ) : (
        <>
          <p className="text-sm mt-2 leading-relaxed">
            {name}님, 담아두신 복지를 살펴봤어요.{' '}
            {todo.length > 0
              ? <>지금 챙기면 좋은 일이 <b className="text-sprout-600">{todo.length}가지</b> 있어요.</>
              : '지금 당장 할 일은 없지만, 미리 알려드릴 게 있어요.'}
          </p>

          {topItems.length > 0 && (
            <ul className="mt-3 space-y-2">
              {topItems.map((f, i) => {
                const meta = KIND_META[f.alert.kind] ?? KIND_META.recheck
                const Icon = meta.icon
                return (
                  <li key={i}>
                    <button
                      onClick={() => f.policy && onOpen(f.policy)}
                      className="w-full text-left flex items-start gap-2.5 rounded-2xl bg-white/80 border border-sprout-100 p-2.5 hover:bg-white"
                    >
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${f.alert.level === 'high' ? 'bg-rose-100 text-rose-600' : 'bg-sky2-100 text-sky2-600'}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-xs font-bold">{f.policy?.name ?? '복지'} · {meta.word}</span>
                        <span className="block text-xs text-muted-foreground">{f.alert.text}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 opacity-40 mt-1.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {nextEvent && (
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground bg-white/70 rounded-2xl p-2.5 border border-sprout-100">
          <CalendarClock className="h-4 w-4 text-sprout-500 shrink-0 mt-0.5" />
          <span>
            <b>{nextEvent.whenLabel}</b> {nextEvent.trigger.replace('되는 해', '되면')}
            {nextEvent.gained.length > 0 && <> 복지 <b>{nextEvent.gained.length}개</b>가 새로 열려요.</>}
            {' '}그때 미리 챙겨드릴게요.
          </span>
        </div>
      )}
    </motion.section>
  )
}
