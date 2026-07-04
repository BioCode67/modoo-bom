// 클라이언트 사이드 복지 엔진 — backend/agents/mock_responses.py + api/routes.py(/estimate) 포팅.
// 백엔드 없이 브라우저에서 동일한 키워드·규칙 기반 로직을 재현한다. 순수 함수, 외부 의존성 없음.
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'
import { isCashBenefit, parseMonthly } from '@/lib/format'

export interface UserProfile {
  name: string
  age: number
  gender: 'male' | 'female' | 'other'
  region: string
  household_type: string
  income_percentile: number
  disability: boolean
  disability_grade: string
  employment_status: string
  has_children: boolean
  children_ages: number[]
  is_pregnant: boolean
  life_events: string[]
}

export interface EligiblePolicy extends Policy {
  reason: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
}

/**
 * 저장된 장애 정도값(엔진 호환용 1급/4급 등)을 현행 체계(심한/심하지 않은 장애) 표시 라벨로 변환.
 * 장애등급제는 2019년 폐지 → 사용자에게는 현행 용어로 보여준다(내부 판정값은 유지).
 */
export function disabilityLabel(grade: string): string {
  const g = (grade || '').trim()
  if (!g) return '등록 장애'
  if (['1급', '2급', '3급', '1', '2', '3'].includes(g)) return '심한 장애(중증)'
  if (['4급', '5급', '6급', '4', '5', '6'].includes(g)) return '심하지 않은 장애(경증)'
  if (g.includes('지적')) return '지적장애'
  if (g.includes('자폐')) return '자폐성장애'
  return g
}

export interface ApplicationGuide {
  policy_id: string
  name: string
  desc: string
  steps: string[]
  tips: string
  estimated_days: number
}

export interface AnalysisResult {
  profile_summary: string
  search_keywords: string[]
  eligible_policies: EligiblePolicy[]
  application_guides: ApplicationGuide[]
  required_docs: string[]
  portfolio_summary: {
    total_monthly?: number
    total_policies: number
    by_category: Record<string, number>
    [k: string]: unknown
  }
  notifications: { title: string; message: string; type?: string }[]
  final_response: string
}

// ── profile_analyzer 포팅: mock_profile_analysis ────────────────────────────
export function extractKeywords(p: UserProfile): { summary: string; keywords: string[] } {
  let keywords: string[] = []

  if (p.age >= 65) {
    keywords = keywords.concat(['기초연금', '노인', '어르신', '장기요양'])
  } else if (p.age >= 60) {
    keywords = keywords.concat(['노인', '60세', '고령자'])
  }
  if (p.age >= 19 && p.age <= 34) {
    keywords = keywords.concat(['청년', '청년지원', '청년취업'])
  }
  if (p.age >= 35 && p.age <= 64) {
    keywords = keywords.concat(['중장년', '재취업'])
  }
  if (p.disability) {
    keywords = keywords.concat(['장애인', '장애', '활동지원'])
  }
  if (p.is_pregnant) {
    keywords = keywords.concat(['임산부', '임신', '출산', '국민행복카드'])
  }
  if (p.has_children) {
    const ages = p.children_ages || []
    if (ages.some((a) => a < 2)) {
      keywords = keywords.concat(['영아', '부모급여', '아동수당'])
    } else if (ages.some((a) => a < 9)) {
      keywords = keywords.concat(['아동수당', '보육료', '유아학비'])
    }
    if (ages.some((a) => a < 18)) {
      keywords = keywords.concat(['아동', '교육급여'])
    }
  }
  if (p.employment_status === 'unemployed') {
    keywords = keywords.concat(['실업급여', '취업지원', '구직', '국민취업지원제도'])
  }
  // 소득 기반 급여 — 2026 정밀 선정기준(생계32·의료40·주거48·교육50·차상위50, medianIncome.ts 기준)
  if (p.income_percentile <= 50) {
    keywords = keywords.concat(['저소득', '교육급여', '차상위'])
    if (p.income_percentile <= 48) keywords = keywords.concat(['주거급여'])
    if (p.income_percentile <= 40) keywords = keywords.concat(['의료급여'])
    if (p.income_percentile <= 32) keywords = keywords.concat(['기초생활', '생계급여'])
  }
  if (p.household_type === '한부모가족' || p.household_type === '조손가구') {
    keywords = keywords.concat(['한부모', '양육비'])
  }
  if (p.household_type === '다문화가족') {
    keywords = keywords.concat(['다문화', '방문교육'])
  }
  const events = p.life_events || []
  if (events.includes('실직')) {
    keywords = keywords.concat(['실업급여', '긴급복지'])
  }
  if (events.includes('출산')) {
    keywords = keywords.concat(['부모급여', '아동수당', '산모신생아'])
  }
  if (events.includes('장애진단')) {
    keywords = keywords.concat(['장애인연금', '활동지원', '장애수당'])
  }
  if (events.includes('질병')) {
    keywords = keywords.concat(['의료', '의료비', '긴급복지'])
  }

  // dict.fromkeys → 순서 보존 중복 제거, fallback, 최대 8개
  let deduped = Array.from(new Set(keywords.length ? keywords : ['복지', '사회보장']))
  deduped = deduped.slice(0, 8)

  const regionNote = p.region ? `, ${p.region} 거주` : ''
  const householdNote = p.household_type ? `, ${p.household_type} 가구` : ''

  const summary =
    `${p.name || '사용자'}님(${p.age}세${regionNote}${householdNote})의 프로필을 분석했습니다. ` +
    `소득수준 기준중위소득 ${p.income_percentile}%로, ` +
    `${p.disability ? '장애인 등록 상태이며 ' : ''}` +
    `${p.is_pregnant ? '임신 중이며 ' : ''}` +
    `맞춤 복지 정책 ${deduped.length}개 키워드로 검색합니다.`

  return { summary, keywords: deduped }
}

