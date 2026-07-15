import { useState } from 'react'
import { Calculator, Check, X, ArrowRight } from 'lucide-react'
import { medianIncome, incomePercentile, benefitCutoffs, livelihoodPayment, isApprox, MEDIAN_YEAR, won } from '@/lib/medianIncome'
import { cn } from '@/lib/utils'

/**
 * 기초생활보장 급여 계산기 — 가구원수 + 월 소득으로 '기준 중위소득 %'와
 * 생계·의료·주거·교육급여의 **가구별 월 소득 상한(원)**·자격을 즉시 보여준다.
 * 대부분의 복지가 이 기준을 쓰는데 사용자는 자기 %도, 급여별 상한 금액도 모르므로 진입장벽이 가장 큰 지점.
 * onApply: 계산된 %를 프로필에 반영(위저드). onPickBenefit: 해당 급여를 탐색에서 바로 찾기(탐색 페이지).
 */

// 게이지 구간(기준 중위소득 0→100%) — 급여 경계 시각화(따뜻→차가운 색)
const ZONES: { to: number; cls: string }[] = [
  { to: 32, cls: 'bg-rose-300' },
  { to: 40, cls: 'bg-peach-300' },
  { to: 48, cls: 'bg-amber-300' },
  { to: 50, cls: 'bg-success-300' },
  { to: 100, cls: 'bg-sky2-100' },
]

