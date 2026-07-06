import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bell, BellRing, FileText, Rocket, RefreshCw, CalendarClock, ExternalLink, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getPolicyMap } from '@/data/catalog'
import { buildActionFeed, type Alert } from '@/lib/monitoring'
import { buildPrefill, prefillText } from '@/lib/prefill'
import { bestApplyUrl } from '@/lib/quickApply'
import { notifySupported, notifyPermission, enableNotify, maybeNotifyDue } from '@/lib/notify'
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
  const { tracked, markChecked, setStatus, profile, rpaInfo } = useAppStore()
  const feed = buildActionFeed(tracked, getPolicyMap())
  // '신청' 클릭 시 내 정보를 클립보드에 복사(공식 신청서에 바로 붙여넣기) — 드로어와 동일한 원터치 경험
  const copyPrefill = async () => {
    try {
      const fields = buildPrefill(profile, rpaInfo)
      if (fields.length) await navigator.clipboard.writeText(prefillText(fields))
    } catch { /* 무시 */ }
  }

  // 선제 알림: 옵트인 상태면 '지금 챙길 일'(high/medium)을 재방문 시 하루 1회 로컬 알림으로.
  const [perm, setPerm] = useState<NotificationPermission>(() => notifyPermission())
  const due = feed.filter((f) => f.alert.level !== 'info')
  useEffect(() => {
    if (perm !== 'granted' || due.length === 0) return
    const sig = due.map((f) => f.item.policyId + f.alert.kind).join('|')
    const sample = `${due[0].item.name}: ${due[0].alert.text}`
    maybeNotifyDue(due.length, sample, sig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm, due.length])

  const askNotify = async () => {
    const ok = await enableNotify()
    setPerm(notifyPermission())
    if (ok && due.length > 0) {
      const sig = due.map((f) => f.item.policyId + f.alert.kind).join('|') + ':optin'
      maybeNotifyDue(due.length, `${due[0].item.name}: ${due[0].alert.text}`, sig)
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card-cute p-5 sm:p-6 bg-gradient-to-br from-sprout-50 via-white to-sky2-50">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sprout-500 text-white"><Bell className="h-5 w-5" /></div>
        <div>
          <h2 className="font-extrabold text-lg leading-tight">새싹이가 챙길 일</h2>
          <p className="text-xs text-muted-foreground">신청 준비부터 사후 점검까지 제가 챙겨드릴게요</p>
        </div>
        {feed.length > 0 && <span className="ml-auto chip-peach">{feed.length}건</span>}
      </div>

      {/* 선제 알림 옵트인 — 경쟁 서비스의 '마감·갱신 알림'을 백엔드 없이(재방문 시 하루 1회, 서버 전송 없음) */}
      {notifySupported() && perm !== 'granted' && (
        <button onClick={askNotify}
          className="mt-3 w-full flex items-center gap-2 rounded-2xl border border-sprout-200 bg-white px-4 py-2.5 text-sm font-semibold text-sprout-700 hover:bg-sprout-50 transition-colors">
          <BellRing className="h-4 w-4" /> 마감·갱신 알림 받기
          <span className="ml-auto text-xs font-normal text-muted-foreground">기기 알림 · 서버 전송 없음</span>
        </button>
      )}

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
                    <a href={bestApplyUrl(policy?.application || '', policy?.name)} target="_blank" rel="noopener noreferrer"
                      onClick={() => { setStatus(item.policyId, 'applied'); copyPrefill() }}
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