// ── eligibility_check 포팅: _check_policy ───────────────────────────────────
// doc 안에서 substring 매칭. if any(k in doc ...) 순서·early-return을 그대로 재현 (첫 매치 승).
function anyIn(doc: string, keys: string[]): boolean {
  return keys.some((k) => doc.includes(k))
}

type CheckResult = {
  eligible: boolean
  reason: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
}

const NO: CheckResult = { eligible: false, reason: '', priority: 'low', confidence: 0.0 }

function checkPolicyDoc(doc: string, name: string, p: UserProfile): CheckResult {
  // ── 노인 계열 ──
  if (anyIn(doc, ['만 65세', '65세 이상', '만65세'])) {
    if (p.age >= 65) return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'high', confidence: 0.95 }
    return NO
  }
  if (anyIn(doc, ['만 60세', '60세 이상', '만60세', '만 66세'])) {
    if (p.age >= 60) return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'medium', confidence: 0.9 }
    return NO
  }

  // ── 청년 계열 ──
  if (anyIn(doc, ['만 19~34세', '19~34세', '만 34세 이하', '19세~34세'])) {
    if (p.age >= 19 && p.age <= 34)
      return { eligible: true, reason: `만 ${p.age}세로 청년 연령 기준 충족`, priority: 'high', confidence: 0.92 }
    return NO
  }
  if (anyIn(doc, ['만 19~39세', '만 39세 이하'])) {
    if (p.age >= 19 && p.age <= 39)
      return { eligible: true, reason: `만 ${p.age}세로 청년 연령 기준 충족`, priority: 'medium', confidence: 0.88 }
    return NO
  }
  if (doc.includes('만 15~34세') || doc.includes('15~34세')) {
    if (p.age >= 15 && p.age <= 34)
      return { eligible: true, reason: `만 ${p.age}세로 청년 연령 기준 충족`, priority: 'high', confidence: 0.9 }
    return NO
  }
  if (anyIn(doc, ['만 9~24세', '9~24세'])) {
    if (p.age >= 9 && p.age <= 24)
      return { eligible: true, reason: `만 ${p.age}세 청소년·청년 기준 충족`, priority: 'high', confidence: 0.88 }
    return NO
  }

  // ── 장애인 계열 ──
  if (doc.includes('중증장애인')) {
    if (p.disability && ['1급', '2급', '1', '2'].includes(p.disability_grade))
      return { eligible: true, reason: `등록 중증장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.93 }
    return NO
  }
  if (doc.includes('발달장애인')) {
    if (p.disability && ['지적', '자폐'].some((g) => (p.disability_grade || '').includes(g)))
      return { eligible: true, reason: `발달장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.91 }
    return NO
  }
  if (doc.includes('등록 장애인') || (doc.includes('장애인') && name.includes('장애'))) {
    if (p.disability)
      return { eligible: true, reason: `등록 장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.92 }
    return NO
  }

  // ── 아동·영유아 계열 ──
  if (doc.includes('만 9세 미만') || doc.includes('만 0~8세') || doc.includes('만 8세 미만') || doc.includes('0세~7세') || doc.includes('만 0~7세')) {
    // 아동수당: 2026년 지급 연령 만 8세 미만 → 9세 미만으로 확대(매년 1세씩 상향)
    if (p.has_children && (p.children_ages || []).some((a) => a < 9))
      return { eligible: true, reason: '만 9세 미만 자녀 보유', priority: 'high', confidence: 0.97 }
    return NO
  }
  if (anyIn(doc, ['만 0~5세', '만 0~2세', '영아', '만 24개월'])) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 3))
      return { eligible: true, reason: '영유아(만 0~5세) 자녀 보유', priority: 'high', confidence: 0.96 }
    return NO
  }
  if (doc.includes('만 12세 이하')) {
    if (p.has_children && (p.children_ages || []).some((a) => a <= 12))
      return { eligible: true, reason: '만 12세 이하 자녀 보유', priority: 'medium', confidence: 0.9 }
    return NO
  }
  if (doc.includes('만 18세 미만') && doc.includes('아동')) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 18))
      return { eligible: true, reason: '만 18세 미만 자녀 보유', priority: 'medium', confidence: 0.88 }
    return NO
  }

  // ── 임산부·출산 계열 ──
  if (anyIn(doc, ['임산부', '임신', '임신확인'])) {
    if (p.is_pregnant) return { eligible: true, reason: '임신 중 확인', priority: 'high', confidence: 0.96 }
    return NO
  }
  if (doc.includes('출산') && anyIn(doc, ['산모', '출생', '출생 후'])) {
    if (p.is_pregnant || (p.has_children && (p.children_ages || []).some((a) => a === 0)))
      return { eligible: true, reason: '출산(예정) 가정 조건 충족', priority: 'high', confidence: 0.94 }
    return NO
  }

  // 근로·자녀장려금(EITC/CTC) — 중위소득%가 아닌 절대 총소득 기준이라 별도 매칭(저소득 근로가구).
  if (anyIn(doc, ['근로장려금', '자녀장려금', 'EITC'])) {
    if (p.income_percentile <= 100)
      return { eligible: true, reason: `저소득 근로·사업 가구로 ${name.includes('자녀') ? '자녀장려금' : '근로장려금'} 신청 대상이에요(소득·재산 요건은 국세청에서 확인)`, priority: 'medium', confidence: 0.8 }
    return NO
  }

  // ── 저소득·기초생활 계열 (2026 정밀 선정기준: 생계32·의료40·주거48·교육/차상위50, medianIncome.ts) ──
  // 여러 급여를 동시에 언급하는 포괄형 정책은 가장 넓은 기준이 적용되도록 넓은 순서로 검사.
  if (anyIn(doc, ['교육급여', '차상위', '중위소득 50%'])) {
    if (p.income_percentile <= 50)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 교육급여·차상위 기준 충족`, priority: 'medium', confidence: 0.84 }
    return NO
  }
  if (anyIn(doc, ['주거급여', '중위소득 48%'])) {
    if (p.income_percentile <= 48)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 주거급여 기준 충족`, priority: 'medium', confidence: 0.85 }
    return NO
  }
  if (anyIn(doc, ['의료급여', '중위소득 40%'])) {
    if (p.income_percentile <= 40)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 의료급여 기준 충족`, priority: 'high', confidence: 0.86 }
    return NO
  }
  if (anyIn(doc, ['생계급여', '기초생활수급자', '중위소득 30%', '중위소득 32%'])) {
    if (p.income_percentile <= 32)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 생계급여(기초생활) 기준 충족`, priority: 'high', confidence: 0.87 }
    return NO
  }
  // 중위소득 65/63/60% — 한부모(2026년 65%로 확대) 등. 넓은 기준 순서로 정밀 검사.
  if (anyIn(doc, ['중위소득 65%'])) {
    if (p.income_percentile <= 65)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기준 충족`, priority: 'medium', confidence: 0.82 }
    return NO
  }
  if (anyIn(doc, ['중위소득 63%'])) {
    if (p.income_percentile <= 63)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기준 충족`, priority: 'medium', confidence: 0.82 }
    return NO
  }
  if (anyIn(doc, ['중위소득 60%'])) {
    if (p.income_percentile <= 60)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기준 충족`, priority: 'medium', confidence: 0.82 }
    return NO
  }
  if (anyIn(doc, ['중위소득 120%', '중위소득 150%', '중위소득 180%'])) {
    if (p.income_percentile <= 180)
      return { eligible: true, reason: `소득 기준 충족 (중위소득 ${p.income_percentile}%)`, priority: 'low', confidence: 0.75 }
    return NO
  }

  // ── 실직·취업 계열 ──
  if (anyIn(doc, ['비자발적 이직', '실직', '비자발적 실직자'])) {
    if (p.employment_status === 'unemployed')
      return { eligible: true, reason: '실직/비자발적 이직으로 신청 자격 있음', priority: 'high', confidence: 0.85 }
    return NO
  }
  if (anyIn(doc, ['구직 중', '미취업', '미취업 청년'])) {
    if (p.employment_status === 'unemployed')
      return { eligible: true, reason: '미취업 상태로 신청 자격 있음', priority: 'medium', confidence: 0.82 }
    return NO
  }

  // ── 한부모 계열 ──
  if (doc.includes('한부모가족') || doc.includes('한부모')) {
    if (p.household_type === '한부모가족' || p.household_type === '한부모')
      return { eligible: true, reason: '한부모가족 확인', priority: 'high', confidence: 0.93 }
    return NO
  }

  // ── 다문화 계열 ──
  if (anyIn(doc, ['다문화가족', '결혼이민자', '귀화자'])) {
    if (p.household_type === '다문화가족')
      return { eligible: true, reason: '다문화가족 확인', priority: 'medium', confidence: 0.9 }
    return NO
  }

  // ── 소득 무관 보편 서비스 ──
  if (doc.includes('소득무관') || doc.includes('소득·재산 무관')) {
    return { eligible: true, reason: '소득 무관 전국민 지원 서비스', priority: 'medium', confidence: 0.8 }
  }

  // ── 연령 무관 일반 지원 ──
  if (anyIn(doc, ['만 15~69세', '만 15세 이상'])) {
    if (p.age >= 15 && p.age <= 69)
      return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'low', confidence: 0.72 }
    return NO
  }

  return NO
}

