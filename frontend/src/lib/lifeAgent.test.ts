import { describe, it, expect } from 'vitest'
import { predictTimeline } from './lifeAgent'
import type { UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 50, disability: false, disability_grade: '',
  employment_status: 'employed', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('predictTimeline 선제적 생애 타임라인', () => {
  it('64세 저소득: 1년 내 만 65세 임계점에서 복지가 새로 열린다', () => {
    const ev = predictTimeline({ ...base, age: 64, income_percentile: 40 })
    const senior = ev.find((e) => e.trigger.includes('65세'))
    expect(senior).toBeTruthy()
    expect(senior!.year).toBe(1)
    expect(senior!.gained.length).toBeGreaterThan(0)
    expect(senior!.monthlyDelta).toBeGreaterThan(0)
  })

  it('만 8세 자녀: 1년 뒤 만 9세 임계점에서 아동 관련 복지가 종료된다', () => {
    const ev = predictTimeline({ ...base, age: 38, has_children: true, children_ages: [8] })
    const kid9 = ev.find((e) => e.trigger.includes('9세'))
    expect(kid9).toBeTruthy()
    expect(kid9!.lost.length).toBeGreaterThan(0)
  })

  it('이미 고령(70세): 65세 임계점 이벤트는 나오지 않는다', () => {
    const ev = predictTimeline({ ...base, age: 70 })
    expect(ev.find((e) => e.trigger.includes('65세'))).toBeFalsy()
  })

  it('같은 정책은 최초 도래 연도에 한 번만 집계(중복 없음)', () => {
    const ev = predictTimeline({ ...base, age: 58, income_percentile: 40 })
    const gainedIds = ev.flatMap((e) => e.gained.map((p) => p.id))
    expect(new Set(gainedIds).size).toBe(gainedIds.length)
  })
})
