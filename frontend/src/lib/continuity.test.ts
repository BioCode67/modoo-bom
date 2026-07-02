import { describe, it, expect } from 'vitest'
import { diffProfiles, newlyUnlocked, profilesEqual } from './continuity'
import type { UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '홍길동', age: 30, gender: 'other', region: '', household_type: '1인가구',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: 'employed', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('continuity 변화 감지', () => {
  it('profilesEqual: 동일 프로필은 true, 나이 변화는 false', () => {
    expect(profilesEqual(base, { ...base })).toBe(true)
    expect(profilesEqual(base, { ...base, age: 31 })).toBe(false)
  })

  it('diffProfiles: 소득 하락은 down, 나이 증가는 up으로 표시', () => {
    const changes = diffProfiles(base, { ...base, age: 31, income_percentile: 40 })
    const income = changes.find((c) => c.label === '소득수준')
    const age = changes.find((c) => c.label === '나이')
    expect(income?.kind).toBe('down')
    expect(age?.kind).toBe('up')
  })

  it('diffProfiles: 새 생애 사건을 감지', () => {
    const changes = diffProfiles(base, { ...base, life_events: ['출산'] })
    expect(changes.some((c) => c.label === '생애 사건' && c.to === '출산')).toBe(true)
  })

  it('newlyUnlocked: 자녀 출생 변화로 새 복지가 열린다', () => {
    const withBaby = { ...base, has_children: true, children_ages: [0], is_pregnant: false }
    expect(newlyUnlocked(base, withBaby).length).toBeGreaterThan(0)
  })

  it('newlyUnlocked: 변화 없으면 새 복지 없음', () => {
    expect(newlyUnlocked(base, { ...base }).length).toBe(0)
  })
})