/**
 * 인구통계 하드 미스매치 — 정책이 명백히 특정 대상 전용인데 사용자가 그 대상이 아니면 true(제외).
 * 정밀 룰이 연령 문구를 못 잡고 소득/소득무관 분기로 새어 엉뚱한 추천(예: 72세에 청년·유아 정책)이
 * 뜨는 것을 막는 안전장치. 과배제를 피하려 '명백한' 경우만 막는다(보수적 임계).
 */
export function demographicMismatch(name: string, doc: string, p: UserProfile): boolean {
  const ages = p.children_ages || []
  const hasChild = p.has_children || ages.length > 0
  // 청년 전용인데 명백히 청년 아님(상한 넉넉히 39세) — 72세에 '청년' 정책 방지
  if (/청년/.test(name) && p.age > 39) return true
  // 노인·어르신·고령자·시니어 전용인데 60세 미만
  if (/노인|어르신|경로|고령자|시니어/.test(name) && p.age < 60) return true
  // 아동·영유아·보육·유아·육아 전용인데 자녀 없음
  if (/아동|영유아|보육|유아|어린이집|어린이|육아|키즈|양육|보육료/.test(name) && !hasChild) return true
  // 청소년·학령기 전용인데 본인이 청소년도 아니고 학령기 자녀도 없음
  if (/청소년|학령기/.test(name) && !(p.age >= 9 && p.age <= 24) && !ages.some((a) => a >= 7 && a <= 18)) return true
  // 임산부·산모·임신·난임 전용인데 임신 중도 아니고 영아도 없음
  if (/임산부|산모|임신|난임|출산/.test(name) && !(p.is_pregnant || ages.some((a) => a <= 1))) return true
  // 장애인 전용인데 비장애
  if (/장애인|장애아/.test(name) && !p.disability) return true
  // 한부모·모자/부자가정·미혼모/부 전용인데 아님
  if (/한부모|모자가정|부자가정|미혼모|미혼부|조손/.test(name) && !p.household_type.includes('한부모')) return true
  // 다문화·결혼이민 전용인데 아님
  if (/다문화|결혼이민|이주여성|이주민/.test(name) && !p.household_type.includes('다문화')) return true
  // 여성 생물학·여성 전용 급여인데 명백히 남성 — 남성에게 '생리용품·여성청소년·경력단절여성' 등 방지.
  // 보수적: gender==='male'일 때만(‘other’/미지정은 배제하지 않아 트랜스·논바이너리 포용).
  if (p.gender === 'male' &&
      /생리|모유수유|여성\s?청소년|경력단절\s?여성|여성가장|여성\s?새로일하기|여성경제활동|여성장애인|이주여성/.test(name)) return true
  // 사업주·고용주 대상(고용장려금 등)은 개인 수혜가 아님
  if (/사업주|고용주/.test(doc) || /고용장려금|고용지원금|고용촉진장려금|채용장려금/.test(name)) return true
  return false
}

