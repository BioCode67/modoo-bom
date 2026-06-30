import { describe, it, expect } from 'vitest'
import {
  extractKeywords, getEligiblePolicies, searchPolicies,
  estimateBenefits, runAnalysis, checkPolicy, sidoOf, guOf, demographicMismatch, type UserProfile,
} from './welfare-engine'
import type { Policy } from '@/data/policies'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}
const senior: UserProfile = { ...base, age: 72, income_percentile: 25 }
const youth: UserProfile = { ...base, age: 26, employment_status: 'unemployed', income_percentile: 55, life_events: ['실직'] }
const newborn: UserProfile = { ...base, age: 32, has_children: true, children_ages: [0], life_events: ['출산'] }
const disabled: UserProfile = { ...base, age: 45, disability: true, disability_grade: '1급', income_percentile: 35 }

describe('extractKeywords', () => {
  it('노인 프로필 → 기초연금 키워드', () => {
    expect(extractKeywords(senior).keywords).toContain('기초연금')
  })
  it('청년 미취업 → 실업급여/취업 키워드', () => {
    const kw = extractKeywords(youth).keywords.join(' ')
    expect(kw).toMatch(/실업급여|취업|청년/)
  })
})

describe('getEligiblePolicies', () => {
  it('72세 저소득 → 기초연금(POL-001) 포함, 우선순위 high', () => {
    const list = getEligiblePolicies(senior)
    const gp = list.find((p) => p.id === 'POL-001')
    expect(gp).toBeTruthy()
    expect(gp?.priority).toBe('high')
    expect(gp?.confidence).toBeGreaterThan(0.8)
  })
  it('만 0세 자녀 → 아동수당(POL-004) 포함', () => {
    expect(getEligiblePolicies(newborn).some((p) => p.id === 'POL-004')).toBe(true)
  })
  it('만 8세 자녀도 아동수당(POL-004) 포함 (2026년 9세 미만 확대)', () => {
    const child8: UserProfile = { ...base, age: 38, has_children: true, children_ages: [8] }
    expect(getEligiblePolicies(child8).some((p) => p.id === 'POL-004')).toBe(true)
  })
  it('중증장애인 → 장애인연금(POL-003) 포함', () => {
    expect(getEligiblePolicies(disabled).some((p) => p.id === 'POL-003')).toBe(true)
  })
  it('우선순위 정렬: high가 low보다 앞', () => {
    const list = getEligiblePolicies(senior)
    const firstLow = list.findIndex((p) => p.priority === 'low')
    const lastHigh = list.map((p) => p.priority).lastIndexOf('high')
    if (firstLow !== -1 && lastHigh !== -1) expect(lastHigh).toBeLessThan(firstLow)
  })
  it('연령 미달이면 노인 정책 제외(35세는 기초연금 아님)', () => {
    expect(getEligiblePolicies({ ...base, age: 35 }).some((p) => p.id === 'POL-001')).toBe(false)
  })
  it('72세 저소득 결과에 청년·유아·고용장려금 정책이 새어들지 않음(인구통계 게이트)', () => {
    const names = getEligiblePolicies(senior).map((p) => p.name).join(' ')
    expect(names).not.toMatch(/청년/)
    expect(names).not.toMatch(/유아|영유아|보육|어린이집/)
    expect(names).not.toMatch(/고용장려금/)
  })
  it('자녀 없는 가구엔 아동수당이 안 뜸(자녀 생기면 다시 뜸)', () => {
    expect(getEligiblePolicies({ ...base, age: 40 }).some((p) => p.id === 'POL-004')).toBe(false)
    expect(getEligiblePolicies({ ...base, age: 40, has_children: true, children_ages: [3] }).some((p) => p.id === 'POL-004')).toBe(true)
  })
})

describe('demographicMismatch (인구통계 하드 게이트)', () => {
  it('청년 전용 정책은 72세에게 미스매치', () => {
    expect(demographicMismatch('청년월세 특별지원', '만 19~34세 청년', senior)).toBe(true)
    expect(demographicMismatch('청년월세 특별지원', '만 19~34세 청년', youth)).toBe(false)
  })
  it('노인 전용 정책은 30세에게 미스매치', () => {
    expect(demographicMismatch('노인맞춤돌봄서비스', '만 65세 이상', base)).toBe(true)
    expect(demographicMismatch('노인맞춤돌봄서비스', '만 65세 이상', senior)).toBe(false)
  })
  it('유아·보육 정책은 자녀 없으면 미스매치', () => {
    expect(demographicMismatch('영유아보육료 지원', '어린이집', senior)).toBe(true)
    expect(demographicMismatch('영유아보육료 지원', '어린이집', newborn)).toBe(false)
  })
  it('고용장려금(사업주 대상)은 항상 개인 미스매치', () => {
    expect(demographicMismatch('고령자 고용장려금', '사업주 지원', senior)).toBe(true)
  })
  it('대상어 없는 보편 정책은 미스매치 아님', () => {
    expect(demographicMismatch('국민기초생활보장 생계급여', '중위소득 32% 이하', senior)).toBe(false)
  })
})