export function IncomeCalculator({
  onApply,
  onPickBenefit,
}: {
  onApply?: (pct: number) => void
  onPickBenefit?: (label: string) => void
}) {
  const [size, setSize] = useState(1)
  const [income, setIncome] = useState<string>('')

  const monthly = parseInt(income.replace(/[^0-9]/g, ''), 10) || 0
  const median = medianIncome(size)
  const pct = monthly > 0 ? incomePercentile(size, monthly) : null
  const cutoffs = benefitCutoffs(size, monthly || undefined)
  const qualified = cutoffs.filter((b) => b.ok)
  const livelihood = monthly > 0 ? livelihoodPayment(size, monthly) : 0 // 예상 생계급여(실수령 근사)

  return (
    <div className="rounded-2xl border-2 border-sky2-100 bg-sky2-50/40 p-4">
      <p className="text-sm font-bold flex items-center gap-1.5"><Calculator className="h-4 w-4 text-sky2-700" /> 기초생활보장 급여 계산기</p>
      <p className="text-xs text-muted-foreground mt-0.5">가구원 수와 월 소득으로 생계·의료·주거·교육급여 자격을 바로 확인해요. ({MEDIAN_YEAR}년 기준 중위소득)</p>

      {/* 가구원 수 */}
      <div className="mt-3">
        <label className="block text-xs font-bold mb-1">가구원 수</label>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button key={n} onClick={() => setSize(n)}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors', (n === 7 ? size >= 7 : size === n) ? 'bg-sky2-700 border-sky2-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sky2-200')}>
              {n}{n === 7 ? '+' : ''}
            </button>
          ))}
        </div>
        {/* 8인 이상은 '7'로 고정돼 소득기준이 과소산정(실제보다 낮게)되던 문제 — 실제 가구원 수를 지정하게
            스테퍼 제공. medianIncome이 1인당 공식 가산액으로 추정하고 아래 문구에 '(추정)'을 명시한다(감사 Finding P4). */}
        {size >= 7 && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">가구원이 더 많으면</span>
            <div className="inline-flex items-center rounded-lg border border-sky2-200 bg-white">
              <button type="button" onClick={() => setSize((s) => Math.max(7, s - 1))} disabled={size <= 7}
                aria-label="가구원 수 줄이기" className="px-2.5 py-1 text-sky2-700 font-bold disabled:opacity-40">−</button>
              <span className="px-2 text-sm font-bold tabular-nums" aria-live="polite">{size}인</span>
              <button type="button" onClick={() => setSize((s) => Math.min(12, s + 1))} disabled={size >= 12}
                aria-label="가구원 수 늘리기" className="px-2.5 py-1 text-sky2-700 font-bold disabled:opacity-40">+</button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-1">{size}인 가구 기준 중위소득 100% = <b>{won(median)}</b>{isApprox(size) ? ' (추정 · 8인 이상 1인당 95만원 가산)' : ''}</p>
      </div>

      {/* 월 소득 */}
      <div className="mt-2">
        <label className="block text-xs font-bold mb-1">월 소득 (대략, 세전)</label>
        <div className="relative">
          <input
            value={income} onChange={(e) => setIncome(e.target.value)} inputMode="numeric"
            placeholder="예: 1500000" className="input-cute !py-2 pr-8" aria-label="월 소득"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
        </div>
      </div>

      {/* 게이지 — 소득 입력 시 내 위치 표시 */}
      {pct != null && (
        <div className="mt-4">
          <div className="relative h-3 rounded-full overflow-hidden flex">
            {ZONES.map((z, i) => {
              const from = i === 0 ? 0 : ZONES[i - 1].to
              return <div key={z.to} className={z.cls} style={{ width: `${z.to - from}%` }} />
            })}
            {/* 내 위치 마커 */}
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-foreground shadow"
              style={{ left: `${Math.min(pct, 100)}%` }} aria-hidden />
          </div>
          {/* 경계 눈금 — 48·50은 근접해 겹치므로 생계32·의료40·주거48만 표기 */}
          <div className="relative h-4 mt-0.5 text-[9px] text-muted-foreground">
            {[32, 40, 48].map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${t}%` }}>{t}%</span>
            ))}
          </div>
          <p className="text-sm text-center mt-0.5">내 소득은 기준 중위소득의 <b className="text-sky2-700 text-base">{pct}%</b></p>
        </div>
      )}

      {/* 예상 생계급여 실수령액 — "그래서 얼마 받나"를 구체 금액으로 */}
      {livelihood > 0 && (
        <div className="mt-3 rounded-xl bg-success-700 text-white px-4 py-3 text-center shadow-soft">
          <p className="text-xs font-semibold text-white">예상 생계급여 (매월 받을 수 있어요)</p>
          <p className="text-2xl font-extrabold mt-0.5">약 {won(livelihood)}</p>
          <p className="text-[10px] text-white mt-1">= {size}인 생계급여 기준액 − 내 소득 · 실제 소득인정액(재산 환산 포함)에 따라 달라져요</p>
        </div>
      )}

      {/* 급여별 소득 상한 — 항상 표시(교육 목적: 우리 가구는 월 얼마 이하면 받는지) */}
      <div className="mt-3 rounded-xl bg-white border border-sky2-100 p-3">
        <p className="text-xs font-semibold text-muted-foreground">{size}인 가구 급여별 월 소득 상한</p>
        <ul className="mt-1.5 space-y-1">
          {cutoffs.map((b) => (
            <li key={b.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1">
                <span>{b.emoji} {b.label}</span>
                <span className="text-[10px] text-muted-foreground">중위 {b.pct}%</span>
              </span>
              <span className="flex items-center gap-1.5">
                <b className={cn(b.ok === true && 'text-success-600', b.ok === false && 'text-muted-foreground/60')}>≤ {won(b.cutoff)}</b>
                {b.ok === true && <Check className="h-4 w-4 text-success-600" />}
                {b.ok === false && <X className="h-3.5 w-3.5 text-muted-foreground/50" />}
              </span>
            </li>
          ))}
        </ul>

        {pct != null && (
          qualified.length > 0 ? (
            <div className="mt-2.5 rounded-lg bg-success-50 px-2.5 py-2">
              <p className="text-xs font-semibold text-success-700">✓ {qualified.map((b) => b.label).join(', ')} 신청 대상이에요!</p>
              {onPickBenefit && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {qualified.map((b) => (
                    <button key={b.key} onClick={() => onPickBenefit(b.label)}
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky2-700 bg-sky2-50 hover:bg-sky2-100 rounded-full px-2 py-0.5 transition-colors">
                      {b.label} 보기 <ArrowRight className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">기초생활보장 급여 기준(중위 50% 이하)보다는 높아요. 그래도 받을 수 있는 다른 복지가 많아요!</p>
          )
        )}
      </div>

      {onApply && pct != null && (
        <button onClick={() => onApply(Math.min(pct, 200))} className="btn-primary !py-2 mt-3 text-xs w-full">
          <Check className="h-4 w-4" /> 이 소득({pct}%)으로 분석에 반영
        </button>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        ※ 실제 ‘소득인정액’은 집·예금 등 재산 환산이 포함돼 달라질 수 있어요. 재산까지 반영한 정확한 계산은{' '}
        <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="font-semibold text-sky2-700 hover:underline">복지로 모의계산</a>{' '}
        또는 주민센터에서 확인하세요.
      </p>
    </div>
  )
}
