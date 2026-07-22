import { useState } from 'react'
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, Lightbulb } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { UserProfile } from '@/lib/welfare-engine'
import { explainEligibility, blockerHint, type GateStatus } from '@/lib/explainEligibility'
import { cn } from '@/lib/utils'

const GATE_ICON: Record<GateStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-sprout-600" />,
  fail: <XCircle className="h-4 w-4 shrink-0 text-rose-500" />,
  info: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />,
}
const GATE_TEXT: Record<GateStatus, string> = {
  pass: 'text-sprout-800', fail: 'text-rose-700', info: 'text-muted-foreground',
}

/**
 * 자격 판정 근거 설명 — 엔진이 왜 이 판정을 내렸는지 조건별 통과/탈락으로 보여준다.
 * checkPolicy 결과를 그대로 존중하며(단일 진실원), 근거만 풀어 설명한다(설명 가능성=신뢰).
 * 프로필이 없거나 요약/심사형(정밀 룰 미적용) 정책이면 렌더하지 않는다(모순·과장 방지).
 */
export function EligibilityExplainer({ policy, profile }: { policy: Policy; profile: UserProfile | null }) {
  const ex = profile ? explainEligibility(policy, profile) : null
  // 부적격이거나 소득만 아까운 경우 기본으로 펼침(사용자가 가장 궁금한 지점), 적격이면 접어둠
  const [open, setOpen] = useState(() => !!ex && (!ex.eligible || ex.fixableByIncome))

  if (!ex || ex.mode !== 'precise') return null
  const hint = blockerHint(ex)

  return (
    <div className={cn('rounded-2xl border p-3.5', ex.eligible ? 'border-sprout-100 bg-white' : 'border-rose-100 bg-rose-50/40')}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center gap-2 text-left">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', ex.eligible ? 'bg-sprout-100 text-sprout-700' : 'bg-rose-100 text-rose-600')}>
          {ex.eligible ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold">{ex.eligible ? '자격 요건을 충족해요' : '지금은 대상이 아니에요'}</span>
          <span className="block text-[11px] text-muted-foreground">조건별 판정 근거 보기</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-3">
          <ul className="flex flex-col gap-1.5">
            {ex.gates.map((g) => (
              <li key={g.key} className="flex items-start gap-1.5 text-sm">
                {GATE_ICON[g.status]}
                <span className={cn('leading-snug', GATE_TEXT[g.status])}>
                  <b className="font-semibold">{g.label}</b> · {g.detail}
                </span>
              </li>
            ))}
          </ul>

          {hint && (
            <p className={cn('mt-2.5 flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-relaxed',
              ex.fixableByIncome ? 'bg-amber-50 text-amber-800' : 'bg-white/70 text-muted-foreground')}>
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {hint}
            </p>
          )}

          <p className="mt-2 text-[10px] text-muted-foreground">※ 판정은 입력한 프로필 기준 추정이에요. 실제 자격·지급액은 신청 기관의 행정 심사로 확정돼요.</p>
        </div>
      )}
    </div>
  )
}
