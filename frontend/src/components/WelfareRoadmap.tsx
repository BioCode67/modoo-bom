import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Route, Printer, Copy, Check, ExternalLink, ChevronDown } from 'lucide-react'
import type { Policy } from '@/data/policies'
import { usePolicyMap } from '@/data/useCatalog'
import { useAppStore } from '@/store/useAppStore'
import {
  buildRoadmap, roadmapToText, PHASE_ORDER, PHASE_META,
  type RoadmapInput, type RoadmapStep, type ApplyChannel,
} from '@/lib/roadmap'
import { bestApplyUrl, isBokjiroApplyable } from '@/lib/quickApply'
import { formatWon } from '@/lib/format'
import { cn } from '@/lib/utils'

const CHANNEL_LABEL: Record<ApplyChannel, string> = {
  online: '복지로·정부24 온라인',
  visit: '주민센터 방문',
  mixed: '온라인 또는 방문',
}

/**
 * 복지 신청 로드맵 — 담아둔 복지를 '무엇을, 어떤 순서로' 신청할지 실행 계획으로 보여준다.
 * 순수 로직(lib/roadmap.ts)이 단계 분류·정렬·서류 종합을 계산하고, 여기선 표시·복사·인쇄만 담당.
 * 담은 복지가 없으면 아무것도 렌더하지 않는다(My의 빈 상태를 침범하지 않음).
 */