/**
 * 소득 상한(기준중위소득 %) 추출 — 이 값을 명백히 넘으면 대상이 아님(null=소득 무관/불명).
 * 정책 문구에 "중위소득 N%·소득 하위 N%·차상위" 같은 상한이 있는데도 연령 규칙이 먼저 매칭돼
 * 소득 초과자에게 '강력추천'으로 새어나가는 것을 막는 게이트(현실성 향상의 핵심).
 * ⚠️ 과배제 방지: 여러 %가 있으면 가장 관대한(높은) 값을 상한으로 삼고, 숫자 없는 막연한
 *   '저소득'만으로는 게이트하지 않는다(명시 %/차상위/기초생활만).
 */
export function incomeCeiling(doc: string): number | null {
  let ceil: number | null = null
  // '기준 중위소득 N%'는 프로필의 income_percentile과 같은 단위 → 그대로 상한
  const mid = /중위(?:소득)?\s*([0-9]{2,3})\s*%/g
  let m: RegExpExecArray | null
  while ((m = mid.exec(doc)) !== null) {
    const v = parseInt(m[1], 10)
    if (!Number.isNaN(v) && (ceil === null || v > ceil)) ceil = v
  }
  // '소득 하위 N%'는 분포 백분위라 중위% 단위가 아님 — 그대로 상한 삼으면 과배제된다.
  // 실측 앵커: 기초연금 '하위 70%' 선정기준액(2026 1인 247.0만) ≈ 기준 중위소득 96% → ×1.4 근사 환산.
  const low = /하위\s*([0-9]{2,3})\s*%/g
  while ((m = low.exec(doc)) !== null) {
    const v = Math.round((parseInt(m[1], 10) * 1.4) / 5) * 5
    if (!Number.isNaN(v) && (ceil === null || v > ceil)) ceil = v
  }
  if (ceil === null && /차상위/.test(doc)) ceil = 50
  if (ceil === null && /(기초생활|생계급여|기초생활수급|기초수급)/.test(doc)) ceil = 50
  return ceil
}

// 공개 API: 정책 1건 자격 판별. doc = eligibility + ' ' + target + ' ' + name (mock_eligibility/estimate와 동일).
export function checkPolicy(policy: Policy, p: UserProfile): CheckResult {
  const doc = `${policy.eligibility} ${policy.target} ${policy.name}`
  if (demographicMismatch(policy.name, doc, p)) return NO
  // 소득 상한이 명시돼 있고 사용자가 명백히 초과하면 대상 아님(연령만 맞아도 제외)
  const ceil = incomeCeiling(doc)
  if (ceil !== null && p.income_percentile > ceil) return NO
  return checkPolicyDoc(doc, policy.name, p)
}

