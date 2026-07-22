import { describe, it, expect } from 'vitest'
import { getEligiblePolicies, type UserProfile } from './welfare-engine'
import { rankPolicies } from './priority'
import { buildDocPlan } from './docPlan'
import { explainEligibility } from './explainEligibility'
import { classifyHousehold } from './householdType'
import { getPolicyMap } from '@/data/catalog'

/**
 * 페르소나 종단 하드닝 — 심사가 평가하는 방식(대표 사용자 시나리오)으로 신규 기능 전체를
 * 실제 엔진 결과에 연결해 '크래시 없음 + 의미 있는 불변식'을 잠근다.
 */

const P = (o: Partial<UserProfile>): UserProfile => ({
  name: '', age: 40, gender: 'other', region: '서울', household_type: '', income_percentile: 50,
  disability: false, disability_grade: '', employment_status: '', has_children: false,
  children_ages: [], is_pregnant: false, life_events: [], ...o,
})

const PERSONAS: { label: string; profile: UserProfile }[] = [
  { label: '노인 저소득 1인', profile: P({ age: 74, income_percentile: 20, household_type: '1인가구' }) },
  { label: '청년 무주택', profile: P({ age: 27, income_percentile: 55, employment_status: 'unemployed' }) },
  { label: '한부모 다자녀', profile: P({ age: 38, income_percentile: 35, household_type: '한부모가족', has_children: true, children_ages: [4, 7] }) },
  { label: '장애인 가구', profile: P({ age: 50, income_percentile: 30, disability: true, disability_grade: '중증' }) },
  { label: '영유아 양육', profile: P({ age: 33, income_percentile: 60, has_children: true, children_ages: [1] }) },
]

describe('페르소나 × 신규 기능 종단 통합', () => {
  const map = getPolicyMap()

  for (const { label, profile } of PERSONAS) {
    describe(label, () => {
      const eligible = getEligiblePolicies(profile)

      it('자격 정책이 1건 이상(저소득·취약 페르소나는 사각지대여선 안 됨)', () => {
        expect(eligible.length).toBeGreaterThan(0)
      })

      it('rankPolicies: 자격 정책을 크래시 없이 점수화(개수 보존·정렬 불변식)', () => {
        const ranked = rankPolicies(eligible)
        expect(ranked.length).toBe(eligible.length)
        for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
      })

      it('buildDocPlan: 자격 정책의 서류를 합쳐 상태 합계가 정합', () => {
        const plan = buildDocPlan(eligible.map((p) => ({ policyId: p.id })), map, {}, Date.now())
        expect(plan.missingCount + plan.readyCount + plan.expiringCount + plan.expiredCount).toBe(plan.needs.length)
      })

      it('explainEligibility: 상위 자격 정책의 판정 근거가 크래시 없이 나온다', () => {
        for (const p of eligible.slice(0, 5)) {
          const ex = explainEligibility(p, profile)
          expect(['precise', 'summary']).toContain(ex.mode)
          if (ex.mode === 'precise') expect(ex.gates).toHaveLength(4)
        }
      })
    })
  }

  it('classifyHousehold: 한부모 페르소나 구성원 추론', () => {
    const c = classifyHousehold([{ relation: '본인', age: 38 }, { relation: '자녀', age: 4 }, { relation: '자녀', age: 7 }])
    expect(c.type).toBe('한부모가족')
    expect(c.flags).toContain('다자녀')
  })

  it('노인 저소득 페르소나의 자격 정책에 노인/현금성 복지가 상위(우선순위 의미 검증)', () => {
    const senior = P({ age: 74, income_percentile: 20, household_type: '1인가구' })
    const ranked = rankPolicies(getEligiblePolicies(senior))
    // 상위 5개 안에 노인 관련 또는 현금성(월 금액 있는) 복지가 존재해야 우선순위가 의미를 가진다
    const top = ranked.slice(0, 5)
    expect(top.some((r) => /노인|연금|기초/.test(r.policy.name + r.policy.category) || r.monthly > 0)).toBe(true)
  })
})
