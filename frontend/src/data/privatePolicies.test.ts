import { describe, it, expect } from 'vitest'
import { PRIVATE_POLICIES } from './privatePolicies'
import { getCatalog, getPolicyMap } from './catalog'
import { getEligiblePolicies, type UserProfile } from '@/lib/welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('PRIVATE_POLICIES — 민간재단 큐레이션 데이터 무결성', () => {
  it('PRV- 고유 id, 필수 필드 전부 채움', () => {
    const ids = new Set<string>()
    for (const p of PRIVATE_POLICIES) {
      expect(p.id).toMatch(/^PRV-\d{3}$/)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.name).toBeTruthy()
      expect(p.category).toMatch(/^민간/)
      expect(p.target).toBeTruthy()
      expect(p.benefit).toBeTruthy()
      expect(p.eligibility).toBeTruthy()
      expect(p.department).toBeTruthy()
      expect(p.required_docs.length).toBeGreaterThan(0)
    }
  })
  it('신청 안내에 공식 URL 포함(검증된 링크만 수록 원칙)', () => {
    for (const p of PRIVATE_POLICIES) {
      expect(p.application).toMatch(/https:\/\/[^\s)]+/)
    }
  })
  it('선발·심사형임을 benefit에 정직하게 명시', () => {
    for (const p of PRIVATE_POLICIES) {
      expect(p.benefit).toMatch(/선발형|심사형/)
    }
  })
  it('카탈로그·맵에 병합됨', () => {
    const map = getPolicyMap()
    for (const p of PRIVATE_POLICIES) expect(map[p.id]?.name).toBe(p.name)
    expect(getCatalog().some((p) => p.id === 'PRV-001')).toBe(true)
  })
})

describe('민간재단 — 엔진 통합(저신뢰 관련 복지로만 노출)', () => {
  it('청년(26세) → 장학 프로그램이 관련 복지로 노출', () => {
    const r = getEligiblePolicies({ ...base, age: 26, employment_status: 'student' })
    const prv = r.filter((p) => p.id.startsWith('PRV-'))
    expect(prv.some((p) => p.name.includes('스칼러십') || p.name.includes('장학'))).toBe(true)
    // 심사·선발형이므로 절대 정밀 매칭으로 과장되지 않아야 함(inferFromText 상한 0.68)
    for (const p of prv) {
      expect(p.priority).toBe('low')
      expect(p.confidence).toBeLessThanOrEqual(0.68)
    }
  })
  it('등록 장애인 → 밀알복지재단 지원이 관련 복지로 노출', () => {
    const r = getEligiblePolicies({ ...base, age: 45, disability: true, disability_grade: '1급', income_percentile: 40 })
    expect(r.some((p) => p.id === 'PRV-009')).toBe(true)
  })
  it('자녀 있는 위기가정 → 초록우산 위기아동 지원 노출', () => {
    const r = getEligiblePolicies({ ...base, age: 38, has_children: true, children_ages: [8], income_percentile: 45 })
    expect(r.some((p) => p.id === 'PRV-008')).toBe(true)
  })
  it('조건 안 맞으면(고소득 노년 무자녀) 장학·아동 지원 미노출', () => {
    const r = getEligiblePolicies({ ...base, age: 70, income_percentile: 150 })
    expect(r.some((p) => p.id === 'PRV-001')).toBe(false)
    expect(r.some((p) => p.id === 'PRV-008')).toBe(false)
  })
})
