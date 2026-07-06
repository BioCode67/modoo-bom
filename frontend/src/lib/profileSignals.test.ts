import { describe, it, expect } from 'vitest'
import { profileSignals } from './profileSignals'
import type { UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('profileSignals', () => {
  it('어르신·저소득·자녀 양육을 사람이 읽을 신호로', () => {
    const s = profileSignals({ ...base, age: 72, income_percentile: 30, has_children: true, children_ages: [5] })
    expect(s).toContain('어르신')
    expect(s).toContain('저소득')
    expect(s).toContain('자녀 양육')
  })
  it('자녀 2명 이상은 인원수를 표기', () => {
    expect(profileSignals({ ...base, has_children: true, children_ages: [7, 5, 2] })).toContain('자녀 3명 양육')
  })
  it('한부모는 원문 가구유형과 중복 노출하지 않음', () => {
    const s = profileSignals({ ...base, household_type: '한부모가족' })
    expect(s).toContain('한부모·조손')
    expect(s).not.toContain('한부모가족')
  })
  it('청년/학생/구직 신호', () => {
    expect(profileSignals({ ...base, age: 27 })).toContain('청년')
    expect(profileSignals({ ...base, employment_status: 'student' })).toContain('학생')
    expect(profileSignals({ ...base, employment_status: 'unemployed' })).toContain('구직 중')
  })
  it('질병 이벤트는 별도 신호가 없어 노출(의료 근거)', () => {
    expect(profileSignals({ ...base, life_events: ['질병'] })).toContain('질병·의료비')
  })
  it('취약계층 대상군을 파악 칩으로 노출', () => {
    expect(profileSignals({ ...base, life_events: ['북한이탈'] })).toContain('북한이탈주민')
    expect(profileSignals({ ...base, life_events: ['보훈'] })).toContain('국가유공·보훈')
    expect(profileSignals({ ...base, life_events: ['자립준비'] })).toContain('자립준비청년')
    expect(profileSignals({ ...base, life_events: ['가정폭력'] })).toContain('폭력 피해 지원')
  })
  it('신호가 없으면 빈 배열(청년·어르신 아닌 중장년, 특이사항 없음)', () => {
    expect(profileSignals({ ...base, age: 45 })).toEqual([])
  })
  it('중복 없이 유일값만', () => {
    const s = profileSignals({ ...base, age: 70, income_percentile: 20, disability: true })
    expect(new Set(s).size).toBe(s.length)
  })
})
