import { describe, it, expect } from 'vitest'
import { benefitBreakdown } from './benefitBreakdown'

describe('benefitBreakdown — 합산형 금액 분해', () => {
  it('기초 + 부가 = 합계 구조를 구성요소로 분해', () => {
    const r = benefitBreakdown('기초급여 월 최대 349,700원 + 부가급여 9만원 = 월 최대 439,700원 (2026년 기준)')
    expect(r.hasBreakdown).toBe(true)
    expect(r.parts).toHaveLength(2)
    expect(r.parts[0]).toEqual({ label: '기초급여', won: 349700 })
    expect(r.parts[1]).toEqual({ label: '부가급여', won: 90000 })
    expect(r.total).toBe(439700)
  })

  it("'=' 없이 'A원 + B원'이면 합으로 합계 산정", () => {
    const r = benefitBreakdown('생계지원 10만원 + 주거지원 5만원')
    expect(r.hasBreakdown).toBe(true)
    expect(r.parts.map((p) => p.won)).toEqual([100000, 50000])
    expect(r.total).toBe(150000)
  })

  it('단일 금액은 분해 안 함(total만)', () => {
    const r = benefitBreakdown('월 최대 20만원')
    expect(r.hasBreakdown).toBe(false)
    expect(r.parts).toEqual([])
    expect(r.total).toBe(200000)
  })

  it('범위 금액도 분해 안 함', () => {
    const r = benefitBreakdown('월 10~30만원')
    expect(r.hasBreakdown).toBe(false)
    expect(r.total).toBe(300000) // parseMonthly는 상한
  })

  it("금액 없는 '가구별 차등'은 분해·합계 모두 0/false", () => {
    const r = benefitBreakdown('가구별 차등 지급')
    expect(r.hasBreakdown).toBe(false)
    expect(r.total).toBe(0)
    expect(r.parts).toEqual([])
  })

  it('구성요소가 하나뿐이면 분해로 치지 않음', () => {
    // '+' 뒤가 금액이 아니라 설명이면 parts 1개 → false
    const r = benefitBreakdown('교육급여 월 5만원 + 교재비 실비')
    expect(r.hasBreakdown).toBe(false)
  })

  it('라벨에서 금액·필러·괄호가 제거됨', () => {
    const r = benefitBreakdown('양육수당 월 최대 10만원 + 보육료 월 20만원 = 30만원')
    expect(r.parts[0].label).toBe('양육수당')
    expect(r.parts[1].label).toBe('보육료')
  })

  it('빈 문자열·falsy 안전', () => {
    expect(benefitBreakdown('').hasBreakdown).toBe(false)
    expect(benefitBreakdown(undefined as unknown as string).total).toBe(0)
  })
})