// 요약본(공공데이터) 정책은 정밀 룰의 정형 문구가 없어 룰 매칭이 어렵다.
// 프로필 '상황 신호'와 자연어 키워드가 맞으면 저신뢰(검토) 후보로 surfacing — 과장 없이.
const TEXT_SIGNALS: { id: string; match: (p: UserProfile) => boolean; kw: RegExp; reason: string }[] = [
  { id: 'senior', match: (p) => p.age >= 65, kw: /노인|어르신|고령|경로|장기요양/, reason: '어르신 대상' },
  { id: 'youth', match: (p) => p.age >= 19 && p.age <= 34, kw: /청년|대학생|구직|취업준비/, reason: '청년 대상' },
  { id: 'child', match: (p) => p.has_children, kw: /아동|영유아|보육|어린이|유아|육아|자녀/, reason: '자녀 양육 가구' },
  { id: 'teen', match: (p) => p.children_ages.some((a) => a >= 7 && a <= 18), kw: /청소년|학생|교육|학습|방과후/, reason: '학령기 자녀' },
  { id: 'birth', match: (p) => p.is_pregnant || p.children_ages.some((a) => a <= 1), kw: /임신|임산부|출산|산모|영아|난임/, reason: '임신·출산 가구' },
  { id: 'disability', match: (p) => p.disability, kw: /장애/, reason: '등록 장애인' },
  { id: 'lowincome', match: (p) => p.income_percentile <= 50, kw: /저소득|기초생활|차상위|수급|긴급복지/, reason: '저소득 가구' },
  { id: 'single', match: (p) => p.household_type.includes('한부모'), kw: /한부모|모자|부자가정|조손/, reason: '한부모·조손 가구' },
  { id: 'jobless', match: (p) => p.employment_status === 'unemployed', kw: /실업|실직|구직|일자리|재취업|고용/, reason: '구직 중' },
  { id: 'multi', match: (p) => p.household_type.includes('다문화'), kw: /다문화|결혼이민|외국인주민|북한이탈/, reason: '다문화 가구' },
]

function inferFromText(policy: Policy, p: UserProfile): CheckResult | null {
  const text = `${policy.name} ${policy.category} ${policy.benefit}`
  const matched = TEXT_SIGNALS.filter((s) => s.match(p) && s.kw.test(text))
  if (matched.length === 0) return null
  return {
    eligible: true,
    reason: `${matched.map((m) => m.reason).join('·')} 관련 복지예요. 자세한 자격은 상세에서 확인하세요.`,
    priority: 'low',
    confidence: Math.min(0.5 + matched.length * 0.06, 0.68),
  }
}

/** 요약본(공공데이터)·민간재단 정책 여부 — 정밀 룰 대신 텍스트 신호로 보조 매칭.
 *  민간재단(PRV-)은 심사·선발형이라 자격을 단정할 수 없어 의도적으로 저신뢰 '관련 복지'로만 노출.
 *  ⚠️ 지자체(LOC-)는 target에 "[시도 시군구] " 접두사가 붙어 eligibility와 원문이 같아도 ===가 안 됨.
 *     접두사를 벗겨 비교해야 LOC가 요약본으로 인식돼 '관련 복지'(지역 필터)로 가고, 정밀 분기의
 *     지역 무필터 오탐(예: 서울 사용자에게 하동군 정책이 강력추천)을 막는다. */
function isSummaryPolicy(policy: Policy): boolean {
  if (/^PRV-/.test(policy.id)) return true
  if (!/^(GOV|LOC)-/.test(policy.id)) return false
  const target = policy.target.replace(/^\[[^\]]+\]\s*/, '')
  return target === policy.eligibility
}

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }

// 전체 적격 정책 리스트 — priority(high>medium>low) → confidence desc 정렬
// 시·도 정규화 — 지자체 정책의 지역과 사용자 지역을 비교하기 위함(별칭 포함)
const SIDO: [string, string][] = [
  ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'],
  ['경기', '경기'], ['강원', '강원'], ['충북', '충청북'], ['충남', '충청남'], ['전북', '전라북'], ['전남', '전라남'], ['경북', '경상북'], ['경남', '경상남'], ['제주', '제주'],
]
export function sidoOf(text: string): string {
  const t = text || ''
  for (const [code, alias] of SIDO) if (t.includes(code) || t.includes(alias)) return code
  return ''
}

/**
 * 지자체(LOC) target 접두사 "[시도 시군구] …"에서 시·군·구를 추출. 시도만 있으면 ''(광역).
 * 예) "[서울특별시 강남구] …" → "강남구", "[경기도 성남시 분당구] …" → "성남시", "[부산광역시] …" → ''.
 * 시·도 안에서 더 좁혀 '내 동네 복지'만 보이게 하는 2차 필터용.
 */
export function guOf(target: string): string {
  const m = (target || '').match(/^\[([^\]]+)\]/)
  if (!m) return ''
  const parts = m[1].split(/\s+/)
  const g = parts[1] || '' // [0]=시도, [1]=시군구
  // 실제 시·군·구(…시/군/구)만 인정 — '-' 등 잡값은 광역(빈값)으로 처리
  return /[시군구]$/.test(g) ? g : ''
}

// 지자체(LOC) '관련' 추론 결과 상한 — 전국 수천 건이 쏟아지지 않게(신뢰도 상위 우선)
const MAX_INFERRED = 120

/**
 * 상황 관련도(situation relevance) — 사용자를 '규정하는' 상황과 정책이 맞을수록 높은 점수.
 * 같은 우선순위(priority) 안에서 신뢰도보다 먼저 정렬해, 부수적 속성(예: 나이만 맞는 청년 정책)보다
 * 핵심 상황(장애·출산·한부모·노인·육아·실직·생존)에 맞는 정책이 위로 오게 한다.
 * → '내게 진짜 중요한 것부터' — AI Agent다운 개인화.
 */
