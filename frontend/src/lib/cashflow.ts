/**
 * 연간 복지 현금흐름 — 앞으로 12개월 동안 '언제 얼마' 받는지 계산(순수 함수, 테스트 용이).
 *
 * - 매월 반복 현금(월 수당·급여): parseMonthly로 월액 산출 → 12개월 균등.
 * - 일시금(첫만남이용권·해산급여·출산 일시금 등): 신청 첫 달(month 0)에 한 번.
 * 정직성: isCashBenefit(현금성)만 반복으로, 바우처·대출·서비스 한도·현물은 제외(BenefitBreakdown과 동일 기준).
 * 서버 전송 없음 — 결과의 eligible_policies에서 전부 기기 내 계산.
 */
import { parseMonthly, isCashBenefit } from './format'

// 일시금(한 번 지급) 신호 — 월 반복이 아닌 목돈. 정책명/혜택 문구로 감지.
const ONETIME_RE = /일시금|한\s*번|1회성?|첫만남|해산급여|출산.*지원금|축하금|정착금|장려금.*일시|출산장려/

/** '월 N' 표기를 제외한 첫 큰 금액(일시금)을 원 단위로. (월 반복분과 중복 카운트 방지) */
function parseLump(benefit: string): number {
  const b = (benefit || '').replace(/월\s*(?:최대\s*)?[0-9.,]+\s*만?\s*원/g, ' ')
  const won = b.match(/([0-9,]{4,})\s*원/)
  if (won) {
    const n = parseInt(won[1].replace(/,/g, ''), 10)
    if (n >= 10000) return n
  }
  const man = b.match(/([0-9]+(?:\.[0-9]+)?)\s*만\s*원/)
  if (man) return Math.round(parseFloat(man[1]) * 10000)
  return 0
}

export interface CashflowItem { name: string; won: number; kind: 'monthly' | 'once' }
export interface Cashflow {
  months: number[]          // 12개월 각 월 예상 수령액(원)
  monthlyRecurring: number  // 매월 반복 현금 합(원/월)
  oneTimeTotal: number      // 일시금 합(원)
  annualTotal: number       // 연간 총 예상 수령액(원)
  items: CashflowItem[]     // 기여 정책(수령액 내림차순)
}

export function annualCashflow(
  policies: { name: string; category?: string; benefit?: string }[],
): Cashflow {
  let monthlyRecurring = 0
  let oneTimeTotal = 0
  const items: CashflowItem[] = []
  for (const p of policies || []) {
    const benefit = p.benefit || ''
    const ctx = `${p.name} ${p.category || ''}`
    const monthly = isCashBenefit(benefit, ctx) ? parseMonthly(benefit) : 0
    if (monthly > 0) {
      monthlyRecurring += monthly
      items.push({ name: p.name, won: monthly, kind: 'monthly' })
    } else if (ONETIME_RE.test(ctx) || ONETIME_RE.test(benefit)) {
      const lump = parseLump(benefit)
      if (lump > 0) {
        oneTimeTotal += lump
        items.push({ name: p.name, won: lump, kind: 'once' })
      }
    }
  }
  const months = Array<number>(12).fill(monthlyRecurring)
  months[0] += oneTimeTotal // 일시금은 신청 첫 달에
  items.sort((a, b) => b.won - a.won)
  return {
    months,
    monthlyRecurring,
    oneTimeTotal,
    annualTotal: monthlyRecurring * 12 + oneTimeTotal,
    items,
  }
}
