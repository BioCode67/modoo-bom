import { describe, it, expect } from 'vitest'
import { runAnalysis, checkPolicy, type UserProfile } from '@/lib/welfare-engine'
import { WELFARE_POLICIES } from '@/data/policies'

const P = (o: Partial<UserProfile>): UserProfile => ({
  name: '', age: 40, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 50, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [], ...o,
})
const find = (id: string) => WELFARE_POLICIES.find((p) => p.id === id)!

describe('false-negative 수정 검증', () => {
  it('에너지바우처: 78세 독거 수급자(22%)에게 이제 노출(비임신인데 임산부 게이트로 탈락하던 것)', () => {
    const senior = P({ age: 78, income_percentile: 22, household_type: '노인가구' })
    const r = checkPolicy(find('POL-020'), senior)
    expect(r.eligible).toBe(true)
  })
  it('에너지바우처 정직성: 고소득 노인(수급 아님, 90%)에겐 노출 안 됨(false-positive 방지)', () => {
    const rich = P({ age: 78, income_percentile: 90, household_type: '노인가구' })
    expect(checkPolicy(find('POL-020'), rich).eligible).toBe(false)
  })
  it('에너지바우처 정직성: 취약구성원 없는 30세 단독 수급자(22%)엔 노출 안 됨', () => {
    const single = P({ age: 30, income_percentile: 22, household_type: '1인가구' })
    expect(checkPolicy(find('POL-020'), single).eligible).toBe(false)
  })
  it('긴급복지 생계지원: 질병 위기·재직·45%에게 이제 노출(실직 아니라 탈락하던 것)', () => {
    const crisis = P({ age: 47, income_percentile: 45, life_events: ['질병'] })
    expect(checkPolicy(find('POL-023'), crisis).eligible).toBe(true)
  })
  it('긴급복지 정직성: 위기 신호 없는 일반 저소득(45%)엔 실직 아니면 노출 안 됨', () => {
    const normal = P({ age: 47, income_percentile: 45, life_events: [] })
    expect(checkPolicy(find('POL-023'), normal).eligible).toBe(false)
  })
  it('긴급복지 정직성: 고소득 위기자(90%)엔 노출 안 됨', () => {
    const rich = P({ age: 47, income_percentile: 90, life_events: ['질병'] })
    expect(checkPolicy(find('POL-023'), rich).eligible).toBe(false)
  })
})

describe('2차 감사 — 장애 자녀 신호(위저드 입력) FN 구제', () => {
  // 비장애 부모가 위저드로 '장애아 자녀'를 선택 → 발달재활·발달장애인 부모 지원이 노출돼야 함.
  const parent = P({ age: 40, income_percentile: 50, has_children: true, children_ages: [7], life_events: ['장애아 자녀'] })
  it('발달재활(POL-021): 위저드 장애아 자녀 신호로 노출', () => {
    expect(checkPolicy(find('POL-021'), parent).eligible).toBe(true)
  })
  it('발달장애인 부모 심리지원(POL-091): 부모가 비장애여도 장애 자녀로 노출', () => {
    expect(checkPolicy(find('POL-091'), parent).eligible).toBe(true)
  })
  it('자연어 경로 호환: life_events "장애아동"(parseQuery)도 동일 노출', () => {
    const nl = P({ age: 40, income_percentile: 50, has_children: true, children_ages: [7], life_events: ['장애아동'] })
    expect(checkPolicy(find('POL-021'), nl).eligible).toBe(true)
  })
  it('정직성: 장애 자녀 신호 없는 일반 부모(자녀 비장애)에겐 발달장애인 부모 지원 노출 안 됨', () => {
    const plain = P({ age: 40, income_percentile: 50, has_children: true, children_ages: [7], life_events: [] })
    expect(checkPolicy(find('POL-091'), plain).eligible).toBe(false)
    expect(checkPolicy(find('POL-021'), plain).eligible).toBe(false)
  })
})

describe('2차 감사 — 과추천(FP) 저신뢰 격하 정직성', () => {
  it('청년 전세대출(POL-027): 대출이라 high가 아닌 low로만 노출', () => {
    const youth = P({ age: 28, income_percentile: 60 })
    const r = checkPolicy(find('POL-027'), youth)
    // 노출은 되되(관련 복지) 강력추천은 아니어야
    if (r.eligible) expect(r.priority).toBe('low')
  })
  it('청년 창업 지원(POL-111): 선발·경쟁형이라 강력추천(high) 아님', () => {
    const youth = P({ age: 30, income_percentile: 60 })
    const r = checkPolicy(find('POL-111'), youth)
    if (r.eligible) expect(r.priority).not.toBe('high')
  })
  it('노인 장기요양(POL-025): 요양등급 필요라 65세만으론 high 아님(medium 이하)', () => {
    const senior = P({ age: 70, income_percentile: 50 })
    const r = checkPolicy(find('POL-025'), senior)
    if (r.eligible) expect(r.priority).not.toBe('high')
  })
  it('노인돌봄 바우처(POL-094): 기능제한 요건이라 high 아님', () => {
    const senior = P({ age: 70, income_percentile: 50 })
    const r = checkPolicy(find('POL-094'), senior)
    if (r.eligible) expect(r.priority).not.toBe('high')
  })
  it('기초연금(POL-001): 돌봄 서비스 아님 — 어르신에게 여전히 high 유지(과격하 방지)', () => {
    const senior = P({ age: 70, income_percentile: 30 })
    const r = checkPolicy(find('POL-001'), senior)
    expect(r.eligible).toBe(true)
    expect(r.priority).toBe('high')
  })
  it('셋째아 양육비(POL-036): 자녀 2명 가구엔 노출 안 됨(셋째 전용)', () => {
    const two = P({ age: 38, income_percentile: 60, has_children: true, children_ages: [4, 7], household_type: '2자녀' })
    expect(checkPolicy(find('POL-036'), two).eligible).toBe(false)
  })
  it('셋째아 양육비(POL-036): 자녀 3명 가구엔 노출', () => {
    const three = P({ age: 38, income_percentile: 60, has_children: true, children_ages: [2, 5, 8] })
    expect(checkPolicy(find('POL-036'), three).eligible).toBe(true)
  })
})