describe('checkPolicy 소득 정밀 선정기준 (2026: 생계32·의료40·주거48·교육/차상위50)', () => {
  const at = (pct: number): UserProfile => ({ ...base, income_percentile: pct })
  const mk = (eligibility: string): Policy => ({
    id: 'T', name: '테스트복지', category: '저소득', target: eligibility, benefit: '',
    eligibility, required_docs: [], application: '', department: '', renewal: '',
  })
  it('생계급여(32%): 32% 적격, 33% 부적격', () => {
    expect(checkPolicy(mk('중위소득 32% 이하'), at(32)).eligible).toBe(true)
    expect(checkPolicy(mk('중위소득 32% 이하'), at(33)).eligible).toBe(false)
  })
  it('의료급여(40%): 40% 적격, 41% 부적격 (이전엔 30% 초과면 누락되던 구간)', () => {
    expect(checkPolicy(mk('의료급여 수급자'), at(40)).eligible).toBe(true)
    expect(checkPolicy(mk('의료급여 수급자'), at(41)).eligible).toBe(false)
  })
  it('주거급여(48%): 48% 적격, 49% 부적격', () => {
    expect(checkPolicy(mk('주거급여 대상'), at(48)).eligible).toBe(true)
    expect(checkPolicy(mk('주거급여 대상'), at(49)).eligible).toBe(false)
  })
  it('교육급여·차상위(50%): 50% 적격, 51% 부적격', () => {
    expect(checkPolicy(mk('차상위계층'), at(50)).eligible).toBe(true)
    expect(checkPolicy(mk('차상위계층'), at(51)).eligible).toBe(false)
  })
  it('포괄형(생계·의료·주거·교육급여)은 가장 넓은 50% 기준 적용', () => {
    expect(checkPolicy(mk('생계·의료·주거·교육급여 수급자'), at(50)).eligible).toBe(true)
    expect(checkPolicy(mk('생계·의료·주거·교육급여 수급자'), at(51)).eligible).toBe(false)
  })
  it('한부모(중위 65%, 2026 확대): 65% 적격, 66% 부적격', () => {
    expect(checkPolicy(mk('중위소득 65% 이하 한부모'), at(65)).eligible).toBe(true)
    expect(checkPolicy(mk('중위소득 65% 이하 한부모'), at(66)).eligible).toBe(false)
  })
  it('중위 60% 정책: 60% 적격, 61% 부적격(63%로 과대포함하던 것 정밀화)', () => {
    expect(checkPolicy(mk('중위소득 60% 이하'), at(60)).eligible).toBe(true)
    expect(checkPolicy(mk('중위소득 60% 이하'), at(61)).eligible).toBe(false)
  })
})

describe('sidoOf (시·도 정규화 — 지자체 지역 필터용)', () => {
  it('정식 명칭/별칭/축약 모두 동일 코드로', () => {
    expect(sidoOf('서울특별시')).toBe('서울')
    expect(sidoOf('[서울특별시 강남구] 어쩌고')).toBe('서울')
    expect(sidoOf('경기도')).toBe('경기')
    expect(sidoOf('충청남도')).toBe('충남')
    expect(sidoOf('충남')).toBe('충남')
    expect(sidoOf('강원특별자치도')).toBe('강원')
    expect(sidoOf('전북특별자치도')).toBe('전북')
    expect(sidoOf('경상남도')).toBe('경남')
  })
  it('서울과 경기는 다른 코드(타지역 제외 판정)', () => {
    expect(sidoOf('서울특별시')).not.toBe(sidoOf('경기도'))
  })
  it('인식 불가/빈 값은 빈 문자열(필터 미적용 → 데이터 손실 방지)', () => {
    expect(sidoOf('')).toBe('')
    expect(sidoOf('해외')).toBe('')
  })
})

describe('guOf (시·군·구 추출 — 2차 지역 필터용)', () => {
  it('[시도 시군구] 접두사에서 시군구 추출', () => {
    expect(guOf('[서울특별시 강남구] 어르신 지원')).toBe('강남구')
    expect(guOf('[강원특별자치도 철원군] 출산지원금')).toBe('철원군')
    expect(guOf('[경기도 성남시 분당구] 청년')).toBe('성남시') // 첫 하위지역으로 그룹화
  })
  it('시도만 있으면 광역(빈 문자열)', () => {
    expect(guOf('[부산광역시] 청년수당')).toBe('')
  })
  it('접두사 없으면 빈 문자열', () => {
    expect(guOf('만 65세 이상')).toBe('')
    expect(guOf('')).toBe('')
  })
  it('시·군·구로 끝나지 않는 잡값(-, 기타)은 광역(빈값)', () => {
    expect(guOf('[서울특별시 -] 어쩌고')).toBe('')
    expect(guOf('[경기도 전체] 어쩌고')).toBe('')
  })
})

describe('searchPolicies', () => {
  it('키워드 "청년" 검색 결과 존재 + 카테고리/이름 매칭', () => {
    const res = searchPolicies('청년')
    expect(res.length).toBeGreaterThan(0)
    expect(res.some((p) => (p.name + p.category + p.target).includes('청년'))).toBe(true)
  })
  it('limit 옵션 적용', () => {
    expect(searchPolicies('지원', { limit: 3 }).length).toBeLessThanOrEqual(3)
  })
})

describe('estimateBenefits / runAnalysis', () => {
  it('노인 추정 결과 1건 이상', () => {
    expect(estimateBenefits(senior).eligible_count).toBeGreaterThan(0)
  })
  it('runAnalysis 결과 형태 + 월 합계 추정', () => {
    const r = runAnalysis(senior)
    expect(r.eligible_policies.length).toBeGreaterThan(0)
    expect(r.application_guides.length).toBeGreaterThan(0)
    expect(Array.isArray(r.required_docs)).toBe(true)
    expect(r.portfolio_summary.total_policies).toBe(r.eligible_policies.length)
    expect((r.portfolio_summary.total_monthly ?? 0)).toBeGreaterThan(0)
  })
  it('출산 프로필 → 출산 관련 알림 생성', () => {
    expect(runAnalysis(newborn).notifications.length).toBeGreaterThan(0)
  })
})
