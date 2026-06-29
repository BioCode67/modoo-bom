import { describe, it, expect } from 'vitest'
import { formatWon, parseMonthly, categoryMeta } from './format'

describe('parseMonthly', () => {
  it('원 단위(전체 숫자) 매칭', () => {
    expect(parseMonthly('월 최대 349,700원 지급')).toBe(349700)
    expect(parseMonthly('0세 월 584,000원')).toBe(584000)
  })
  it('만원 단위 환산', () => {
    expect(parseMonthly('자녀 1인당 월 23만원')).toBe(230000)
    expect(parseMonthly('0세 월 100만원')).toBe(1000000)
    expect(parseMonthly('공익활동형 월 29만원')).toBe(290000)
  })
  it('소수 만원(63.4만원) 환산', () => {
    expect(parseMonthly('사회서비스형 월 63.4만원')).toBe(634000)
  })
  it('원-우선: 납입한도(70만원)가 아니라 실제 혜택(33,000원)을 잡음', () => {
    expect(parseMonthly('월 최대 70만원 납입, 정부기여금 월 최대 33,000원')).toBe(33000)
  })
  it('월 표기 없거나 금액 없으면 0', () => {
    expect(parseMonthly('치료비 전액 지원')).toBe(0)
    expect(parseMonthly('연 13만원 문화 바우처')).toBe(0) // 월이 아닌 연 단위
  })
})

describe('formatWon', () => {
  it('0/음수 → -', () => {
    expect(formatWon(0)).toBe('-')
    expect(formatWon(-5)).toBe('-')
  })
  it('만원/원/억원 단위', () => {
    expect(formatWon(230000)).toBe('23만원')
    expect(formatWon(5000)).toBe('5,000원')
    expect(formatWon(100000000)).toBe('1억원')
    expect(formatWon(150000000)).toBe('1.5억원')
  })
})

describe('categoryMeta', () => {
  it('카테고리별 이모지 매핑', () => {
    expect(categoryMeta('노인').emoji).toBe('👵')
    expect(categoryMeta('장애인').emoji).toBe('♿')
    expect(categoryMeta('아동·영유아').emoji).toBe('👶')
    expect(categoryMeta('주거').emoji).toBe('🏠')
  })
  it('미지정 카테고리는 기본값 🌼', () => {
    expect(categoryMeta('보훈').emoji).toBe('🌼')
    expect(categoryMeta('').emoji).toBe('🌼')
  })
})
