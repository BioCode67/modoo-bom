import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileCheck2, Copy, Check, ChevronDown, Layers, RefreshCw, ChevronRight } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { usePolicyMap } from '@/data/useCatalog'
import { useAppStore } from '@/store/useAppStore'
import { buildDocPlan, docPlanToText, type DocNeed, type DocNeedStatus } from '@/lib/docPlan'
import { freshnessLabel, freshnessTone } from '@/lib/docValidity'
import { docGuide } from '@/lib/docGuide'
import { cn } from '@/lib/utils'

const STATUS_UI: Record<DocNeedStatus, { badge: string; label: string; emoji: string }> = {
  expired: { badge: 'bg-rose-100 text-rose-700', label: '재발급 필요', emoji: '❗' },
  expiring: { badge: 'bg-amber-100 text-amber-800', label: '만료 임박', emoji: '⏰' },
  missing: { badge: 'bg-sky2-100 text-sky2-700', label: '준비 필요', emoji: '⬜' },
  ready: { badge: 'bg-sprout-100 text-sprout-700', label: '준비 완료', emoji: '✅' },
}

/**
 * 필요 서류 한눈에 — 담은 복지들의 required_docs 를 '서류 중심'으로 합쳐서
 * ① 어떤 서류가 몇 개의 신청에 재사용되는지(발급 노력 최소화)
 * ② 발급해둔 서류가 언제 만료되는지(3개월 유효기간)를 정리해 보여준다.
 *
 * 순수 로직(lib/docPlan.ts)이 계산하고 여기선 표시·복사만. 담은 복지에 서류 정보가 없으면
 * 아무것도 렌더하지 않는다(My 화면을 침범하지 않음). 전부 브라우저 안에서 계산(서버 전송 없음).
 */