export function WelfareRoadmap({ onOpen }: { onOpen?: (p: Policy) => void }) {
  const tracked = useAppStore((s) => s.tracked)
  const docDone = useAppStore((s) => s.docDone)
  const POLICY_MAP = usePolicyMap()
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const roadmap = useMemo(() => {
    const inputs: RoadmapInput[] = tracked
      .map((t) => ({ policy: POLICY_MAP[t.policyId], checkedDocs: t.checkedDocs }))
      .filter((i) => !!i.policy)
    return buildRoadmap(inputs, {
      // 발급 완료 기억(store.docDone)을 전역 보유로 — 한 번 뗀 서류는 여러 신청에 재사용.
      hasDoc: (d) => !!docDone[d.replace(/\s/g, '')],
      // 복지로 딥링크가 실제로 잡히는 정책만 온라인 신청 링크 노출(홈만 나오는 방문형 제외).
      resolveUrl: (p) => (isBokjiroApplyable(p.application, p.name, p.id) ? bestApplyUrl(p.application, p.name, p.id) : undefined),
    })
  }, [tracked, POLICY_MAP, docDone])

  if (roadmap.steps.length === 0) return null
  const { summary } = roadmap
  const pct = summary.docProgress.total > 0 ? Math.round((summary.docProgress.done / summary.docProgress.total) * 100) : 0

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(roadmapToText(roadmap))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* 클립보드 미지원 — 조용히 무시 */ }
  }

  const printPlan = () => {
    const w = window.open('', '_blank', 'width=760,height=900')
    if (!w) { void copyPlan(); return } // 팝업 차단 시 복사로 폴백
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]))
    w.document.write(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>복지 신청 로드맵</title>` +
      `<style>body{font-family:'Pretendard',system-ui,-apple-system,sans-serif;padding:32px 36px;white-space:pre-wrap;line-height:1.75;font-size:15px;color:#1a1a1a}h1{font-size:20px;margin:0 0 14px}</style>` +
      `</head><body><h1>복지 신청 로드맵</h1>${esc(roadmapToText(roadmap))}</body></html>`,
    )
    w.document.close()
    w.focus()
    window.setTimeout(() => w.print(), 250)
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      className="card-cute mt-6 p-4 sm:p-5"
      aria-label="복지 신청 로드맵"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sprout-100 text-sprout-700"><Route className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-extrabold leading-tight">복지 신청 로드맵</h2>
            <p className="text-xs text-muted-foreground">담은 복지를 <b>신청 순서</b>로 — 마감 임박부터 방문 신청까지 한눈에</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={copyPlan} className="chip bg-sprout-50 text-sprout-700 hover:bg-sprout-100" aria-label="계획 복사">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? '복사됨' : '복사'}
          </button>
          <button onClick={printPlan} className="chip bg-sprout-50 text-sprout-700 hover:bg-sprout-100" aria-label="계획 인쇄">
            <Printer className="h-3.5 w-3.5" /> 인쇄
          </button>
          <button
            onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? '접기' : '펼치기'}
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-sprout-50"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>

      {/* 요약 스트립 */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-sprout-50 px-2 py-2">
          <div className="text-sm font-extrabold text-sprout-700">{summary.totalMonthlyCash > 0 ? formatWon(summary.totalMonthlyCash) : '-'}</div>
          <div className="text-[11px] text-muted-foreground">월 최대 현금지원</div>
        </div>
        <div className="rounded-xl bg-peach-50 px-2 py-2">
          <div className="text-sm font-extrabold text-peach-800">{summary.stepCount}개</div>
          <div className="text-[11px] text-muted-foreground">신청 단계</div>
        </div>
        <div className="rounded-xl bg-sky2-50 px-2 py-2">
          <div className="text-sm font-extrabold text-sky2-700">{summary.docProgress.done}/{summary.docProgress.total}</div>
          <div className="text-[11px] text-muted-foreground">서류 준비</div>
        </div>
      </div>
      {summary.docProgress.total > 0 && (
        <div className="mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`서류 준비 ${pct}%`}>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-sprout-100">
            <div className="h-full rounded-full bg-sprout-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 space-y-4">
              {PHASE_ORDER.filter((ph) => roadmap.byPhase[ph].length > 0).map((ph) => (
                <div key={ph}>
                  <div className="flex items-center gap-1.5 text-sm font-bold">
                    <span aria-hidden>{PHASE_META[ph].emoji}</span>
                    <span>{PHASE_META[ph].title}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">· {PHASE_META[ph].hint}</span>
                  </div>
                  <ol className="mt-2 space-y-2">
                    {roadmap.byPhase[ph].map((s) => (
                      <StepRow key={s.policyId} step={s} onOpen={onOpen ? () => { const p = POLICY_MAP[s.policyId]; if (p) onOpen(p) } : undefined} />
                    ))}
                  </ol>
                </div>
              ))}

              {/* 서류 종합 — 한 번 떼면 여러 신청에 재사용 */}
              {summary.allDocs.length > 0 && (
                <div className="rounded-xl border border-sprout-100 bg-sprout-50/50 p-3">
                  <div className="text-xs font-bold text-sprout-800">필요 서류 종합 <span className="font-normal text-muted-foreground">· 한 번 발급하면 여러 신청에 재사용돼요</span></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {summary.allDocs.map((d) => (
                      <span key={d.name} className={cn('chip', d.done ? 'bg-sprout-100 text-sprout-700' : 'bg-white text-muted-foreground border border-sprout-200')}>
                        {d.done && <Check className="h-3 w-3" />}{d.name}{d.count > 1 && <span className="opacity-60">×{d.count}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function StepRow({ step, onOpen }: { step: RoadmapStep; onOpen?: () => void }) {
  return (
    <li className="rounded-xl border border-sprout-100 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sprout-500 text-xs font-extrabold text-white">{step.order}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              onClick={onOpen} disabled={!onOpen}
              className={cn('text-sm font-bold', onOpen ? 'hover:text-sprout-700 hover:underline' : 'cursor-default')}
            >
              {step.name}
            </button>
            <span className="chip bg-slate-100 text-slate-600 !px-2 !py-0.5 text-[11px]">{step.category}</span>
            {step.isCash && step.monthly > 0 && (
              <span className="text-xs font-bold text-sprout-700">월 {formatWon(step.monthly)}</span>
            )}
            {step.deadline && (
              <span className={cn('chip !px-2 !py-0.5 text-[11px]', step.deadline.urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>
                ⏰ {step.deadline.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{step.rationale}</p>

          {step.missingDocs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted-foreground">준비할 서류:</span>
              {step.missingDocs.map((d) => (
                <span key={d} className="chip bg-white text-muted-foreground border border-sprout-200 !px-2 !py-0.5 text-[11px]">{d}</span>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{CHANNEL_LABEL[step.channel]}{step.department && ` · ${step.department}`}</span>
            {step.applyUrl && (
              <a href={step.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-sprout-700 hover:underline">
                복지로에서 신청 <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {step.contact && !step.applyUrl && <span>문의 {step.contact}</span>}
          </div>
        </div>
      </div>
    </li>
  )
}
