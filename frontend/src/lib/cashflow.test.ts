import { describe, it, expect } from 'vitest'
import { annualCashflow } from './cashflow'

const P = (name: string, benefit: string, category = '') => ({ name, benefit, category })

describe('annualCashflow', () => {
  it('매월 반복 현금은 12개월 균등 + 연간=월×12', () => {
    const cf = annualCashflow([P('기초연금', '월 최대 34만원'), P('아동수당', '자녀 1인당 월 10만원')])
    expect(cf.monthlyRecurring).toBe(340000 + 100000)
    expect(cf.months.every((m) => m === 440000)).toBe(true)
    expect(cf.annualTotal).toBe(440000 * 12)
  })

  it('일시금은 첫 달에만 스파이크 + 연간에 1회 합산', () => {
    const cf = annualCashflow([P('기초연금', '월 30만원'), P('첫만남이용권', '200만원 일시금')])
    expect(cf.oneTimeTotal).toBe(2000000)
    expect(cf.months[0]).toBe(300000 + 2000000) // 첫 달 = 월반복 + 일시금
    expect(cf.months[1]).toBe(300000)           // 이후는 월반복만
    expect(cf.annualTotal).toBe(300000 * 12 + 2000000)
  })

  it('바우처·대출·현물·서비스한도는 제외(정직성)', () => {
    const cf = annualCashflow([
      P('문화누리카드', '연 13만원 바우처'),
      P('전세자금대출', '보증금 2억원 대출'),
      P('장기요양', '월 최대 200만원 한도', '노인 장기요양보험 재가급여'),
    ])
    expect(cf.annualTotal).toBe(0)
    expect(cf.items).toHaveLength(0)
  })

  it('혼합 — 기여 정책이 수령액 내림차순', () => {
    const cf = annualCashflow([P('아동수당', '월 10만원'), P('기초연금', '월 34만원')])
    expect(cf.items[0].name).toBe('기초연금')
    expect(cf.items[0].kind).toBe('monthly')
  })

  it('빈 입력·현금 없음 → 0', () => {
    expect(annualCashflow([]).annualTotal).toBe(0)
    expect(annualCashflow([P('상담 서비스', '무료 상담')]).annualTotal).toBe(0)
  })
})
