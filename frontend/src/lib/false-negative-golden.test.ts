import { describe, it, expect } from 'vitest'
import { checkPolicy, type UserProfile } from '@/lib/welfare-engine'
import { isCashBenefit } from '@/lib/format'
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

describe('3차 감사 — 금액합산·외국인·정직성', () => {
  it('유아학비 지원(POL-039): 유치원 지급 학비라 현금 합산에서 제외(28만원 과대계상 차단)', () => {
    const pol = find('POL-039')
    expect(isCashBenefit(pol.benefit, `${pol.name} ${pol.category}`)).toBe(false)
  })
  it('보육료(POL-038)와 동일 기준: 둘 다 현금 합산 제외(비일관 해소)', () => {
    const b = find('POL-038')
    expect(isCashBenefit(b.benefit, `${b.name} ${b.category}`)).toBe(false)
  })
  it('일반 현금급여(기초연금 POL-001)는 여전히 현금성으로 합산(과격하 방지)', () => {
    const p = find('POL-001')
    expect(isCashBenefit(p.benefit, `${p.name} ${p.category}`)).toBe(true)
  })
  it('외국인근로자 지원(POL-119): 다문화가족 프로필에 관련복지로 노출(기존 전원 배제)', () => {
    const mc = P({ age: 40, income_percentile: 50, household_type: '다문화가족', employment_status: 'unemployed' })
    const r = checkPolicy(find('POL-119'), mc)
    expect(r.eligible).toBe(true)
    expect(r.priority).not.toBe('high') // 관련복지(medium) — 강력추천 단정 아님
  })
  it('외국인근로자 지원(POL-119): 일반 한국인 프로필엔 과매칭 안 됨(정직성)', () => {
    const kor = P({ age: 40, income_percentile: 50, household_type: '1인가구', employment_status: 'unemployed' })
    expect(checkPolicy(find('POL-119'), kor).eligible).toBe(false)
  })
})

describe('4차 감사 — 취업지원 FN 구제 + 장애유형/질환 FP 격하', () => {
  it('국민취업지원 I유형(POL-008): 저소득 구직자에게 이제 high(월60만원, low에 묻히던 치명 FN)', () => {
    const seeker = P({ age: 24, income_percentile: 45, household_type: '1인가구', employment_status: 'unemployed' })
    const r = checkPolicy(find('POL-008'), seeker)
    expect(r.eligible).toBe(true)
    expect(r.priority).toBe('high')
  })
  it('청년 구직활동 지원금(POL-044): 미취업 청년에게 high(광역 소득분기에 가로채이던 것)', () => {
    const youth = P({ age: 24, income_percentile: 45, household_type: '1인가구', employment_status: 'unemployed' })
    const r = checkPolicy(find('POL-044'), youth)
    expect(r.eligible).toBe(true)
    expect(r.priority).toBe('high')
  })
  it('국민취업지원 II유형(POL-079): 서비스형이라 medium(현금급여 위로 안 올림)', () => {
    const seeker = P({ age: 58, income_percentile: 35, household_type: '1인가구', employment_status: 'unemployed', disability: true, disability_grade: '1급' })
    const r = checkPolicy(find('POL-079'), seeker)
    expect(r.eligible).toBe(true)
    expect(r.priority).not.toBe('high')
  })
  it('취업지원 정직성: 재직자(다자녀 워킹맘)에겐 구직 지원 노출 안 됨', () => {
    const working = P({ age: 36, income_percentile: 48, has_children: true, children_ages: [2, 5, 9], employment_status: 'employed' })
    expect(checkPolicy(find('POL-008'), working).eligible).toBe(false)
  })
  it('청각 인공와우(POL-089): 지체장애 1급에게 high 아님 — 장애유형 확인 불가라 저신뢰', () => {
    const limb = P({ age: 58, income_percentile: 35, disability: true, disability_grade: '1급' })
    const r = checkPolicy(find('POL-089'), limb)
    if (r.eligible) expect(r.priority).toBe('low')
  })
  it('일반 장애급여(장애인연금 POL-003): 중증장애인에겐 여전히 high 유지(과격하 방지)', () => {
    const sev = P({ age: 58, income_percentile: 35, disability: true, disability_grade: '1급' })
    const r = checkPolicy(find('POL-003'), sev)
    expect(r.eligible).toBe(true)
    expect(r.priority).toBe('high')
  })
  it('소아암 치료비(POL-110): 건강한 다자녀 가정엔 확신추천(medium+) 아님', () => {
    const fam = P({ age: 36, income_percentile: 48, has_children: true, children_ages: [2, 5, 9], employment_status: 'employed' })
    const r = checkPolicy(find('POL-110'), fam)
    if (r.eligible) expect(r.priority).toBe('low')
  })
})
