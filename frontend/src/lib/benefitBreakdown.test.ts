import { describe, it, expect } from 'vitest'
import { benefitBreakdown } from './benefitBreakdown'

describe('benefitBreakdown — 합산형 금액 분해', () => {
  it('A + B = C 를 구성요소로 분해', () => {
    const b = benefitBreakdown('기초급여 349,700원 + 부가급여 90,000원 = 439,700원')
    expect(b.hasBreakdown).toBe(true)
    expect(b.parts.length).toBe(2)
    expect(b.parts[0].won).toBe(349700)
    expect(b.parts[1].won).toBe(90000)
    expect(b.total).toBe(439700)
  })

  it('만원 단위 세그먼트(월 접두 없이도)', () => {
    const b = benefitBreakdown('기초 30만원 + 부가 9만원')
    expect(b.hasBreakdown).toBe(true)
    expect(b.parts[0].won).toBe(300000)
    expect(b.total).toBe(390000) // = 없으면 구성요소 합
  })

  it("'+' 없으면 분해 안 함", () => expect(benefitBreakdown('월 최대 43만원').hasBreakdown).toBe(false))
  it('단일 금액은 분해 안 함', () => expect(benefitBreakdown('월 20만원').hasBreakdown).toBe(false))
  it('구성요소가 1개뿐이면 분해 안 함', () => expect(benefitBreakdown('기초 30만원 + 별도 안내').hasBreakdown).toBe(false))

  it('라벨은 금액·필러 제거 후 남긴다', () => {
    const b = benefitBreakdown('기초급여 349,700원 + 부가급여 90,000원')
    expect(b.parts[0].label).toContain('기초급여')
    expect(b.parts[0].label).not.toMatch(/\d/)
  })

  it("'=' 없으면 구성요소 합이 total", () => {
    const b = benefitBreakdown('A 10만원 + B 20만원')
    expect(b.total).toBe(300000)
  })

  it('빈 문자열 안전', () => expect(benefitBreakdown('').hasBreakdown).toBe(false))
})
