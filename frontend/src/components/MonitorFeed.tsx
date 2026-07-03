import { motion } from 'framer-motion'
import { Bell, FileText, Rocket, RefreshCw, CalendarClock, ExternalLink, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { buildActionFeed, type Alert } from '@/lib/monitoring'
import { applyLink } from '@/lib/officialLinks'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<Alert['kind'], typeof FileText> = {
  docs: FileText, submit: Rocket, recheck: RefreshCw, renew: CalendarClock,
}
const LEVEL_CLS: Record<Alert['level'], string> = {
  high: 'bg-rose-50 border-rose-200 text-rose-700',
  medium: 'bg-sun-100 border-sun-200 text-yellow-800',
  info: 'bg-sky2-50 border-sky2-100 text-sky2-700',
}

export function MonitorFeed({ onOpenItem }: { onOpenItem: (policyId: string) => void }) {
  const { tracked, markChecked, setStatus } = useAppStore()
  const feed = buildActionFeed(tracked, getPolicyMap())

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-cute p-5 sm:p-6 bg-gradient-to-br from-sprout-50 via-white to-sky2-50">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sprout-500 text-white"><Bell className="h-5 w-5" /></div>
        <div>
          <h2 className="font-extrabold text-lg leading-tight">복지 비서의 알림</h2>
          <p className="text-xs text-muted-foreground">신청 준비부터 사후 점검까지 챙겨드려요</p>
        </div>
        {feed.length > 0 && <span className="ml-auto chip-peach">{feed.length}건</span>}
      </div>

      {feed.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white border border-sprout-100 px-4 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 text-success-500 shrink-0" /> 지금 챙길 일이 없어요. 모두 정상이에요! ✨
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {feed.slice(0, 6).map(({ item, policy, alert, monitor }, i) => {
            const Icon = KIND_ICON[alert.kind]
            return (
              <li key={item.policyId + i} className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3', LEVEL_CLS[alert.level])}>
                <Icon className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-tight">{item.name}</p>
                  <p className="text-xs mt-0.5 opacity-90">{alert.text}</p>
                </div>
                <div className="shrink-0 self-center">
                  {alert.kind === 'submit' && (
                    <a href={applyLink(policy?.application || '').url} target="_blank" rel="noopener noreferrer"
                      onClick={() => setStatus(item.policyId, 'applied')}
                      className="btn-primary !px-3 !py-1.5 text-xs"><Rocket className="h-3.5 w-3.5" /> 신청</a>
                  )}
                  {alert.kind === 'docs' && (
                    <button onClick={() => onOpenItem(item.policyId)} className="btn-secondary !px-3 !py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> 서류</button>
                  )}
                  {(alert.kind === 'recheck' || alert.kind === 'renew') && (
                    <a href={monitor.statusCheck.url} target="_blank" rel="noopener noreferrer"
                      onClick={() => markChecked(item.policyId)}
                      className="btn-secondary !px-3 !py-1.5 text-xs"><ExternalLink className="h-3.5 w-3.5" /> 점검</a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </motion.section>
  )
}
