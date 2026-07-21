import { useState } from 'react'
import { motion } from 'framer-motion'
import { Trash2, ChevronDown, FileText, ExternalLink, Info } from 'lucide-react'
import { ExternalLink as ExtLink, RefreshCw } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { useAppStore, type AppStatus, type TrackedItem } from '@/store/useAppStore'
import { categoryMeta, parseMonthly, formatWon, isCashBenefit } from '@/lib/format'
import { docLink } from '@/lib/officialLinks'
import { bestApplyInfo } from '@/lib/quickApply'
import { monitorItem } from '@/lib/monitoring'
import { cn } from '@/lib/utils'

export const STATUS_META: Record<AppStatus, { label: string; cls: string; emoji: string }> = {
  idle: { label: '관심', cls: 'bg-sky2-100 text-sky2-700', emoji: '👀' },
  tracking: { label: '준비 중', cls: 'bg-sun-100 text-yellow-700', emoji: '📝' },
  applied: { label: '신청 완료', cls: 'bg-sprout-100 text-sprout-700', emoji: '📮' },
  done: { label: '수급 중', cls: 'bg-peach-100 text-peach-800', emoji: '🎉' },
}
const STATUS_ORDER: AppStatus[] = ['idle', 'tracking', 'applied', 'done']

export function TrackedCard({ item, policy, onOpen }: { item: TrackedItem; policy: Policy | undefined; onOpen: () => void }) {
  const { setStatus, toggleDoc, removeTracked, markChecked, docDone: globalDocDone } = useAppStore()
  const [open, setOpen] = useState(false)
  const meta = categoryMeta(item.category)
  // 현금성 혜택만 '월 N원'으로 표시(PolicyCard와 동일 게이트) — 바우처·감면·서비스한도를 현금처럼 과장 금지.
  // ⚠️ 이름·분류를 context로 넘겨야(감사 HIGH) 비현금 종류가 이름/분류에만 있는 '재가급여' 등을 잡아낸다 —
  //   없으면 '월 251만원 한도'(장기요양 서비스)를 현금 배지로 과장(나의 복지 합계와도 모순).
  const monthly = policy && isCashBenefit(policy.benefit, `${policy.name} ${policy.category}`) ? parseMonthly(policy.benefit) : 0
  const docs = policy?.required_docs ?? []
  // 서류 도우미의 '발급 완료' 기억(docDone)도 준비된 것으로 집계 — monitoring 산출(mon.nextAction)과 배지가 어긋나지 않게
  const isPrepared = (d: string) => item.checkedDocs.includes(d) || !!globalDocDone[d.replace(/\s/g, '')]
  const doneDocs = docs.filter(isPrepared).length
  const mon = monitorItem(item, policy, globalDocDone)

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="card-cute p-4">
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-lg', meta.cls)}>{meta.emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground">{item.category}</p>
          <button onClick={onOpen} className="font-bold text-[15px] leading-snug truncate hover:text-sprout-700 transition-colors text-left block w-full">
            {item.name}
          </button>
        </div>
        <button onClick={() => removeTracked(item.policyId)} aria-label="삭제" className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-500 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* 상태 단계 선택 */}
      <div className="mt-3 grid grid-cols-4 gap-1">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(item.policyId, s)}
            aria-pressed={item.status === s}
            className={cn('rounded-xl py-1.5 text-[11px] font-bold transition-all',
              item.status === s ? STATUS_META[s].cls + ' ring-2 ring-offset-1 ring-current/30' : 'bg-muted/60 text-muted-foreground hover:bg-muted')}
          >
            {STATUS_META[s].emoji}<br />{STATUS_META[s].label}
          </button>
        ))}
      </div>

      {/* 다음 할 일 */}
      <div className="mt-3 rounded-xl bg-sprout-50 px-3 py-2">
        <p className="text-[11px] font-bold text-sprout-700">다음 할 일</p>
        <p className="text-xs text-sprout-700 mt-0.5 leading-relaxed">{mon.nextAction}</p>
        {/* 공식 신청 링크 — 자동신청(복지로)이 안 되는 혜택(고용24·방문형 등)도 '어디서 신청하는지'는
            카드에서 바로 이어지게(실사용 제보: 서류 다 준비했는데 신청 경로가 안 보임). 라벨은 최종
            목적지 기준(bestApplyInfo). 신청 완료 후엔 아래 '진행상황 점검'이 그 역할을 대신한다. */}
        {policy && item.status !== 'applied' && item.status !== 'done' && (
          <a
            href={bestApplyInfo(policy.application, policy.name, policy.id).url}
            target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white border border-sprout-200 px-2.5 py-1 text-[11px] font-bold text-sprout-700 hover:bg-sprout-50 transition-colors"
          >
            📮 {bestApplyInfo(policy.application, policy.name, policy.id).label} <ExtLink className="h-3 w-3" />
          </a>
        )}
        {item.status === 'applied' && (
          <a
            href={mon.statusCheck.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markChecked(item.policyId)}
            className={cn('mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors',
              mon.reCheckDue ? 'bg-amber-400 text-white hover:bg-amber-500' : 'bg-white border border-sprout-200 text-sprout-700 hover:bg-sprout-50')}
          >
            <RefreshCw className="h-3 w-3" /> {mon.reCheckDue ? '지금 점검하기' : '진행상황 점검'} <ExtLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        {monthly > 0 ? (
          <span className="font-extrabold text-sprout-700">월 {formatWon(monthly)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">금액 상세는 신청 시 확인</span>
        )}
        {docs.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-semibold text-sky2-700">
            서류 {doneDocs}/{docs.length}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* 서류 체크리스트 */}
      {open && docs.length > 0 && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-3 space-y-1.5 overflow-hidden dotted-divider pt-3">
          {docs.map((d) => {
            const checked = isPrepared(d)
            const viaIssue = !item.checkedDocs.includes(d) && checked // 서류 도우미 발급 완료로만 준비됨
            return (
              <label key={d} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={checked} onChange={() => toggleDoc(item.policyId, d)} className="h-4 w-4 accent-sprout-500 rounded" />
                <FileText className="h-3.5 w-3.5 text-sky2-500 shrink-0" />
                <span className={cn('min-w-0 truncate', checked && 'line-through text-muted-foreground')}>{d}</span>
                {viaIssue && <span className="chip-sprout !py-0 !px-1.5 text-[9px] shrink-0">발급됨</span>}
                {/* 서류별 정밀 발급 딥링크 — generic 정부24 홈이 아니라 그 서류의 민원 화면으로(감사 지적).
                    label 내부의 인터랙티브 요소 클릭은 체크박스 토글로 전달되지 않는다(HTML 스펙). */}
                {!checked && (
                  <a
                    href={docLink(d).url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky2-700 hover:underline"
                  >
                    발급 <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </label>
            )
          })}
          <div className="flex gap-2 pt-2">
            <button onClick={onOpen} className="btn-ghost !px-2 text-xs"><Info className="h-3.5 w-3.5" /> 상세</button>
            <a href="https://www.gov.kr" target="_blank" rel="noopener noreferrer" className="btn-ghost !px-2 text-xs"><ExternalLink className="h-3.5 w-3.5" /> 정부24</a>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
