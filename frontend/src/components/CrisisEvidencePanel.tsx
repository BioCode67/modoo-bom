import { useMemo } from 'react'
import { FileCheck2, CheckCircle2 } from 'lucide-react'
import { crisisEvidence, type EvidenceEffort } from '@/lib/crisisEvidence'

/**
 * 위기 사유 입증 서류 도우미 — 선택한 위기(들)를 무엇으로·어디서 입증하는지 정리한다.
 * 순수 로직(crisisEvidence)이 위기별 서류·발급처·난이도·발급완료 대조를 계산하고 여기선 표시만.
 * '선지원 후심사'가 원칙이라 서류가 없어도 신고부터 하도록 골든타임(deferNote)을 맨 앞에 둔다.
 */

const EFFORT_CLS: Record<EvidenceEffort, string> = {
  바로발급: 'bg-sprout-50 text-sprout-700',
  요청필요: 'bg-amber-50 text-amber-700',
}

export function CrisisEvidencePanel({ crisisKeys, issuedDocs = [] }: { crisisKeys: string[]; issuedDocs?: string[] }) {
  const plan = useMemo(() => crisisEvidence(crisisKeys, { issuedDocs }), [crisisKeys, issuedDocs])
  if (crisisKeys.length === 0) return null

  return (
    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
      <p className="flex items-center gap-1.5 text-sm font-extrabold text-rose-700">
        <FileCheck2 className="h-4 w-4" /> 위기 입증 서류 준비
      </p>
      {/* 골든타임 우선 — 서류보다 신고가 먼저 */}
      <p className="mt-1.5 rounded-xl bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-rose-800">{plan.deferNote}</p>

      {plan.groups.map((g) => (
        <div key={g.crisis.key} className="mt-3">
          <p className="text-xs font-bold text-foreground/80">{g.crisis.label}</p>
          <ul className="mt-1 space-y-1.5">
            {g.docs.map((d) => (
              <li key={d.name} className="rounded-xl bg-white/70 px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {d.issuedAlready
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sprout-600" aria-label="발급 완료" />
                    : <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-sky2-300" aria-hidden />}
                  <span className={`text-xs font-semibold ${d.issuedAlready ? 'text-muted-foreground line-through' : 'text-foreground/85'}`}>{d.name}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{d.source}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${EFFORT_CLS[d.effort]}`}>{d.effort}</span>
                  {d.deferrable && <span className="rounded-full bg-sky2-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky2-700">나중 제출 가능</span>}
                </div>
                <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{d.proves}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