export function situationRelevance(policy: Policy, p: UserProfile): number {
  const t = `${policy.name} ${policy.category}`
  const infant = p.is_pregnant || (p.children_ages || []).some((a) => a <= 1)
  let s = 0
  if (p.disability && /장애/.test(t)) s += 5
  if (infant && /임신|임산부|출산|출생|산모|영아|신생아|난임|모유|부모급여|첫만남|아동수당/.test(t)) s += 5
  if (p.household_type.includes('한부모') && /한부모|모자|부자가정|조손|양육/.test(t)) s += 4
  if (p.household_type.includes('다문화') && /다문화|결혼이민|이주|외국인/.test(t)) s += 4
  if (p.age >= 65 && /노인|어르신|경로|기초연금|장기요양|치매|틀니/.test(t)) s += 4
  if (p.has_children && /아동|보육|육아|어린이|자녀|양육|유아|급식|돌봄|부모급여|다자녀|출산|출생|첫만남/.test(t)) s += 3
  if (p.employment_status === 'unemployed' && /실업|구직|취업|재취업|일자리|자활/.test(t)) s += 3
  if (p.income_percentile <= 32 && /생계|긴급|기초생활|의료급여/.test(t)) s += 3   // 생존 욕구 우선
  else if (p.income_percentile <= 50 && /저소득|차상위|주거급여|교육급여|바우처/.test(t)) s += 2
  return s
}

export function getEligiblePolicies(p: UserProfile): EligiblePolicy[] {
  const userSido = sidoOf(p.region)
  const precise: EligiblePolicy[] = []
  const inferred: EligiblePolicy[] = []
  for (const policy of getCatalog()) {
    // 인구통계 하드 미스매치(예: 72세에 청년·유아 정책)는 정밀·추론 양쪽 모두에서 제외
    if (demographicMismatch(policy.name, `${policy.eligibility} ${policy.target} ${policy.name}`, p)) continue
    // 민간재단(PRV-)은 심사·선발형 — 일반 소득룰 등 정밀 매칭으로 '자격 충족'을 단정하지 않고
    // 항상 아래 저신뢰 텍스트 신호(inferFromText)로만 '관련 복지'로 제시한다(과장 방지).
    // ⚠️ 지자체(LOC-)도 정밀 분기에서 제외 — LOC target/eligibility의 요약문에 '만 65세'·'중증장애인'
    //    같은 문구가 있으면 checkPolicy가 지역을 무시하고 고신뢰 정밀 매칭해, 타 지역 정책이
    //    강력추천으로 새어나갔다(예: 서울 사용자에게 하동군 정책). LOC는 항상 아래 inferred(지역 필터)로.
    if (!policy.id.startsWith('PRV-') && !policy.id.startsWith('LOC-')) {
      const c = checkPolicy(policy, p)
      if (c.eligible) {
        precise.push({ ...policy, reason: c.reason, priority: c.priority, confidence: c.confidence })
        continue
      }
    }
    // 정밀 룰이 못 잡은 요약본(공공데이터) 정책은 상황 신호로 보조 매칭
    if (!isSummaryPolicy(policy)) continue
    // 요약문에 명시 소득 상한이 있고 사용자가 초과하면 '관련'에서도 제외(현실성)
    const ic = incomeCeiling(`${policy.eligibility} ${policy.target} ${policy.name}`)
    if (ic !== null && p.income_percentile > ic) continue
    const inf = inferFromText(policy, p)
    if (!inf) continue
    // 지자체는 사용자 시·도와 다르면 제외(지역 입력 시에만; 중앙·시드는 전국이라 항상 포함)
    if (policy.id.startsWith('LOC-') && userSido) {
      const ps = sidoOf(policy.target)
      if (ps && ps !== userSido) continue
    }
    inferred.push({ ...policy, reason: inf.reason, priority: inf.priority, confidence: inf.confidence })
  }
  // 추론(저신뢰)은 신뢰도 상위 일부만 — 정밀 매칭은 모두 유지.
  // 민간재단(PRV)은 공공 5,000건과 같은 캡을 두고 경쟁시키지 않는다(전용 💝 섹션의 소스이고
  // 최대 ~20건뿐인데, 데이터가 커지면 신뢰도 컷에 밀려 통째로 사라지는 회귀가 실제 발생).
  inferred.sort((a, b) => b.confidence - a.confidence)
  const prvInferred = inferred.filter((p) => p.id.startsWith('PRV-'))
  const pubInferred = inferred.filter((p) => !p.id.startsWith('PRV-'))
  const result = [...precise, ...prvInferred, ...pubInferred.slice(0, MAX_INFERRED)]
  // 정렬: 우선순위(high>med>low) → 상황 관련도(핵심 상황 우선) → 신뢰도
  result.sort((a, b) => {
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    if (pr !== 0) return pr
    const rel = situationRelevance(b, p) - situationRelevance(a, p)
    if (rel !== 0) return rel
    return b.confidence - a.confidence
  })
  return result
}

// ── guide_generator 포팅: _GUIDE_TEMPLATES + _DEFAULT_STEPS + fallback ──────
interface GuideTemplate {
  desc: string
  steps: string[]
  tips: string
  days: number
}

