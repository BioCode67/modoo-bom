import { medianIncome, qualifyingBenefits } from '@/lib/medianIncome'

/**
 * 소득인정액 계산 — 기초생활보장·기초연금 등 '자산조사형' 복지의 실제 심사 기준.
 *
 *   소득인정액 = 소득평가액 + 재산의 소득환산액
 *   · 소득평가액 = 실제소득 − 근로소득공제(30%) − 가구특성 지출
 *   · 재산의 소득환산액 = (재산 − 기본재산액 − 부채) × 소득환산율(월)
 *
 * 기존 IncomeCalculator 는 '월 소득 → 중위 대비 %'만 봐서 재산 환산을 못 넣고
 * "정확한 계산은 복지로/주민센터에서"라고 링크로 넘겼다. 여기서 그 공식을 앱 안에 구현한다.
 *
 * 정직성(중요):
 *  · 소득환산율(주거 1.04 / 일반 4.17 / 금융 6.26 / 자동차 100%, 월)은 오래 고정된 공식값.
 *  · 기본재산액은 지역별 고시값이라 '프리셋(수정 가능)'으로 두고, 연도 확인을 안내한다.
 *  · 결과는 '이해를 돕는 추정'이며 실제 수급 여부는 주민센터 심사로 확정(과장 금지).
 * 전부 브라우저 안에서 계산되고 서버로 가지 않는다.
 */

/** 재산 종류별 월 소득환산율(고정 공식값) */
export const CONVERSION_RATE = {
  residential: 0.0104, // 주거용재산 1.04%/월
  general: 0.0417,     // 일반재산(주거용 외) 4.17%/월
  financial: 0.0626,   // 금융재산 6.26%/월
  car: 1.0,            // 자동차 100%/월 (원칙 — 생업용·장애인 차량 등은 예외)
} as const

/** 근로·사업소득 공제율(일반) — 실제소득의 30%를 빼고 평가 */
export const EARNED_DEDUCTION_RATE = 0.3

export type RegionKind = 'metro' | 'city' | 'rural'

export const REGION_LABEL: Record<RegionKind, string> = {
  metro: '대도시', city: '중소도시', rural: '농어촌',
}

/**
 * 기본재산액(원) — 생계·주거·교육급여 기준, 지역별. 2026 프리셋(고시값·연도 확인 권장).
 * 재산에서 먼저 빼주는 '기본 공제'. 사용자가 값을 수정할 수 있게 프리셋으로만 제공한다.
 */
export const BASIC_PROPERTY: Record<RegionKind, number> = {
  metro: 99_000_000,  // 대도시 9,900만원
  city: 80_000_000,   // 중소도시 8,000만원
  rural: 53_500_000,  // 농어촌 5,350만원
}

export interface IncomeInput {
  earned: number    // 근로·사업소득(월) — 30% 공제 대상
  other: number     // 그 밖의 소득(월) — 재산·이전·연금 등, 공제 없음
  careExpense: number // 가구특성별 지출(월) — 장애·의료·양육 등 인정 지출(있으면 차감)
}

export interface PropertyInput {
  residential: number // 주거용재산
  general: number     // 일반재산(주거용 외 부동산·보증금 등)
  financial: number   // 금융재산(예금·적금·보험 등)
  car: number         // 자동차 가액
}

export interface RecognitionOptions {
  basicProperty: number // 기본재산액(공제)
  debt: number          // 부채(공제)
  carExempt: boolean    // 자동차 환산 제외(예외 차량)
}

export interface RecognitionResult {
  incomeEval: number       // 소득평가액(월)
  propertyConversion: number // 재산의 소득환산액(월)
  total: number            // 소득인정액(월)
  byType: { residential: number; general: number; financial: number; car: number } // 종류별 환산액
  afterDeduction: { residential: number; general: number; financial: number } // 공제 후 재산가액
}

const clampNum = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0)

/** 문자열 입력('1,200,000' 등)을 숫자로 — 콤마·공백·'만원' 방어 */
export function parseAmount(raw: string | number): number {
  if (typeof raw === 'number') return clampNum(raw)
  const digits = (raw || '').replace(/[^\d]/g, '')
  return digits ? clampNum(parseInt(digits, 10)) : 0
}

/** 소득평가액 = (근로·사업소득 × 70%) + 그 밖의 소득 − 가구특성 지출, 하한 0 */
export function incomeEvaluation(income: IncomeInput): number {
  const earned = clampNum(income.earned) * (1 - EARNED_DEDUCTION_RATE)
  const other = clampNum(income.other)
  const care = clampNum(income.careExpense)
  return Math.max(0, Math.round(earned + other - care))
}

/**
 * 공제액을 [주거용, 일반, 금융] 순서로 차례로 차감(각 0 하한).
 * 기본재산액·부채가 모두 이 순서로 적용된다(공식 산정 순서).
 */
function cascadeDeduct(buckets: [number, number, number], amount: number): [number, number, number] {
  let remain = clampNum(amount)
  const out = buckets.map((b) => {
    const take = Math.min(b, remain)
    remain -= take
    return b - take
  }) as [number, number, number]
  return out
}

/** 재산의 소득환산액(월) — 기본재산액·부채 공제 후 종류별 환산율 적용, 자동차는 별도 */
export function propertyConversion(property: PropertyInput, opts: RecognitionOptions): RecognitionResult['byType'] & { total: number; afterDeduction: RecognitionResult['afterDeduction'] } {
  const res0 = clampNum(property.residential)
  const gen0 = clampNum(property.general)
  const fin0 = clampNum(property.financial)
  const car = clampNum(property.car)

  // 기본재산액 → 부채 순으로 [주거·일반·금융]에서 차감
  const afterBasic = cascadeDeduct([res0, gen0, fin0], opts.basicProperty)
  const [res, gen, fin] = cascadeDeduct(afterBasic, opts.debt)

  const cRes = Math.round(res * CONVERSION_RATE.residential)
  const cGen = Math.round(gen * CONVERSION_RATE.general)
  const cFin = Math.round(fin * CONVERSION_RATE.financial)
  const cCar = opts.carExempt ? 0 : Math.round(car * CONVERSION_RATE.car)

  return {
    residential: cRes, general: cGen, financial: cFin, car: cCar,
    total: cRes + cGen + cFin + cCar,
    afterDeduction: { residential: res, general: gen, financial: fin },
  }
}

/** 소득인정액 종합 계산 */
export function computeRecognition(income: IncomeInput, property: PropertyInput, opts: RecognitionOptions): RecognitionResult {
  const incomeEval = incomeEvaluation(income)
  const pc = propertyConversion(property, opts)
  return {
    incomeEval,
    propertyConversion: pc.total,
    total: incomeEval + pc.total,
    byType: { residential: pc.residential, general: pc.general, financial: pc.financial, car: pc.car },
    afterDeduction: pc.afterDeduction,
  }
}

/** 소득인정액(월) → 기준 중위소득 대비 % (가구원수 기준) */
export function recognitionPercentile(total: number, size: number): number {
  const m = medianIncome(size)
  if (m <= 0) return 0
  return Math.round((total / m) * 100)
}

/** 소득인정액으로 판정되는 급여(기준 이하) — medianIncome.qualifyingBenefits 재사용 */
export function judgeBenefits(total: number, size: number) {
  return qualifyingBenefits(recognitionPercentile(total, size))
}
