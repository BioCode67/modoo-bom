import { describe, it, expect } from 'vitest'
import { simulateFuture } from './simulate'
import type { UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: 'employed', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('simulateFuture 연령 타당성', () => {
  it('72세 어르신: 출산·실직 시나리오 제외', () => {
    const keys = simulateFuture({ ...base, age: 72, employment_status: 'retired' }).map((s) => s.key)
    expect(keys).not.toContain('birth')
    expect(keys).not.toContain('jobloss')
    expect(keys).not.toContain('senior') // 이미 65세 이상
  })
  it('30세 재직자: 출산·실직 시나리오 포함, 65세 시나리오도 포함', () => {
    const keys = simulateFuture(base).map((s) => s.key)
    expect(keys).toContain('birth')
    expect(keys).toContain('jobloss')
    expect(keys).toContain('senior')
  })
  it('각 시나리오는 새 정책이 1건 이상일 때만 노출', () => {
    for (const s of simulateFuture(base)) expect(s.newPolicies.length).toBeGreaterThan(0)
  })
})
