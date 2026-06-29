import { motion } from 'framer-motion'
import { CalendarDays, Download, FileText, RefreshCw, Search } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { buildEvents, downloadICS, formatEventDate, type WelfareEvent } from '@/lib/calendar'

const KIND_ICON = { prepare: FileText, check: Search, renew: RefreshCw }
const KIND_CLS = {
  prepare: 'bg-sky2-100 text-sky2-600',
  check: 'bg-sun-100 text-yellow-700',
  renew: 'bg-peach-100 text-peach-600',
}

/** 복지 일정 — 신청 준비/점검/갱신 날짜 타임라인 + 캘린더(.ics) 내보내기 */
export function WelfareCalendar() {
  const tracked = useAppStore((s) => s.tracked)
  const events = buildEvents(tracked, getPolicyMap())
  if (events.length === 0) return null

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2"><CalendarDays className="h-5 w-5 text-sprout-500" /> 복지 일정</h2>
        <button onClick={() => downloadICS(events)} className="btn-secondary !py-2 !px-3 text-xs">
          <Download className="h-4 w-4" /> 캘린더 저장(.ics)
        </button>
      </div>
      <p className="text-sm text-muted-foreground mt-1">신청 준비·진행 점검·갱신 시기를 놓치지 않도록 일정으로 정리했어요.</p>

      <ol className="mt-4 relative border-l-2 border-dashed border-sprout-200 ml-3 space-y-4">
        {events.map((e: WelfareEvent) => {
          const Icon = KIND_ICON[e.kind]
          return (
            <li key={e.id} className="ml-5 relative">
              <span className={`absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full ${KIND_CLS[e.kind]} ring-4 ring-background`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="card-cute p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-sm">{e.title}</p>
                  <span className="chip-sprout shrink-0">{formatEventDate(e.date)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{e.note}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </motion.section>
  )
}
