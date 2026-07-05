import { describe, it, expect } from 'vitest'
import { extractTel } from './VisitKit'

describe('VisitKit extractTel — 문의처에서 전화번호 추출', () => {
  it('대표번호 추출', () => {
    expect(extractTel('보건복지상담센터 ☎ 129')).toBe('129')
    expect(extractTel('국민연금공단 1355')).toBe('1355')
    expect(extractTel('LH 1600-1004')).toBe('1600-1004')
    expect(extractTel('☎ 02-1234-5678 (평일)')).toBe('02-1234-5678')
  })
  it('번호 없으면 빈 문자열', () => {
    expect(extractTel('가까운 주민센터 방문')).toBe('')
    expect(extractTel('')).toBe('')
    expect(extractTel(undefined)).toBe('')
  })
})
