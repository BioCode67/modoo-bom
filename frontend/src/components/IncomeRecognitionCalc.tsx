import { useMemo, useState } from 'react'
import { Home, Wallet, Landmark, Car, Info, ChevronDown, TrendingUp, Check } from 'lucide-react'
import {
  computeRecognition, recognitionPercentile, judgeBenefits, parseAmount,
  BASIC_PROPERTY, REGION_LABEL, type RegionKind,
} from '@/lib/incomeRecognition'
import { benefitCeilings, nearestCeiling } from '@/lib/benefitCeiling'
import { diffScenarios } from '@/lib/scenarioDiff'
import { medianIncome, isApprox, MEDIAN_YEAR, won } from '@/lib/medianIncome'
import { cn } from '@/lib/utils'

/**
 * 소득인정액 계산기(정밀) — 재산 환산까지 넣어 '실제 심사 기준'을 앱 안에서 계산한다.
 * IncomeCalculator 가 링크로 넘기던 "재산 반영 정확한 계산"을 여기서 구현.
 * 순수 로직(lib/incomeRecognition.ts)이 공식을 계산하고 여기선 입력·표시만 담당.
 */

/** 콤마 표시 + 숫자만 저장하는 금액 입력 */
function MoneyField({ label, value, onChange, icon, hint }: {
  label: string; value: string; onChange: (v: string) => void; icon?: React.ReactNode; hint?: string
}) {
  const shown = value ? Number(value).toLocaleString('ko-KR') : ''
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">{icon}{label}</span>
      <span className="relative mt-0.5 block">
        <input
          inputMode="numeric" value={shown} placeholder="0"
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
          aria-label={label}
          className="w-full rounded-lg border border-sprout-100 bg-white px-2.5 py-1.5 pr-7 text-right text-sm tabular-nums focus:border-sprout-300 focus:outline-none"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
      </span>
      {hint && <span className="mt-0.5 block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

const emptyFields = (region: RegionKind) => ({
  earned: '', other: '', careExpense: '',
  residential: '', general: '', financial: '', car: '',
  basicProperty: String(BASIC_PROPERTY[region]), debt: '',
})

export function IncomeRecognitionCalc({ initialSize = 1, onApply }: { initialSize?: number; onApply?: (pct: number) => void }) {
  const [size, setSize] = useState(Math.max(1, Math.min(7, initialSize)))
  const [region, setRegion] = useState<RegionKind>('metro')
  const [f, setF] = useState(() => emptyFields('metro'))
  const [carExempt, setCarExempt] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [snapshot, setSnapshot] = useState<{ total: number; size: number } | null>(null)

  const set = (k: keyof ReturnType<typeof emptyFields>) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const pickRegion = (r: RegionKind) => { setRegion(r); setF((s) => ({ ...s, basicProperty: String(BASIC_PROPERTY[r]) })) }

  // 입력을 구조화(정계산·역산이 같은 값을 공유) — 재렌더마다 한 번만 파싱
  const income = useMemo(() => ({ earned: parseAmount(f.earned), other: parseAmount(f.other), careExpense: parseAmount(f.careExpense) }), [f.earned, f.other, f.careExpense])
  const property = useMemo(() => ({ residential: parseAmount(f.residential), general: parseAmount(f.general), financial: parseAmount(f.financial), car: parseAmount(f.car) }), [f.residential, f.general, f.financial, f.car])
  const opts = useMemo(() => ({ basicProperty: parseAmount(f.basicProperty), debt: parseAmount(f.debt), carExempt }), [f.basicProperty, f.debt, carExempt])

  const result = useMemo(() => computeRecognition(income, property, opts), [income, property, opts])
  const ceilings = useMemo(
    () => benefitCeilings({ size, currentTotal: result.total, property, opts, other: income.other, careExpense: income.careExpense }),
    [size, result.total, property, opts, income.other, income.careExpense],
  )

  const pct = recognitionPercentile(result.total, size)
  const benefits = judgeBenefits(result.total, size)
  const hasInput = result.total > 0
  const near = nearestCeiling(ceilings)
  const diff = snapshot ? diffScenarios(snapshot, { total: result.total, size }) : null

  return (
    <div className="mt-3 rounded-2xl border border-sky2-100 bg-sky2-50/40 p-3.5">
      <p className="text-sm font-extrabold text-foreground">🏠 소득인정액 정밀 계산 <span className="text-[11px] font-normal text-muted-foreground">(재산 환산 포함)</span></p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">기초생활보장·기초연금 등은 소득이 아니라 <b>소득인정액</b>(소득평가액＋재산의 소득환산액)으로 심사해요.</p>

      {/* 가구원수 + 지역 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-bold text-muted-foreground">가구원수</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button key={n} onClick={() => setSize(n)} aria-pressed={size === n}
              className={cn('h-7 w-7 rounded-lg text-xs font-bold border', size === n ? 'bg-sky2-600 border-sky2-600 text-white' : 'bg-white border-sprout-100')}>
              {n}{n === 7 ? '+' : ''}
            </button>
          ))}
        </div>
        <span className="ml-1 text-xs font-bold text-muted-foreground">지역</span>
        <div className="flex gap-1">
          {(['metro', 'city', 'rural'] as RegionKind[]).map((r) => (
            <button key={r} onClick={() => pickRegion(r)} aria-pressed={region === r}
              className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold border', region === r ? 'bg-sky2-600 border-sky2-600 text-white' : 'bg-white border-sprout-100')}>
              {REGION_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {/* 소득 */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <MoneyField label="근로·사업소득/월" value={f.earned} onChange={set('earned')} icon={<Wallet className="h-3 w-3" />} hint="30% 공제 후 반영" />
        <MoneyField label="그 밖의 소득/월" value={f.other} onChange={set('other')} hint="연금·이전소득 등" />
      </div>

      {/* 재산 */}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <MoneyField label="주거용 재산" value={f.residential} onChange={set('residential')} icon={<Home className="h-3 w-3" />} />
        <MoneyField label="일반 재산" value={f.general} onChange={set('general')} hint="주거 외 부동산·보증금" />
        <MoneyField label="금융 재산" value={f.financial} onChange={set('financial')} icon={<Landmark className="h-3 w-3" />} hint="예금·적금·보험" />
        <MoneyField label="자동차 가액" value={f.car} onChange={set('car')} icon={<Car className="h-3 w-3" />} />
      </div>
      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={carExempt} onChange={(e) => setCarExempt(e.target.checked)} className="rounded border-sprout-200" />
        생업용·장애인용 등 <b>환산 제외</b> 차량
      </label>

      {/* 공제(고급) */}
      <button onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced} className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-sky2-700">
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')} /> 공제 항목(기본재산액·부채·지출)
      </button>
      {showAdvanced && (
        <div className="mt-1.5 grid grid-cols-2 gap-2.5">
          <MoneyField label="기본재산액(공제)" value={f.basicProperty} onChange={set('basicProperty')} hint={`${REGION_LABEL[region]} 프리셋 · 고시값 확인`} />
          <MoneyField label="부채" value={f.debt} onChange={set('debt')} hint="재산에서 차감" />
          <MoneyField label="가구특성 지출/월" value={f.careExpense} onChange={set('careExpense')} hint="의료·양육 등 인정 지출" />
        </div>
      )}

      {/* 결과 */}
      <div className="mt-3 rounded-xl bg-white border border-sky2-100 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">소득평가액</span>
          <span className="font-bold tabular-nums">{won(result.incomeEval)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">＋ 재산의 소득환산액</span>
          <span className="font-bold tabular-nums">{won(result.propertyConversion)}</span>
        </div>
        {hasInput && (result.byType.residential + result.byType.general + result.byType.financial + result.byType.car) > 0 && (
          <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
            {result.byType.residential > 0 && `주거 ${won(result.byType.residential)} `}
            {result.byType.general > 0 && `· 일반 ${won(result.byType.general)} `}
            {result.byType.financial > 0 && `· 금융 ${won(result.byType.financial)} `}
            {result.byType.car > 0 && `· 차 ${won(result.byType.car)}`}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-sky2-100 pt-2">
          <span className="text-sm font-extrabold">＝ 소득인정액</span>
          <span className="text-lg font-extrabold text-sky2-700 tabular-nums">{won(result.total)}</span>
        </div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {size}인 기준 중위소득의 약 <b className="text-foreground">{pct}%</b> {isApprox(size) && '(근사)'}
          <span className="ml-1 opacity-70">· 중위 {won(medianIncome(size))} ({MEDIAN_YEAR})</span>
        </p>

        {hasInput && (
          benefits.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[11px] font-bold text-muted-foreground self-center">해당 가능:</span>
              {benefits.map((b) => (
                <span key={b.key} className="chip bg-success-100 text-success-700 text-xs">{b.emoji} {b.label} <span className="opacity-60">≤{b.pct}%</span></span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">기초생활보장 급여 기준(중위 50% 이하)보다 높아요. 그래도 받을 수 있는 다른 복지가 많아요.</p>
          )
        )}
      </div>

      {/* 정밀 계산한 소득인정액(%)을 실제 분석 프로필에 반영 — 간이 % 대신 재산까지 반영한 값으로 */}
      {onApply && hasInput && (
        <button onClick={() => onApply(Math.min(pct, 200))} className="btn-primary !py-2 mt-2 w-full text-xs">
          <Check className="h-4 w-4" /> 이 소득인정액(약 {pct}%)을 분석에 반영
        </button>
      )}

      {/* 역산 — 얼마까지 벌어도 자격이 되나(급여별 근로소득 상한) */}
      <div className="mt-3 rounded-xl bg-white border border-sky2-100 p-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-foreground"><TrendingUp className="h-4 w-4 text-sky2-600" /> 얼마까지 벌어도 되나</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">지금 재산 그대로일 때, 급여별로 <b>근로·사업소득</b>이 월 얼마 이하여야 자격이 유지되는지예요.</p>
        <ul className="mt-2 space-y-1">
          {ceilings.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', c.eligibleNow ? 'bg-success-500' : 'bg-rose-300')} />
                <span className="font-semibold">{c.emoji} {c.label}</span>
                <span className="text-[10px] text-muted-foreground">≤{c.pct}%</span>
              </span>
              {c.maxEarned === null ? (
                <span className="font-bold text-rose-600">재산만으로 초과</span>
              ) : (
                <span className="tabular-nums font-bold text-sky2-700">월 {won(c.maxEarned)} 이하</span>
              )}
            </li>
          ))}
        </ul>
        {near && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
            💡 지금은 <b>{near.emoji} {near.label}</b> 기준까지 소득인정액 여유가 <b>{won(Math.max(0, near.headroom))}</b>이에요. 이보다 더 늘면 이 급여 경계를 넘어요.
          </p>
        )}
      </div>

      {/* 시나리오 비교 — '지금'과 '바뀐 뒤'의 자격 급여 득실(복지 절벽 확인) */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSnapshot({ total: result.total, size })}
          className="inline-flex items-center gap-1 rounded-lg border border-sky2-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky2-700 hover:border-sky2-200"
        >
          📌 지금 상태로 비교 시작
        </button>
        {snapshot && (
          <button onClick={() => setSnapshot(null)} className="text-[11px] font-semibold text-muted-foreground hover:underline">비교 지우기</button>
        )}
      </div>
      {diff && (
        <div className="mt-2 rounded-xl border border-sky2-100 bg-sky2-50/40 p-2.5 text-xs">
          <p className="font-bold text-foreground">
            소득인정액 {diff.totalDelta === 0 ? '동일' : diff.totalDelta > 0 ? `+${won(diff.totalDelta)} 증가` : `${won(Math.abs(diff.totalDelta))} 감소`}
          </p>
          {diff.unchanged ? (
            <p className="mt-1 text-muted-foreground">자격 급여 변화는 없어요.</p>
          ) : (
            <div className="mt-1.5 flex flex-col gap-1">
              {diff.lost.length > 0 && (
                <p className="text-rose-700">− 잃음: {diff.lost.map((x) => `${x.emoji} ${x.label}`).join(' · ')}</p>
              )}
              {diff.gained.length > 0 && (
                <p className="text-sprout-700">+ 열림: {diff.gained.map((x) => `${x.emoji} ${x.label}`).join(' · ')}</p>
              )}
            </div>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">저장한 시점 대비 지금 입력값 기준 변화예요. 소득·재산을 바꿔 이직·이사 등을 시뮬레이션해 보세요.</p>
        </div>
      )}

      <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        환산율(주거 1.04·일반 4.17·금융 6.26%/월)은 공식값이에요. 기본재산액은 지역·연도별 고시값이라 프리셋이며 실제와 다를 수 있어요.
        이 계산은 이해를 돕는 <b>추정</b>이고, 실제 소득인정액·수급 여부는 주민센터 심사로 확정돼요.
      </p>
    </div>
  )
}