const GUIDE_TEMPLATES: Record<string, GuideTemplate> = {
  기초연금: {
    desc: '만 65세 이상 소득 하위 70% 어르신께 매월 최대 349,700원(2026년)을 지급하는 국가 연금입니다.',
    steps: [
      '1단계: 주민등록증 지참, 가까운 주민센터·국민연금공단 방문',
      '2단계: 기초연금 수급 신청서 및 금융정보 제공 동의서 작성',
      '3단계: 소득·재산 조사 (약 2~3주 소요)',
      '4단계: 선정 결과 통보 (문자·우편)',
      '5단계: 신청 다음 달부터 매월 25일 지급',
    ],
    tips: '배우자와 함께 수급 시 각 20% 감액됩니다. 복지로(www.bokjiro.go.kr)에서도 온라인 신청 가능합니다.',
    days: 30,
  },
  실업급여: {
    desc: '비자발적으로 실직한 분이 재취업 활동을 하는 동안 생활을 지원하는 급여입니다.',
    steps: [
      '1단계: 퇴직 전 이직확인서를 고용보험 사이트(www.ei.go.kr)에서 확인',
      '2단계: 퇴직 후 즉시 고용센터 방문 또는 고용24(www.work.go.kr) 온라인 신청',
      '3단계: 수급자격 인정신청서 및 구직등록',
      '4단계: 수급자격 인정 결정 (약 2주)',
      '5단계: 구직활동 인정 후 실업인정일마다 급여 지급',
    ],
    tips: '퇴직 후 1년이 지나면 수급 자격이 소멸됩니다. 빨리 신청하세요!',
    days: 14,
  },
  아동수당: {
    desc: '만 9세 미만 아동 모두에게 소득에 관계없이 매월 10만원을 지급합니다(2026년 8세→9세 미만으로 확대).',
    steps: [
      '1단계: 출생신고 완료 후 즉시 신청 가능',
      '2단계: 복지로·정부24 온라인 또는 주민센터 방문',
      '3단계: 신청인(보호자) 신분증, 주민등록등본 제출',
      '4단계: 신청 후 다음 달부터 지급',
    ],
    tips: '출생 후 60일 이내 신청하면 출생월부터 소급 지급됩니다. 늦어지면 신청일 기준으로만 지급됩니다.',
    days: 7,
  },
}

// mock_guides 포팅: 적격 정책 상위 5건. 전용 템플릿 없으면 정책 자체 정보로 fallback 가이드 생성.
export function generateGuides(eligible: EligiblePolicy[]): ApplicationGuide[] {
  const guides: ApplicationGuide[] = []
  for (const ep of eligible.slice(0, 5)) {
    const tmpl = GUIDE_TEMPLATES[ep.name]
    if (tmpl) {
      guides.push({
        policy_id: ep.id,
        name: ep.name,
        desc: tmpl.desc,
        steps: tmpl.steps,
        tips: tmpl.tips,
        estimated_days: tmpl.days,
      })
    } else {
      // fallback: 정책 자체 application/required_docs/benefit으로 채움
      const docNote = ep.required_docs.length ? `필요 서류: ${ep.required_docs.join(', ')}.` : ''
      guides.push({
        policy_id: ep.id,
        name: ep.name,
        desc: ep.benefit || `${ep.name} 혜택을 받으실 수 있습니다.`,
        steps: [
          `1단계: ${ep.application}`,
          docNote ? `2단계: ${docNote}` : '2단계: 신분증 및 주민등록등본 지참',
          '3단계: 담당자 상담 후 신청서 작성',
          '4단계: 자격 심사 및 결정 통보 (약 2~4주)',
          `5단계: 급여·서비스 지급 시작 (${ep.renewal} 기준)`,
        ],
        tips: '신청 전 129(복지상담 무료전화)로 서류를 미리 확인하면 편리합니다.',
        estimated_days: 14,
      })
    }
  }
  return guides
}

function buildPortfolio(eligible: EligiblePolicy[]): AnalysisResult['portfolio_summary'] {
  const byCategory: Record<string, number> = {}
  let totalMonthly = 0
  let anyMonthly = false
  for (const ep of eligible) {
    byCategory[ep.category] = (byCategory[ep.category] || 0) + 1
    // 정직한 합산: 현금성(매월 현금처럼 받는 지원)만 — 납입형 저축·대출한도·바우처가 섞이면
    // '월 730만원' 같은 비현실 합계가 나온다(UI 미노출 지표라도 오용 방지 차원에서 동일 원칙 적용)
    if (!isCashBenefit(ep.benefit, `${ep.name} ${ep.category}`)) continue
    const amt = parseMonthly(ep.benefit) // 원-우선 보수 파서(format.ts와 동일) — '70만원 납입…33,000원 지원'은 33,000으로
    if (amt > 0) {
      totalMonthly += amt
      anyMonthly = true
    }
  }
  const summary: AnalysisResult['portfolio_summary'] = {
    total_policies: eligible.length,
    by_category: byCategory,
  }
  // ⚠️ 이 값은 '전부 수급 시 이론적 최대'(중복수급 제한 미반영) — UI 헤드라인엔 쓰지 말 것(ResultsView는 별도 보수 합산 사용)
  if (anyMonthly) summary.total_monthly = totalMonthly
  return summary
}

