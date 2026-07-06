import { describe, it, expect } from 'vitest'
import { sidoOf } from './welfare-engine'

describe('sidoOf — 지자체 LOC target 시·도 판정', () => {
  it("'[경기도 광주시]'는 경기(광주광역시로 오태깅 금지) — 브라켓 첫 토큰으로 판정", () => {
    expect(sidoOf('[경기도 광주시] 청년 월세 지원')).toBe('경기')
    expect(sidoOf('[광주광역시 서구] 어르신 지원')).toBe('광주')
    expect(sidoOf('[경기도 성남시] 아동수당')).toBe('경기')
  })
  it('자유서술(프로필 region)은 기존 부분문자열 매칭 유지', () => {
    expect(sidoOf('서울특별시')).toBe('서울')
    expect(sidoOf('경상북도 경산시')).toBe('경북')
  })
  it("자유서술 '경기도 광주시'도 경기(브라켓 없는 QuickAsk 경로) — 도(道) 우선 판정", () => {
    // 예전엔 SIDO 순서상 '광주'(메트로)가 '경기'보다 먼저 히트해 광주광역시로 오태깅됐다.
    expect(sidoOf('경기도 광주시 사는 청년인데 월세 지원 있나요')).toBe('경기')
    expect(sidoOf('경기 광주 거주')).toBe('경기')
    // 진짜 광주광역시 자유서술은 그대로 광주
    expect(sidoOf('광주 사는데 어르신 복지')).toBe('광주')
    expect(sidoOf('세종시 신혼부부')).toBe('세종')
  })
})
