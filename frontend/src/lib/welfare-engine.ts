// 클라이언트 사이드 복지 엔진 — backend/agents/mock_responses.py + api/routes.py(/estimate) 포팅.
// 백엔드 없이 브라우저에서 동일한 키워드·규칙 기반 로직을 재현한다. 순수 함수, 외부 의존성 없음.
import type { Policy } from '@/data/policies'
import { getCatalog } from '@/data/catalog'

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
    } else if (ages.some((a) => a < 8)) {
      keywords = keywords.concat(['아동수당', '보육료', '유아학비'])
    }
    if (ages.some((a) => a < 18)) {
      keywords = keywords.concat(['아동', '교육급여'])
    }
  }
  if (p.employment_status === 'unemployed') {
    keywords = keywords.concat(['실업급여', '취업지원', '구직', '국민취업지원제도'])
  }
  if (p.income_percentile <= 30) {
    keywords = keywords.concat(['기초생활', '생계급여', '의료급여', '저소득'])
  } else if (p.income_percentile <= 50) {
    keywords = keywords.concat(['차상위', '저소득', '주거급여'])
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
  if (doc.includes('만 8세 미만') || doc.includes('0세~7세') || doc.includes('만 0~7세')) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 8))
      return { eligible: true, reason: '만 8세 미만 자녀 보유', priority: 'high', confidence: 0.97 }
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

  // ── 저소득·기초생활 계열 ──
  if (anyIn(doc, ['기초생활수급자', '의료급여 수급자', '중위소득 30%'])) {
    if (p.income_percentile <= 30)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기초생활 기준 충족`, priority: 'high', confidence: 0.87 }
    return NO
  }
  if (anyIn(doc, ['기초생활수급자 및 차상위', '차상위계층'])) {
    if (p.income_percentile <= 50)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 차상위 기준 충족`, priority: 'medium', confidence: 0.85 }
    return NO
  }
  if (anyIn(doc, ['중위소득 48%', '중위소득 50%'])) {
    if (p.income_percentile <= 50)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기준 충족`, priority: 'medium', confidence: 0.84 }
    return NO
  }
  if (anyIn(doc, ['중위소득 60%', '중위소득 63%'])) {
    if (p.income_percentile <= 63)
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

// 공개 API: 정책 1건 자격 판별. doc = eligibility + ' ' + target + ' ' + name (mock_eligibility/estimate와 동일).
export function checkPolicy(policy: Policy, p: UserProfile): CheckResult {
  const doc = `${policy.eligibility} ${policy.target} ${policy.name}`
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

/** 요약본(공공데이터) 정책 여부 — 정밀 룰 대신 텍스트 신호로 보조 매칭 */
function isSummaryPolicy(policy: Policy): boolean {
  return /^(GOV|LOC)-/.test(policy.id) && policy.target === policy.eligibility
}

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }

// 전체 적격 정책 리스트 — priority(high>medium>low) → confidence desc 정렬
export function getEligiblePolicies(p: UserProfile): EligiblePolicy[] {
  const result: EligiblePolicy[] = []
  for (const policy of getCatalog()) {
    let c = checkPolicy(policy, p)
    // 정밀 룰이 못 잡은 요약본(공공데이터) 정책은 상황 신호로 보조 매칭
    if (!c.eligible && isSummaryPolicy(policy)) {
      const inferred = inferFromText(policy, p)
      if (inferred) c = inferred
    }
    if (c.eligible) {
      result.push({ ...policy, reason: c.reason, priority: c.priority, confidence: c.confidence })
    }
  }
  result.sort((a, b) => {
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    if (pr !== 0) return pr
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
    desc: '만 65세 이상 소득 하위 70% 어르신께 매월 최대 334,810원을 지급하는 국가 연금입니다.',
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
    desc: '만 8세 미만 아동 모두에게 소득에 관계없이 매월 10만원을 지급합니다.',
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

// ── 월 지급액 파싱: benefit 문자열에서 "월 ... 334,810원" 형태 첫 금액 추출 ──
function parseMonthlyAmount(benefit: string): number | null {
  if (!benefit.includes('월')) return null
  // '월'이 등장한 이후 텍스트에서 첫 번째 "숫자(,숫자)*원" 패턴을 찾는다.
  const after = benefit.slice(benefit.indexOf('월'))
  const m = after.match(/([0-9][0-9,]*)\s*원/)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ''), 10)
  if (Number.isNaN(n)) return null
  return n
}

function buildPortfolio(eligible: EligiblePolicy[]): AnalysisResult['portfolio_summary'] {
  const byCategory: Record<string, number> = {}
  let totalMonthly = 0
  let anyMonthly = false
  for (const ep of eligible) {
    byCategory[ep.category] = (byCategory[ep.category] || 0) + 1
    const amt = parseMonthlyAmount(ep.benefit)
    if (amt !== null) {
      totalMonthly += amt
      anyMonthly = true
    }
  }
  const summary: AnalysisResult['portfolio_summary'] = {
    total_policies: eligible.length,
    by_category: byCategory,
  }
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