// ── notification_agent 포팅 정신: 생애 이벤트 기반 1~3개 알림 ───────────────
function buildNotifications(p: UserProfile, eligible: EligiblePolicy[]): { title: string; message: string; type?: string }[] {
  const notes: { title: string; message: string; type?: string }[] = []
  const events = p.life_events || []
  const names = new Set(eligible.map((e) => e.name))

  if (events.includes('출산') || p.is_pregnant) {
    notes.push({
      title: '출산 가정 신청 기한 안내',
      message: '부모급여·첫만남이용권·아동수당은 출생 후 60일 이내 신청 시 출생월부터 소급 지급됩니다. 서두르세요.',
      type: 'deadline',
    })
  }
  if (events.includes('실직') || p.employment_status === 'unemployed') {
    notes.push({
      title: '실업급여 신청 기한 안내',
      message: '실업급여(구직급여)는 퇴직 후 1년이 지나면 수급 자격이 소멸됩니다. 가까운 고용센터에 빠르게 신청하세요.',
      type: 'deadline',
    })
  }
  if (events.includes('장애진단') || (p.disability && names.has('장애인연금'))) {
    notes.push({
      title: '장애인 복지 신청 안내',
      message: '장애 등록 후 장애인연금·활동지원서비스 등 추가 혜택을 주민센터에서 함께 신청할 수 있습니다.',
      type: 'info',
    })
  }
  if (p.age >= 65 && names.has('기초연금')) {
    notes.push({
      title: '기초연금 수급 안내',
      message: '만 65세 이상 소득 하위 70% 어르신은 기초연금 대상입니다. 생일이 속한 달의 1개월 전부터 신청 가능합니다.',
      type: 'info',
    })
  }

  if (notes.length === 0) {
    notes.push({
      title: '맞춤 복지 알림',
      message: '프로필 변화(출산·실직·장애 등)가 생기면 새로운 복지 혜택이 열립니다. 정기적으로 자격을 확인하세요.',
      type: 'info',
    })
  }
  return notes.slice(0, 3)
}

// ── orchestrator 포팅: mock_final_response ──────────────────────────────────
function buildFinalResponse(
  eligible: EligiblePolicy[],
  notifications: { title: string; message: string; type?: string }[],
): string {
  if (eligible.length === 0) {
    return (
      '현재 입력하신 프로필 기준으로는 수혜 가능한 정책을 찾지 못했습니다. ' +
      '프로필 정보를 더 정확하게 입력하시거나, ' +
      '복지로(www.bokjiro.go.kr) 또는 가까운 주민센터를 방문하시면 전문 상담을 받으실 수 있습니다. ' +
      '129로 전화하시면 무료 복지 상담도 가능합니다.'
    )
  }

  const high = eligible.filter((p) => p.priority === 'high')
  const top3 = [...eligible].sort((a, b) => b.confidence - a.confidence).slice(0, 3)
  const names = top3.map((p) => p.name).join(', ')

  const sentences: string[] = [
    `분석 결과 수혜 가능 정책 ${eligible.length}건을 찾았으며, ` +
      `그 중 우선순위 높은 정책이 ${high.length}건입니다.`,
    `가장 먼저 ${names} 신청을 권장합니다.`,
  ]

  const reasons = top3.filter((p) => p.reason).map((p) => `${p.name}(${p.reason})`)
  if (reasons.length) {
    sentences.push('선정 근거: ' + reasons.join(', ') + '.')
  }

  if (notifications.length) {
    const notif = notifications[0]
    sentences.push(`생애 이벤트 알림: ${notif.title} — ${notif.message}`)
  }

  sentences.push(
    '복지로(www.bokjiro.go.kr) 또는 가까운 주민센터에서 신청하시거나, ' +
      '129 무료 상담 전화를 이용하세요.',
  )

  return sentences.join(' ')
}

// ── 전체 파이프라인 — 10노드 그래프 결과(웹소켓 complete) 미러 ──────────────
export function runAnalysis(p: UserProfile): AnalysisResult {
  const { summary, keywords } = extractKeywords(p)
  const eligible = getEligiblePolicies(p)
  const guides = generateGuides(eligible)

  // 적격 정책의 필요 서류 합집합 (순서 보존, 중복 제거)
  const docSet: string[] = []
  for (const ep of eligible) {
    for (const d of ep.required_docs) {
      if (!docSet.includes(d)) docSet.push(d)
    }
  }

  const portfolio = buildPortfolio(eligible)
  const notifications = buildNotifications(p, eligible)
  const finalResponse = buildFinalResponse(eligible, notifications)

  return {
    profile_summary: summary,
    search_keywords: keywords,
    eligible_policies: eligible,
    application_guides: guides,
    required_docs: docSet,
    portfolio_summary: portfolio,
    notifications,
    final_response: finalResponse,
  }
}

// ── 키워드 검색 (Mock /search 정신) — name/category/target/eligibility/benefit ──
export function searchPolicies(query: string, opts?: { category?: string; limit?: number }): Policy[] {
  const q = query.trim().toLowerCase()
  const category = opts?.category
  const limit = opts?.limit

  let pool = getCatalog()
  if (category) {
    pool = pool.filter((p) => p.category === category)
  }

  let results: Policy[]
  if (!q) {
    results = pool
  } else {
    results = pool.filter((p) =>
      (p.name + ' ' + p.category + ' ' + p.target + ' ' + p.eligibility + ' ' + p.benefit)
        .toLowerCase()
        .includes(q),
    )
  }

  if (typeof limit === 'number') results = results.slice(0, limit)
  return results
}

// ── 빠른 혜택 추정 — /estimate 포팅 ─────────────────────────────────────────
export function estimateBenefits(p: UserProfile): { eligible_count: number; policies: EligiblePolicy[] } {
  const eligible = getEligiblePolicies(p)
  return {
    eligible_count: eligible.length,
    policies: eligible.slice(0, 10),
  }
}
