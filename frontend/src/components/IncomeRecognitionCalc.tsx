import { useMemo, useState } from 'react'
import { Home, Wallet, Landmark, Car, Info, ChevronDown } from 'lucide-react'
import {
  computeRecognition, recognitionPercentile, judgeBenefits, parseAmount,
  BASIC_PROPERTY, REGION_LABEL, type RegionKind,
} from '@/lib/incomeRecognition'
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

export function IncomeRecognitionCalc({ initialSize = 1 }: { initialSize?: number }) {
  const [size, setSize] = useState(Math.max(1, Math.min(7, initialSize)))
  const [region, setRegion] = useState<RegionKind>('metro')
  const [f, setF] = useState(() => emptyFields('metro'))
  const [carExempt, setCarExempt] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const set = (k: keyof ReturnType<typeof emptyFields>) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const pickRegion = (r: RegionKind) => { setRegion(r); setF((s) => ({ ...s, basicProperty: String(BASIC_PROPERTY[r]) })) }

  const result = useMemo(() => computeRecognition(
    { earned: parseAmount(f.earned), other: parseAmount(f.other), careExpense: parseAmount(f.careExpense) },
    { residential: parseAmount(f.residential), general: parseAmount(f.general), financial: parseAmount(f.financial), car: parseAmount(f.car) },
    { basicProperty: parseAmount(f.basicProperty), debt: parseAmount(f.debt), carExempt },
  ), [f, carExempt])

  const pct = recognitionPercentile(result.total, size)
  const benefits = judgeBenefits(result.total, size)
  const hasInput = result.total > 0

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

      <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        환산율(주거 1.04·일반 4.17·금융 6.26%/월)은 공식값이에요. 기본재산액은 지역·연도별 고시값이라 프리셋이며 실제와 다를 수 있어요.
        이 계산은 이해를 돕는 <b>추정</b>이고, 실제 소득인정액·수급 여부는 주민센터 심사로 확정돼요.
      </p>
    </div>
  )
}
