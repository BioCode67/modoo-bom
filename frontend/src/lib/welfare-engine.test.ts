import { describe, it, expect } from 'vitest'
import {
  extractKeywords, getEligiblePolicies, searchPolicies,
  estimateBenefits, runAnalysis, checkPolicy, incomeCeiling, situationRelevance, sidoOf, guOf, demographicMismatch, disabilityLabel, type UserProfile,
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
  it('감사 회귀: 부모급여(POL-005)는 만 0~1세만 — 만 2세 자녀엔 오추천 안 됨', () => {
    const age1: UserProfile = { ...base, age: 33, has_children: true, children_ages: [1] }
    const age2: UserProfile = { ...base, age: 33, has_children: true, children_ages: [2] }
    expect(getEligiblePolicies(age1).some((p) => p.id === 'POL-005')).toBe(true)
    expect(getEligiblePolicies(age2).some((p) => p.id === 'POL-005')).toBe(false)
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
  it('저소득 가구 → 근로장려금(POL-122) 포함, 고소득은 제외', () => {
    expect(getEligiblePolicies({ ...base, income_percentile: 40 }).some((p) => p.id === 'POL-122')).toBe(true)
    expect(getEligiblePolicies({ ...base, income_percentile: 130 }).some((p) => p.id === 'POL-122')).toBe(false)
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
  it('농어촌 전용 지원은 대도시(광역시) 거주자에겐 미스매치, 도(道)·미지정은 유지', () => {
    const nm = '농어촌 출산지원금'
    expect(demographicMismatch(nm, nm, { ...base, region: '서울', is_pregnant: true })).toBe(true)
    expect(demographicMismatch(nm, nm, { ...base, region: '부산', is_pregnant: true })).toBe(true)
    expect(demographicMismatch(nm, nm, { ...base, region: '경기', is_pregnant: true })).toBe(false)
    expect(demographicMismatch(nm, nm, { ...base, region: '', is_pregnant: true })).toBe(false)
  })
  it('여성 전용 급여(생리용품·여성청소년)는 남성에게만 미스매치(other/female은 포용)', () => {
    const nm = '여성 청소년 생리용품 바우처'
    expect(demographicMismatch(nm, nm, { ...base, gender: 'male', age: 15 })).toBe(true)
    expect(demographicMismatch(nm, nm, { ...base, gender: 'female', age: 15 })).toBe(false)
    expect(demographicMismatch(nm, nm, { ...base, gender: 'other', age: 15 })).toBe(false)
    // 남성이라도 일반 정책은 과배제하지 않음
    expect(demographicMismatch('청년 월세 지원', '청년', { ...base, gender: 'male', age: 26 })).toBe(false)
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

describe('소득 상한 게이트 — 연령이 맞아도 소득 초과면 제외(현실성 핵심)', () => {
  it('회귀: 하위70%(기초연금)를 중위70으로 오인해 중위 80% 어르신을 배제하지 않음', () => {
    const r = getEligiblePolicies({ ...base, age: 72, income_percentile: 80 })
    expect(r.some((p) => p.id === 'POL-001')).toBe(true) // 기초연금 유지
    // 반대로 명백한 초과(중위 150%)는 제외
    const rich = getEligiblePolicies({ ...base, age: 72, income_percentile: 150 })
    expect(rich.some((p) => p.id === 'POL-001')).toBe(false)
  })

  const mk = (eligibility: string, name = '테스트'): Policy => ({
    id: 'T', name, category: '기타', target: eligibility, benefit: '',
    eligibility, required_docs: [], application: '', department: '', renewal: '',
  })
  const youth = (pct: number): UserProfile => ({ ...base, age: 26, income_percentile: pct })

  it('청년(연령 충족)이라도 "중위소득 80% 이하" 정책은 90%면 제외', () => {
    const doc = '만 19~34세 청년, 기준 중위소득 80% 이하'
    expect(checkPolicy(mk(doc, '저소득 청년 지원'), youth(80)).eligible).toBe(true)
    expect(checkPolicy(mk(doc, '저소득 청년 지원'), youth(90)).eligible).toBe(false)
  })
  it('"중위소득 100% 이하"는 90%면 그대로 적격(과배제 안 함)', () => {
    const doc = '만 19~34세, 기준 중위소득 100% 이하'
    expect(checkPolicy(mk(doc, '청년 자산형성'), youth(90)).eligible).toBe(true)
    expect(checkPolicy(mk(doc, '청년 자산형성'), youth(120)).eligible).toBe(false)
  })
  it('여러 % 표기면 가장 관대한(높은) 상한 적용', () => {
    const doc = '만 19~34세, 개인소득 조건, 가구 중위소득 180% 이하 (일부 50%)'
    expect(checkPolicy(mk(doc, '청년 주거'), youth(150)).eligible).toBe(true)
    expect(checkPolicy(mk(doc, '청년 주거'), youth(180)).eligible).toBe(true)
  })
  it('소득 상한 문구가 없으면 게이트 없음(연령만으로 판정)', () => {
    expect(incomeCeiling('만 19~34세 청년 누구나')).toBe(null)
    expect(checkPolicy(mk('만 19~34세 청년 누구나', '보편 청년'), youth(150)).eligible).toBe(true)
  })
  it('incomeCeiling: 차상위=50, 기초생활=50, 하위 70%→중위 100(×1.4 환산)', () => {
    expect(incomeCeiling('차상위계층 대상')).toBe(50)
    expect(incomeCeiling('기초생활수급자')).toBe(50)
    // '하위 N%'는 백분위 → 중위% 근사 환산(×1.4): 기초연금 하위70% ≈ 중위 96~98(2026 실측 앵커)
    expect(incomeCeiling('소득 하위 70% 어르신')).toBe(100)
    expect(incomeCeiling('기준 중위소득 80% 이하')).toBe(80)
  })
  it('회귀: %가 없는 "수급 가구" 문구도 저소득 상한(50)으로 인식(에너지바우처 누수 차단)', () => {
    expect(incomeCeiling('생계·의료급여 수급 가구')).toBe(50)
    expect(incomeCeiling('수급자 대상')).toBe(50)
    // 명시 %가 있으면 그 값이 우선(수급 문구가 있어도 과배제 안 함)
    expect(incomeCeiling('하위 70% 어르신(수급자 포함)')).toBe(100)
  })
  it('감사 회귀: 부정어 "미수급자"·우대 "수급자 우선"은 소득상한 아님(자격자 오배제 방지)', () => {
    // '미수급자'(다른 급여를 안 받는 사람, 소득 무관) 안의 '수급자'가 ceil=50으로 오독되던 버그
    expect(incomeCeiling('장애인 활동지원 미수급자 대상')).toBe(null)
    // '수급자 우선'은 우대일 뿐 하드 요건 아님
    expect(incomeCeiling('만 65세 이상 (공익활동형은 기초연금 수급자 우선)')).toBe(null)
    // 진짜 저소득 요건은 여전히 게이트
    expect(incomeCeiling('생계급여 수급 가구')).toBe(50)
  })
  it('감사 회귀: 노인일자리(POL-010)는 소득 60%ile 66세도 포함(수급자 우선 오게이트 제거)', () => {
    const p = runAnalysis({ ...base, age: 66, income_percentile: 60 }).eligible_policies
    expect(p.some((x) => x.id === 'POL-010')).toBe(true)
  })
})

describe('감사 반영 — 인구통계/소득 게이트 우회 차단 (2026-07-05)', () => {
  it('첫만남이용권(출생지원)은 자녀 없는 성인에게 뜨지 않고, 0세 부모에겐 뜬다', () => {
    const childless = runAnalysis({ ...base, age: 61, income_percentile: 90 }).eligible_policies
    expect(childless.some((p) => /첫만남/.test(p.name))).toBe(false)
    const newborn = runAnalysis({ ...base, age: 32, has_children: true, children_ages: [0] }).eligible_policies
    expect(newborn.some((p) => /첫만남/.test(p.name))).toBe(true)
  })
  it('에너지바우처(수급 가구)는 고소득(중위200%)에게 안 뜨고, 저소득 임신부에겐 뜬다', () => {
    const rich = runAnalysis({ ...base, age: 32, is_pregnant: true, income_percentile: 200 }).eligible_policies
    expect(rich.some((p) => /에너지바우처/.test(p.name))).toBe(false)
    const poor = runAnalysis({ ...base, age: 32, is_pregnant: true, income_percentile: 30 }).eligible_policies
    expect(poor.some((p) => /에너지바우처/.test(p.name))).toBe(true)
  })
  it('유아학비(유치원 만3~5세)는 8세 자녀 부모에겐 안 뜨고, 4세 부모에겐 뜬다', () => {
    const school = runAnalysis({ ...base, age: 40, has_children: true, children_ages: [8] }).eligible_policies
    expect(school.some((p) => /유아학비/.test(p.name))).toBe(false)
    const kinder = runAnalysis({ ...base, age: 40, has_children: true, children_ages: [4] }).eligible_policies
    expect(kinder.some((p) => /유아학비/.test(p.name))).toBe(true)
  })
  it('근로장려금(EITC)은 무직 명시자에겐 안 권하고, 일반/미지정에겐 뜬다', () => {
    const jobless = runAnalysis({ ...base, age: 40, employment_status: 'unemployed', income_percentile: 80 }).eligible_policies
    expect(jobless.some((p) => /근로장려금/.test(p.name))).toBe(false)
    const worker = runAnalysis({ ...base, age: 40, income_percentile: 80 }).eligible_policies
    expect(worker.some((p) => /근로장려금/.test(p.name))).toBe(true)
  })
})

describe('situationRelevance — 핵심 상황 우선 개인화', () => {
  const mk = (name: string, category = '기타'): Policy => ({
    id: 'T', name, category, target: '', benefit: '', eligibility: '',
    required_docs: [], application: '', department: '', renewal: '',
  })
  it('장애인은 장애 정책에 가점, 부수적 청년 정책엔 0', () => {
    const p: UserProfile = { ...base, age: 26, disability: true, disability_grade: '1급' }
    expect(situationRelevance(mk('장애인연금'), p)).toBeGreaterThan(situationRelevance(mk('청년 도약계좌'), p))
  })
  it('영아 부모는 육아·출산 정책이 청년 정책보다 높은 관련도', () => {
    const p: UserProfile = { ...base, age: 33, has_children: true, children_ages: [0] }
    expect(situationRelevance(mk('부모급여'), p)).toBeGreaterThan(situationRelevance(mk('청년 월세 지원'), p))
  })
  it('해당 상황이 아니면 가점 없음(무관 정책)', () => {
    expect(situationRelevance(mk('장애인연금'), base)).toBe(0)
  })
  it('정렬: 장애인 결과에서 장애 정책이 부수적 청년 정책보다 앞', () => {
    const p: UserProfile = { ...base, age: 26, disability: true, disability_grade: '1급', income_percentile: 30 }
    const list = getEligiblePolicies(p)
    const iDis = list.findIndex((x) => /장애인연금/.test(x.name))
    const iYouth = list.findIndex((x) => /청년.*도약계좌|청년.*내일저축/.test(x.name))
    if (iDis !== -1 && iYouth !== -1) expect(iDis).toBeLessThan(iYouth)
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
  it('감사 회귀: 자녀 나이 미상([])이면 신생아 전용(부모급여·첫만남)이 강력추천되지 않음', () => {
    // 자리표시 0세가 신생아로 둔갑해 10살 자녀 부모에게 부모급여가 추천되던 실버그(감사 실측) 방지
    const unknown = getEligiblePolicies({ ...base, age: 42, has_children: true, children_ages: [] })
    expect(unknown.some((p) => p.id === 'POL-005')).toBe(false) // 부모급여(0~1세 전용)
    expect(unknown.map((p) => p.name).join(' ')).not.toMatch(/첫만남/)
    // 진짜 0세(출산 상황)는 정상 추천 유지
    const newbornP = getEligiblePolicies({ ...base, age: 32, has_children: true, children_ages: [0], life_events: ['출산'] })
    expect(newbornP.some((p) => p.id === 'POL-005')).toBe(true)
  })
  it('감사 회귀: 조손가구도 한부모가족 급여(아동양육비 등) 대상에 포함', () => {
    const grand = getEligiblePolicies({ ...base, age: 68, household_type: '조손가구', income_percentile: 40, has_children: true, children_ages: [10] })
    expect(grand.map((p) => p.name).join(' ')).toMatch(/한부모|양육비/)
    // 일반가구엔 여전히 미노출
    const plain = getEligiblePolicies({ ...base, age: 40, income_percentile: 40 })
    expect(plain.map((p) => p.name).join(' ')).not.toMatch(/한부모가족 아동양육비/)
  })
  it('감사 회귀: 상위권 소득(중위 180%)에겐 서민금융(FIN) 미노출', () => {
    const rich = getEligiblePolicies({ ...base, age: 27, income_percentile: 180, employment_status: 'employed' })
    expect(rich.some((p) => p.id.startsWith('FIN-'))).toBe(false)
  })
  it('신규 모집 종료 정책은 추천에서 제외 — "신청할 수 있는 것만" 원칙(청년도약계좌 → 후속 청년미래적금)', () => {
    // 26세 청년: 연령은 도약계좌(POL-040)에 맞지만 신규가입 종료라 신청 불가 → 제외, 후속(POL-121)은 노출
    const r = getEligiblePolicies({ ...base, age: 26, income_percentile: 60 })
    expect(r.some((p) => p.id === 'POL-040')).toBe(false)
    expect(r.some((p) => p.id === 'POL-121')).toBe(true)
  })
  it('에이전트 요약문 숫자 = 화면 헤더(맞춤 추천/강력 추천)와 일치(불일치 신뢰붕괴 방지)', () => {
    // 요약문의 "맞춤 복지 N건 / 강력 추천 M건"이 ResultsView 헤더의 primary/highCount와 같아야 한다.
    const r = runAnalysis(senior)
    const primary = r.eligible_policies.filter((p) => /^POL-/.test(p.id))
    const high = primary.filter((p) => p.priority === 'high')
    const fr = r.final_response
    expect(fr).toContain(`맞춤 복지 ${primary.length}건`)
    expect(fr).toContain(`강력 추천이 ${high.length}건`)
    // 낡은 '수혜 가능 정책 N건'(전체 분모) 표현이 남아있지 않아야 함
    expect(fr).not.toContain('수혜 가능 정책')
  })
})

describe('disabilityLabel — 현행 장애 체계 표시(2019 등급제 폐지)', () => {
  it('구 중증등급(1~3급) → 심한 장애', () => {
    for (const g of ['1급', '2급', '3급', '1']) expect(disabilityLabel(g)).toContain('심한 장애')
  })
  it('구 경증등급(4~6급) → 심하지 않은 장애', () => {
    for (const g of ['4급', '5급', '6급']) expect(disabilityLabel(g)).toContain('심하지 않은 장애')
  })
  it('발달장애 유형은 유형명으로', () => {
    expect(disabilityLabel('지적')).toBe('지적장애')
    expect(disabilityLabel('자폐')).toBe('자폐성장애')
  })
  it('빈값 → 일반 안내, 알 수 없는 값 → 원문 유지', () => {
    expect(disabilityLabel('')).toBe('등록 장애')
    expect(disabilityLabel('기타')).toBe('기타')
  })
})

describe('감사 수정 회귀 — 자격자 오배제 방지(2026-07)', () => {
  const mk = (eligibility: string, name = '테스트'): Policy => ({
    id: 'T', name, category: '기타', target: eligibility, benefit: '',
    eligibility, required_docs: [], application: '', department: '', renewal: '',
  })
  it("'만 0~5세' 정책은 만 3~5세 자녀도 포함(a<6) — 보육료 오배제 방지", () => {
    const p4 = { ...base, has_children: true, children_ages: [4] }
    expect(checkPolicy(mk('만 0~5세 취학 전 자녀', '보육료 지원'), p4).eligible).toBe(true)
    // '만 0~2세' 전용은 4세 제외(broaden 과잉 아님)
    expect(checkPolicy(mk('만 0~2세', '둘째 돌봄'), p4).eligible).toBe(false)
  })
  it('중증장애인 정책은 지적·자폐(법상 항상 중증)도 포함, 경증(4급)은 제외', () => {
    expect(checkPolicy(mk('중증장애인 대상', '장애인연금'), { ...base, disability: true, disability_grade: '지적' }).eligible).toBe(true)
    expect(checkPolicy(mk('중증장애인 대상', '장애인연금'), { ...base, disability: true, disability_grade: '자폐' }).eligible).toBe(true)
    expect(checkPolicy(mk('중증장애인 대상', '장애인연금'), { ...base, disability: true, disability_grade: '4급' }).eligible).toBe(false)
  })
  it("'만 15세 이상'(상한 없음)은 70세 이상도 포함, '만 15~69세'는 72세 제외", () => {
    expect(checkPolicy(mk('만 15세 이상 국민', '국민내일배움카드'), { ...base, age: 72 }).eligible).toBe(true)
    expect(checkPolicy(mk('만 15~69세', '일반 훈련'), { ...base, age: 72 }).eligible).toBe(false)
  })
})

describe('3차 감사 수정 회귀(2026-07)', () => {
  const mk = (eligibility: string, name = '테스트'): Policy => ({
    id: 'T', name, category: '기타', target: eligibility, benefit: '',
    eligibility, required_docs: [], application: '', department: '', renewal: '',
  })
  it("'차상위 우선/우대'는 소득상한이 아님(우대 선정) — 51~100%ile 오배제 방지", () => {
    expect(incomeCeiling('만 65세 이상 (차상위 우선)')).toBe(null)
    expect(incomeCeiling('저소득 어르신 (기초생활수급자·차상위 우대)')).toBe(null)
    // '차상위 이하'(하드 요건)는 그대로 상한 50
    expect(incomeCeiling('차상위 이하 가구')).toBe(50)
  })
  it("'만 13~34세'(가족돌봄청년) 연령 룰 매칭 — dead data 해소", () => {
    expect(checkPolicy(mk('만 13~34세 가족돌봄청년', '영케어러 지원'), { ...base, age: 20 }).eligible).toBe(true)
    expect(checkPolicy(mk('만 13~34세', '영케어러 지원'), { ...base, age: 40 }).eligible).toBe(false)
  })
})

describe('POL 결과 이름 정확중복 제거(2026-07 데이터위생)', () => {
  // 시드에 동일명 2건(POL-012/059 한부모 아동양육비 등)이 함께 뜨는 중복카드 방지 — 어떤 프로필에서도 POL- 정규화이름은 유일해야
  const profiles: UserProfile[] = [
    { ...base, age: 34, household_type: '한부모가족', has_children: true, children_ages: [7], income_percentile: 45 },
    senior, youth, newborn, disabled,
    { ...base, age: 40, household_type: '한부모가족', has_children: true, children_ages: [3, 10], income_percentile: 40, employment_status: 'unemployed', life_events: ['실직'] },
  ]
  for (const p of profiles) {
    it(`중복 없음 — age${p.age}/${p.household_type || '무'}`, () => {
      const pol = getEligiblePolicies(p).filter((x) => x.id.startsWith('POL-'))
      const names = pol.map((x) => x.name.replace(/\s+/g, ''))
      expect(names.length).toBe(new Set(names).size)
    })
  }
})

describe('프로그램 중복 그룹 접기(2026 데이터검증)', () => {
  const count = (p: UserProfile, re: RegExp) =>
    getEligiblePolicies(p).filter((x) => x.id.startsWith('POL-') && re.test(x.name)).length
  const lowIncome: UserProfile = { ...base, age: 40, income_percentile: 30, household_type: '한부모가족', has_children: true, children_ages: [10], is_pregnant: true, disability: true, disability_grade: '1급', life_events: ['실직'] }
  it('문화누리·임신출산진료비·청소년특별·긴급복지·활동지원은 각 최대 1건', () => {
    expect(count(lowIncome, /문화누리|통합문화이용권/)).toBeLessThanOrEqual(1)
    expect(count(lowIncome, /임신.?출산\s*진료비/)).toBeLessThanOrEqual(1)
    expect(count(lowIncome, /청소년\s*특별지원/)).toBeLessThanOrEqual(1)
    expect(count(lowIncome, /긴급복지지원/)).toBeLessThanOrEqual(1)
    expect(count(lowIncome, /장애인\s*활동지원/)).toBeLessThanOrEqual(1)
  })
  it('노인 틀니·임플란트는 최대 1건(건보급여+지원 중복 접기)', () => {
    const senior: UserProfile = { ...base, age: 66, income_percentile: 30 }
    expect(count(senior, /틀니|임플란트/)).toBeLessThanOrEqual(1)
  })
})
