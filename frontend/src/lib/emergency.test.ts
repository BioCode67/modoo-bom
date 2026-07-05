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
  it('민간 위기지원(아산SOS·사랑의열매)도 노출되되, 1순위는 정부 제도', () => {
    for (const k of ['sick', 'joblost']) {
      const r = matchEmergency([k])
      expect(r.some((p) => p.id.startsWith('PRV-'))).toBe(true) // 민간 사각지대 연계
      expect(r[0].id.startsWith('PRV-')).toBe(false) // 법정 권리(정부)가 최우선
    }
  })
  it('CRISES 8종 정의 + 필수 필드', () => {
    expect(CRISES.length).toBe(8)
    for (const c of CRISES) {
      expect(c.key).toBeTruthy()
      expect(c.keywords.length).toBeGreaterThan(0)
    }
  })
  it('감사 회귀: 폭력·학대 위기에 비긴급 생리용품 바우처가 섞이지 않음', () => {
    const r = matchEmergency(['violence'])
    // '여성'·'청소년' 광의 키워드 제거로 생리용품 바우처(비긴급)가 긴급 지원으로 오노출되지 않아야
    expect(r.some((p) => /생리|위생용품/.test(p.name))).toBe(false)
  })
})
