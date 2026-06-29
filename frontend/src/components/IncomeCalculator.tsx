import { useState } from 'react'
import { Calculator, Check } from 'lucide-react'
import { medianIncome, incomePercentile, qualifyingBenefits, isApprox, MEDIAN_YEAR, won } from '@/lib/medianIncome'
import { cn } from '@/lib/utils'

/**
 * 중위소득 계산기 — 가구원수 + 월 소득으로 '기준 중위소득 %'를 즉시 계산.
 * 대부분의 복지가 이 %를 기준으로 하는데 사용자는 자기 %를 모르므로, 진입장벽을 크게 낮춘다.
 * onApply 제공 시 계산된 %를 프로필에 적용.
 */
export function IncomeCalculator({ onApply }: { onApply?: (pct: number) => void }) {
  const [size, setSize] = useState(1)
  const [income, setIncome] = useState<string>('')

  const monthly = parseInt(income.replace(/[^0-9]/g, ''), 10) || 0
  const median = medianIncome(size)
  const pct = monthly > 0 ? incomePercentile(size, monthly) : null
  const benefits = pct != null ? qualifyingBenefits(pct) : []

  return (
    <div className="rounded-2xl border-2 border-sky2-100 bg-sky2-50/40 p-4">
      <p className="text-sm font-bold flex items-center gap-1.5"><Calculator className="h-4 w-4 text-sky2-600" /> 중위소득 계산기</p>
      <p className="text-xs text-muted-foreground mt-0.5">가구원 수와 월 소득을 넣으면 기준 중위소득 대비 %를 알려드려요. ({MEDIAN_YEAR}년 기준)</p>

      <div className="mt-3 space-y-2">
        <div>
          <label className="block text-xs font-bold mb-1">가구원 수</label>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} onClick={() => setSize(n)}
                className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors', size === n ? 'bg-sky2-500 border-sky2-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sky2-200')}>
                {n}{n === 7 ? '+' : ''}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{size}인 가구 기준 중위소득 100% = <b>{won(median)}</b>{isApprox(size) ? ' (추정)' : ''}</p>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1">월 소득 (대략, 세전)</label>
          <div className="relative">
            <input
              value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric"
              placeholder="예: 1500000" className="input-cute !py-2 pr-8" aria-label="월 소득"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
          </div>
        </div>
      </div>

      {pct != null && (
        <div className="mt-3 rounded-xl bg-white border border-sky2-100 p-3">
          <p className="text-sm">기준 중위소득의 <b className="text-sky2-600 text-base">{pct}%</b> 수준이에요.</p>
          {benefits.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-semibold text-muted-foreground">받을 수 있는 기초생활보장 급여</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {benefits.map((b) => <span key={b.key} className="chip-sprout">{b.emoji} {b.label} (≤{b.pct}%)</span>)}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">기초생활보장 급여 기준(≤50%)보다는 높아요. 그래도 받을 수 있는 다른 복지가 많아요!</p>
          )}
          {onApply && (
            <button onClick={() => onApply(Math.min(pct, 200))} className="btn-primary !py-2 mt-3 text-xs w-full">
              <Check className="h-4 w-4" /> 이 소득({pct}%)으로 분석에 반영
            </button>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">※ 실제 ‘소득인정액’은 재산·부채 환산이 포함돼 다를 수 있어요. 정확한 판정은 주민센터·복지로에서 확인하세요.</p>
        </div>
      )}
    </div>
  )
}