export function DocPlanCard({ onOpen }: { onOpen?: (p: Policy) => void }) {
  const tracked = useAppStore((s) => s.tracked)
  const docDone = useAppStore((s) => s.docDone)
  const POLICY_MAP = usePolicyMap()
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const plan = useMemo(
    () => buildDocPlan(tracked.map((t) => ({ policyId: t.policyId })), POLICY_MAP, docDone, Date.now()),
    [tracked, POLICY_MAP, docDone],
  )

  if (plan.uniqueDocs === 0) return null

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(docPlanToText(plan))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* 클립보드 미지원 — 조용히 무시 */ }
  }

  const alertCount = plan.expiredCount + plan.expiringCount

  return (
    <section className="mt-8 card-cute p-4 sm:p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky2-100 text-sky2-700"><FileCheck2 className="h-5 w-5" /></span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-extrabold">
            필요 서류 한눈에
            {alertCount > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{alertCount}건 확인</span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground truncate">담은 복지 {plan.totalPolicies}개 · 필요 서류 {plan.uniqueDocs}종</span>
        </span>
        <ChevronDown className={cn('ml-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <p className="mt-3 text-sm text-foreground/90">{plan.summary}</p>

            {/* 재사용 하이라이트 — 한 번 떼서 여러 신청에 쓰는 서류 */}
            {plan.topReuse && plan.topReuse.policies.length >= 2 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-sprout-50 border border-sprout-100 px-3 py-2 text-sm">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-sprout-600" />
                <span><b>{plan.topReuse.name}</b> 하나면 <b>{plan.topReuse.policies.length}개</b> 신청에 함께 써요 — 한 번만 발급하면 돼요.</span>
              </div>
            )}

            {/* 상태 요약 칩 */}
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="chip bg-muted text-muted-foreground">총 {plan.uniqueDocs}종</span>
              {plan.readyCount > 0 && <span className="chip bg-sprout-100 text-sprout-700">완료 {plan.readyCount}</span>}
              {plan.expiringCount > 0 && <span className="chip bg-amber-100 text-amber-800">임박 {plan.expiringCount}</span>}
              {plan.expiredCount > 0 && <span className="chip bg-rose-100 text-rose-700">만료 {plan.expiredCount}</span>}
              {plan.missingCount > 0 && <span className="chip bg-sky2-100 text-sky2-700">준비 필요 {plan.missingCount}</span>}
            </div>

            {/* 서류 목록 */}
            <ul className="mt-3 space-y-1.5">
              {plan.needs.map((n) => (
                <DocRow
                  key={n.key} need={n}
                  expanded={expanded === n.key}
                  onToggle={() => setExpanded((k) => (k === n.key ? null : n.key))}
                  onOpenPolicy={(id) => { const p = POLICY_MAP[id]; if (p) onOpen?.(p) }}
                />
              ))}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">※ 유효기간은 통상 기준(발급 3개월)이며, 실제 인정 여부는 접수 기관 요구가 우선이에요.</p>
              <button onClick={copyPlan} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-sprout-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-sprout-200">
                {copied ? <><Check className="h-3.5 w-3.5 text-sprout-600" /> 복사됨</> : <><Copy className="h-3.5 w-3.5" /> 목록 복사</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** 서류 한 줄 — 상태·재사용·자동발급·유효기간 + 펼치면 필요한 신청 목록 */
function DocRow({ need, expanded, onToggle, onOpenPolicy }: {
  need: DocNeed
  expanded: boolean
  onToggle: () => void
  onOpenPolicy: (id: string) => void
}) {
  const ui = STATUS_UI[need.status]
  const tone = need.validity ? freshnessTone(need.validity.freshness) : null
  const reuse = need.policies.length
  return (
    <li className="rounded-xl border border-sprout-100 bg-white/70">
      <button onClick={onToggle} aria-expanded={expanded} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span aria-hidden className="shrink-0 text-sm">{ui.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="text-sm">{need.name}</b>
            {need.issuable && <span className="rounded bg-sprout-100 px-1.5 py-0.5 text-[10px] font-bold text-sprout-700">자동발급</span>}
            {reuse >= 2 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{reuse}개 신청 공용</span>}
          </span>
          {need.validity && need.validity.freshness !== 'permanent' && tone && (
            <span className={cn('mt-0.5 block text-[11px] font-semibold', tone.text)}>{freshnessLabel(need.validity)}</span>
          )}
        </span>
        <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold', ui.badge)}>{ui.label}</span>
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="border-t border-sprout-100 px-3 py-2">
          {(need.status === 'expired' || need.status === 'expiring') && (
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
              <RefreshCw className="h-3 w-3" /> {need.issuable ? '아래 [서류 준비]에서 다시 발급할 수 있어요.' : '발급처에서 최신 서류로 다시 받으세요.'}
            </p>
          )}
          {/* 발급 방법 안내 — 어디서 어떻게 떼는지 */}
          {(() => {
            const g = docGuide(need.name)
            if (!g) return null
            return (
              <div className="mb-2">
                <p className="text-[11px] text-muted-foreground mb-1">발급 방법{g.fee === 'free' ? ' · 무료' : g.fee === 'paid' ? ' · 유료' : ''}{g.note ? ` · ${g.note}` : ''}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.channels.map((c, i) => (
                    c.url ? (
                      <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" className="chip bg-sky2-50 text-sky2-700 hover:bg-sky2-100 transition-colors text-xs">
                        {c.label}{c.detail ? ` · ${c.detail}` : ''}
                      </a>
                    ) : (
                      <span key={i} className="chip bg-muted text-muted-foreground text-xs">{c.label}{c.detail ? ` · ${c.detail}` : ''}</span>
                    )
                  ))}
                </div>
              </div>
            )
          })()}
          <p className="text-[11px] text-muted-foreground mb-1">이 서류가 필요한 신청</p>
          <div className="flex flex-wrap gap-1.5">
            {need.policies.map((p) => (
              <button key={p.id} onClick={() => onOpenPolicy(p.id)} className="chip bg-muted hover:bg-sprout-100 transition-colors text-xs">
                {p.name} <ChevronRight className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}
