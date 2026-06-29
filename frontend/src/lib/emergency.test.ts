import { describe, it, expect } from 'vitest'
import { matchEmergency, CRISES } from './emergency'

describe('matchEmergency', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(matchEmergency([])).toEqual([])
  })
  it('실직 위기 → 관련 정책(최대 6건)', () => {
    const r = matchEmergency(['joblost'])
    expect(r.length).toBeGreaterThan(0)
    expect(r.length).toBeLessThanOrEqual(6)
  })
  it('여러 위기 동시 선택도 동작', () => {
    const r = matchEmergency(['joblost', 'housing'])
    expect(r.length).toBeGreaterThan(0)
    expect(r.length).toBeLessThanOrEqual(6)
  })
  it('알 수 없는 key는 키워드가 없어 긴급복지 계열만 surfacing(방어적)', () => {
    const r = matchEmergency(['nonexistent'])
    expect(r.every((p) => p.name.includes('긴급'))).toBe(true)
  })
  it('CRISES 8종 정의 + 필수 필드', () => {
    expect(CRISES.length).toBe(8)
    for (const c of CRISES) {
      expect(c.key).toBeTruthy()
      expect(c.keywords.length).toBeGreaterThan(0)
    }
  })
})
