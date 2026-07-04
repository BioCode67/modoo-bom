import { describe, it, expect } from 'vitest'
import { HOUSING_POLICIES } from './housingPolicies'
import { getCatalog, getPolicyMap } from './catalog'
import { applyLink } from '@/lib/officialLinks'
import { runAnalysis, type UserProfile } from '@/lib/welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('HOUSING_POLICIES — 청년주택 공고 큐레이션', () => {
  it('HOU- 고유 id, 필수 필드 채움', () => {
    const ids = new Set<string>()
    for (const p of HOUSING_POLICIES) {
      expect(p.id).toMatch(/^HOU-\d{3}$/)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.name).toBeTruthy()
      expect(p.category).toBe('청년주거')
      expect(p.benefit).toBeTruthy()
      expect(p.eligibility).toBeTruthy()
      expect(p.department).toBeTruthy()
    }
  })

  it('application에 살아있는 공식 공고 게시판 URL 포함', () => {
    for (const p of HOUSING_POLICIES) {
      expect(p.application).toMatch(/https:\/\//)
    }
  })

  it('공식 게시판만 사용(가짜 공고 미생성 원칙) — 검증된 도메인 화이트리스트', () => {
    const allow = /(apply\.lh\.or\.kr|myhome\.go\.kr|i-sh\.co\.kr|housing\.seoul\.go\.kr|gh\.or\.kr|kosaf\.go\.kr)/
    for (const p of HOUSING_POLICIES) {
      const url = applyLink(p.application).url
      expect(url).toMatch(allow)
      // applyLink가 뒤 한글·괄호를 떼고 깨끗한 URL을 만든다
      expect(url).not.toMatch(/[가-힣)]/)
    }
  })

  it('청년(26세)에겐 뜨고, 어르신(70세)에겐 누수 없음', () => {
    const youth = runAnalysis({ ...base, age: 26, income_percentile: 60 })
      .eligible_policies.filter((p) => p.id.startsWith('HOU-'))
    expect(youth.length).toBeGreaterThanOrEqual(6)
    const senior = runAnalysis({ ...base, age: 70, income_percentile: 25 })
      .eligible_policies.filter((p) => p.id.startsWith('HOU-'))
    expect(senior.length).toBe(0)
  })

  it('카탈로그·맵에 병합됨', () => {
    const map = getPolicyMap()
    const cat = new Set(getCatalog().map((p) => p.id))
    for (const p of HOUSING_POLICIES) {
      expect(map[p.id]).toBeTruthy()
      expect(cat.has(p.id)).toBe(true)
    }
  })
})
