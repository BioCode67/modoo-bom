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

  it('임금대체(육아휴직급여)는 순증 현금흐름에서 제외 — 상단 합계와 정합, 헤드라인 과장 방지(감사 4차 #2)', () => {
    const cf = annualCashflow([
      P('부모급여', '0세 월 100만원', '육아'),
      P('육아휴직급여', '통상임금 100%, 월 최대 250만원', '육아'), // 임금대체 → 제외
    ])
    expect(cf.monthlyRecurring).toBe(1000000)        // 육아휴직 250만 미포함
    expect(cf.items.some((i) => i.name === '육아휴직급여')).toBe(false)
    expect(cf.annualTotal).toBe(1000000 * 12)
  })

  it('일시금(현금)은 첫 달에만 스파이크 + 연간에 1회 합산', () => {
    // 해산급여 = 현금 일시금. (첫만남이용권은 국민행복카드 '바우처'라 현금흐름에서 제외 — 아래 테스트 참고)
    const cf = annualCashflow([P('기초연금', '월 30만원'), P('해산급여', '70만원 일시금')])
    expect(cf.oneTimeTotal).toBe(700000)
    expect(cf.months[0]).toBe(300000 + 700000) // 첫 달 = 월반복 + 일시금
    expect(cf.months[1]).toBe(300000)          // 이후는 월반복만
    expect(cf.annualTotal).toBe(300000 * 12 + 700000)
  })

  it('바우처·대출·현물·서비스한도는 제외(정직성) — 일시금도 동일 기준', () => {
    const cf = annualCashflow([
      P('문화누리카드', '연 13만원 바우처'),
      P('전세자금대출', '보증금 2억원 대출'),
      P('장기요양', '월 최대 200만원 한도', '노인 장기요양보험 재가급여'),
      // 일시금 문구여도 바우처/대출/상품권이면 현금흐름에 넣지 않는다(헤드라인 과장 방지)
      P('첫만남이용권', '첫째 200만원 국민행복카드 바우처 일시금'),
      P('창업정착금', '정착금 500만원 융자·대출'),
      P('출산축하금', '축하금 상품권 30만원 일시 지급'),
    ])
    expect(cf.annualTotal).toBe(0)
    expect(cf.items).toHaveLength(0)
    // 현금은 아니지만 금액 있는 비현금 지원은 'nonCash'로 따로 알린다(정직히 챙기게)
    expect(cf.nonCash).toContain('첫만남이용권')
    expect(cf.nonCash).toContain('출산축하금')
    expect(cf.nonCash).toContain('문화누리카드')
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
