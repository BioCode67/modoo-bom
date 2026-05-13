import type { UserProfile } from '@/types'

export interface QuickBenefit {
  name: string
  amount: number
  unit: '월' | '일시금'
  category: string
  color: string
  bg: string
}

export function quickEstimate(p: Partial<UserProfile>): QuickBenefit[] {
  const age = p.age ?? 0
  const inc = p.income_percentile ?? 100
  const dis = p.disability ?? false
  const disGrade = parseInt((p.disability_grade ?? '0').replace(/[^0-9]/, ''), 10) || 0
  const hasChildren = p.has_children ?? false
  const childAges = p.children_ages ?? []
  const pregnant = p.is_pregnant ?? false
  const empStatus = p.employment_status ?? ''
  const household = p.household_type ?? ''

  const result: QuickBenefit[] = []

  // 기초연금
  if (age >= 65 && inc <= 70) {
    const amount = inc <= 40 ? 334810 : Math.round(334810 * (1 - (inc - 40) / 60))
    result.push({ name: '기초연금', amount, unit: '월', category: '노인', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' })
  }

  // 기초생활 생계급여
  if (inc <= 32) {
    const base = household === '단독가구' ? 713102 : 1178435
    const selfIncome = (inc / 100) * 2228445
    result.push({ name: '기초생활 생계급여', amount: Math.max(0, Math.round(base - selfIncome)), unit: '월', category: '저소득', color: 'text-red-700', bg: 'bg-red-50 border-red-200' })
  }

  // 주거급여
  if (inc <= 48) {
    const amounts: Record<string, number> = { 서울특별시: 341000, 경기도: 268000, 인천광역시: 268000 }
    const regionAmt = amounts[p.region ?? ''] ?? 198000
    result.push({ name: '주거급여', amount: regionAmt, unit: '월', category: '주거', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' })
  }

  // 의료급여
  if (inc <= 40) {
    result.push({ name: '의료급여 (본인부담 면제)', amount: 0, unit: '월', category: '의료', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' })
  }

  // 장애인연금 / 장애수당
  if (dis) {
    if (disGrade <= 2 && inc <= 70) {
      result.push({ name: '장애인연금', amount: inc <= 30 ? 334810 : 223870, unit: '월', category: '장애', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' })
    } else if (disGrade >= 3 && inc <= 50) {
      result.push({ name: '장애수당', amount: 60000, unit: '월', category: '장애', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' })
    }
    if (inc <= 120) {
      result.push({ name: '장애인 활동지원', amount: 1230000, unit: '월', category: '장애', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' })
    }
  }

  // 부모급여
  const infant0 = childAges.filter(a => a === 0).length
  const infant1 = childAges.filter(a => a === 1).length
  if (infant0 > 0) result.push({ name: `부모급여 (0세×${infant0})`, amount: 1000000 * infant0, unit: '월', category: '영유아', color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200' })
  if (infant1 > 0) result.push({ name: `부모급여 (1세×${infant1})`, amount: 500000 * infant1, unit: '월', category: '영유아', color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' })

  // 아동수당
  const under8 = childAges.filter(a => a < 8).length
  if (under8 > 0) result.push({ name: `아동수당 (${under8}명)`, amount: 100000 * under8, unit: '월', category: '아동', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' })

  // 한부모가족
  if (household === '한부모가족' && hasChildren && inc <= 63) {
    result.push({ name: '한부모가족 아동양육비', amount: 200000, unit: '월', category: '가족', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' })
  }

  // 임산부
  if (pregnant) {
    result.push({ name: '임산부 의료비 지원', amount: 1000000, unit: '일시금', category: '출산', color: 'text-fuchsia-700', bg: 'bg-fuchsia-50 border-fuchsia-200' })
    result.push({ name: '첫만남이용권', amount: 2000000, unit: '일시금', category: '출산', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' })
  }

  // 청년
  if (age >= 19 && age <= 34) {
    if (empStatus === 'unemployed' && inc <= 60) {
      result.push({ name: '청년 내일저축계좌', amount: 30000, unit: '월', category: '청년', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' })
    }
    if (inc <= 60) {
      result.push({ name: '청년 도약계좌', amount: 24000, unit: '월', category: '청년', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' })
    }
  }

  // 실업급여
  if (empStatus === 'unemployed' && inc > 0) {
    result.push({ name: '실업급여 (추정)', amount: Math.round(inc * 10000 * 0.6), unit: '월', category: '고용', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' })
  }

  return result.sort((a, b) => {
    const am = a.unit === '월' ? a.amount : a.amount / 12
    const bm = b.unit === '월' ? b.amount : b.amount / 12
    return bm - am
  })
}
