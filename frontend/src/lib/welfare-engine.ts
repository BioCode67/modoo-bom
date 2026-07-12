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
  /** 자연어 질의 원문(선택) — 주제어(틀니·전세·창업 등)를 랭킹에 반영하기 위해 보관. 자격판정엔 영향 없음. */
  _query?: string
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
  // 농어촌 전용 지원은 읍·면 거주를 앱이 확인할 수 없다(region은 시·도) → 전 임신부·저소득에게 high로 오노출하지 않고
  //   저신뢰 '관련'(low)으로만. 정직성: 거주 조건부를 확정처럼 상단 노출 금지.
  if (/농어촌|농어민|농업인|어업인|귀농|귀어/.test(name)) {
    return { eligible: true, reason: '농어촌 대상 (읍·면 거주 확인 필요)', priority: 'low', confidence: 0.45 }
  }
  // ── 폭력 피해자 지원(보호시설·여성긴급 등) — 안전 직결, 피해 신호 있으면 최우선(high) ──
  if (/가정폭력|성폭력|폭력\s*피해|여성긴급|피해자\s*보호|학대\s*피해/.test(name)) {
    if ((p.life_events || []).some((e) => /가정폭력|성폭력|폭력|학대/.test(e)))
      return { eligible: true, reason: '폭력 피해 지원 대상 (안전 최우선)', priority: 'high', confidence: 0.9 }
    return NO
  }
  // ── 북한이탈주민 정착지원(정착금·주거·취업) — 탈북 신호 있으면 최우선(사각지대) ──
  if (/북한이탈|탈북|새터민/.test(name)) {
    if ((p.life_events || []).some((e) => /북한이탈|탈북|새터민/.test(e)))
      return { eligible: true, reason: '북한이탈주민 정착지원 대상', priority: 'high', confidence: 0.9 }
    return NO
  }
  // ── 장애 아동 지원(발달재활·장애아동수당 등) — '장애아동' 신호나 장애+자녀면 노출(성인 장애정책과 별개) ──
  if (/발달재활|장애\s*아동|장애아동/.test(name)) {
    if (hasDisabledChild(p) || (p.disability && p.has_children))
      return { eligible: true, reason: '장애 아동 지원 대상', priority: 'high', confidence: 0.88 }
    return NO
  }
  // ── 산재(업무상 재해) 요양·보상 — 산재 신호 있으면 노출 ──
  if (/산재|산업재해|업무상\s*재해|근로복지공단/.test(name)) {
    if ((p.life_events || []).includes('산재'))
      return { eligible: true, reason: '업무상 재해(산재) 대상', priority: 'high', confidence: 0.85 }
    return NO
  }
  // ── 수급가구 + 취약구성원 나열형 (예: 에너지바우처) ──
  // eligibility가 '생계·의료급여 수급 가구이면서 노인·영유아·장애인·임산부·중증질환자·한부모 구성원 포함'처럼
  // 여러 구성원 유형을 OR로 나열하는 정책은, 임신 하드게이트로 배제하지 말고(비임신 노인 수급자 탈락 방지, 감사 확정)
  // '수급(소득) + 본인이 나열된 구성원 유형에 해당'으로 정밀 판정 → 자격자만 정확히 노출(과장 없음).
  {
    const memberTypes = ['노인', '영유아', '장애', '임산부', '중증질환', '한부모', '조손']
    const nMembers = memberTypes.filter((t) => doc.includes(t)).length
    if (nMembers >= 3 && anyIn(doc, ['수급 가구', '급여 수급', '수급자', '생계·의료'])) {
      const isSenior = p.age >= 65
      const hasInfant = !!(p.has_children && (p.children_ages || []).some((a) => a <= 5))
      const isDisabled = !!p.disability
      const isSingleParent = /한부모|조손/.test(p.household_type || '')
      const memberMatch = isSenior || hasInfant || isDisabled || !!p.is_pregnant || isSingleParent
      // 수급가구 소득 ≈ 생계32·의료40 수급자(중위 40% 이하)
      if (memberMatch && p.income_percentile <= 40)
        return { eligible: true, reason: '기초생활 수급가구 + 취약 구성원(노인·영유아·장애·임산부·한부모 등) 해당', priority: 'high', confidence: 0.85 }
      return NO
    }
  }
  // ── 노인 계열 ──
  if (anyIn(doc, ['만 65세', '65세 이상', '만65세', '65세↑', '노인(65'])) {
    if (p.age >= 65) {
      // 장기요양·노인돌봄 등 '요양등급 판정·돌봄 필요 인정'을 전제하는 서비스는 65세 모두가 대상이 아님.
      //   연령만으로 강력추천(high)하면 건강한 어르신에게 돌봄서비스가 과추천됨(감사 확정 FP) → medium·저신뢰 + 안내.
      if (/장기요양|요양등급|등급판정|일상생활\s*지원|거동\s*불편|기능\s*저하|노인돌봄|돌봄서비스|독립생활/.test(doc))
        return { eligible: true, reason: `만 ${p.age}세 대상 — 단, 장기요양 등급판정·돌봄 필요 인정을 받은 경우예요`, priority: 'medium', confidence: 0.6 }
      return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'high', confidence: 0.95 }
    }
    return NO
  }
  if (anyIn(doc, ['만 60세', '60세 이상', '만60세', '만 66세'])) {
    if (p.age >= 60) return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'medium', confidence: 0.9 }
    return NO
  }

  // ── 청년 계열 ──
  // 만 19~20세 전용(예: 청년 문화예술패스) — 넓은 청년 룰보다 먼저 정밀 판정(21~34세 오노출 방지)
  if (anyIn(doc, ['만 19~20세', '19~20세', '만 19세·20세'])) {
    if (p.age >= 19 && p.age <= 20)
      return { eligible: true, reason: `만 ${p.age}세로 대상 연령(19~20세) 충족`, priority: 'medium', confidence: 0.85 }
    return NO
  }
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
  // 가족돌봄청년(영케어러) 등 만 13~34세 — 연령은 맞지만 '아픈 가족을 돌본다'는 조건은 프로필로 확인 불가.
  //   그래서 연령만으로 강력추천하지 않고 저신뢰(low)로만 노출 — 모든 청년에게 남발되던 과노출 방지(정직성).
  if (doc.includes('만 13~34세') || doc.includes('13~34세')) {
    if (p.age >= 13 && p.age <= 34)
      return { eligible: true, reason: `만 ${p.age}세 대상 연령 — 단, 아픈 가족을 돌보는 경우에 해당해요`, priority: 'low', confidence: 0.5 }
    return NO
  }
  if (anyIn(doc, ['만 9~24세', '9~24세'])) {
    if (p.age >= 9 && p.age <= 24)
      return { eligible: true, reason: `만 ${p.age}세 청소년·청년 기준 충족`, priority: 'high', confidence: 0.88 }
    return NO
  }

  // ── 장애인 계열 ──
  if (doc.includes('중증장애인')) {
    // 지적·자폐성 장애는 한국 법상 항상 '심한 장애(중증)'로 등록되므로 중증에 포함(1·2급만 보면 발달장애인이 오배제됨).
    const severe = p.disability && (['1급', '2급', '1', '2', '지적', '자폐'].some((g) => (p.disability_grade || '').includes(g)) || /중증|심한/.test(p.disability_grade || ''))
    if (severe)
      return { eligible: true, reason: `등록 중증장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.93 }
    return NO
  }
  if (doc.includes('발달장애인')) {
    // '발달장애인 부모·가족' 대상 정책(부모 심리지원 등)은 부모가 비장애여도 대상 — 장애 자녀 신호로 매칭(감사 확정 FN).
    if (/부모|가족|보호자/.test(doc) && hasDisabledChild(p))
      return { eligible: true, reason: '발달장애 자녀의 부모·가족 대상', priority: 'high', confidence: 0.85 }
    if (p.disability && ['지적', '자폐'].some((g) => (p.disability_grade || '').includes(g)))
      return { eligible: true, reason: `발달장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.91 }
    return NO
  }
  if (doc.includes('등록 장애인') || (doc.includes('장애인') && name.includes('장애'))) {
    if (p.disability)
      return { eligible: true, reason: `등록 장애인(${p.disability_grade}) 조건 충족`, priority: 'high', confidence: 0.92 }
    return NO
  }

  // ── 다문화 계열 ── (아동 분기보다 먼저: eligibility의 '또는 만 12세 이하 자녀'가 하드 자녀요건으로 오인돼
  //   임신 중·무자녀 다문화가족이 배제되던 문제. 가구유형으로 먼저 매칭한다.)
  if (anyIn(doc, ['다문화가족', '결혼이민자', '귀화자'])) {
    if (p.household_type === '다문화가족')
      // 사각지대 대표(대회 주제) — 다문화 전용 지원은 high로. medium이면 나이만 겹친 청년 정책(전부 high)에 묻힘
      return { eligible: true, reason: '다문화가족 확인', priority: 'high', confidence: 0.9 }
    return NO
  }
  // ── 외국인 근로자·이주노동자 지원(체불임금·법률·산재 등) — 다문화/이주 신호 있으면 관련복지로 노출(사각지대, 감사 확정 FN) ──
  //   '외국인' 단독은 과매칭 위험이라 '외국인 근로자/노동자·이주노동자'로 한정. Korean 일반 프로필엔 노출 안 함.
  if (/외국인\s*근로자|외국인\s*노동자|이주\s*노동자|이주노동자|이주민\s*근로/.test(doc)) {
    if (p.household_type === '다문화가족' || (p.life_events || []).some((e) => /외국인|이주|다문화/.test(e)))
      return { eligible: true, reason: '외국인·이주민 근로자 지원 관련', priority: 'medium', confidence: 0.7 }
    return NO
  }
  // ── 국가장학금·학자금 지원 ── ('대학생·소득분위 N구간'은 엔진 토큰이 없어 dead였던 대표 복지 — 재학생 매칭 ──
  //   학생임이 명시됐거나 명백한 대학 연령대(18~24세·직업 미상)만 — 29세 임신부·실직자 등에 오노출 방지.
  if (/국가장학금|학자금\s*지원|국가근로장학|등록금\s*지원/.test(doc)) {
    // 대학생 대상 — age>=18로 중·고등학생(student지만 대학 아님) 오노출 차단
    if ((p.employment_status === 'student' && p.age >= 18) || (p.age >= 18 && p.age <= 24 && p.employment_status === ''))
      return { eligible: true, reason: '대학 재학생 대상 (소득분위·성적 기준은 신청 시 확인)', priority: 'high', confidence: 0.85 }
    return NO
  }
  // ── 국가유공자·보훈 대상 지원 — 보훈 신호 있으면 노출 ──
  if (/보훈|국가유공|참전|상이군경|고엽제|독립유공/.test(name)) {
    if ((p.life_events || []).some((e) => /보훈|참전|유공/.test(e)))
      return { eligible: true, reason: '국가유공·보훈 대상', priority: 'high', confidence: 0.88 }
    return NO
  }

  // ── 아동·영유아 계열 ──
  if (doc.includes('만 9세 미만') || doc.includes('만 0~8세') || doc.includes('만 8세 미만') || doc.includes('0세~7세') || doc.includes('만 0~7세')) {
    // 아동수당: 2026년 지급 연령 만 8세 미만 → 9세 미만으로 확대(매년 1세씩 상향)
    if (p.has_children && (p.children_ages || []).some((a) => a < 9))
      return { eligible: true, reason: '만 9세 미만 자녀 보유', priority: 'high', confidence: 0.97 }
    return NO
  }
  // 영아 전용(만 0~1세, 24개월 미만) — 부모급여 등. '영아'를 만 2세까지 넓히면 오추천되므로 a<2로 좁게(만 0~5세 계열보다 먼저 판정).
  if (anyIn(doc, ['만 0~1세', '만 0~23개월', '영아'])) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 2))
      return { eligible: true, reason: '영아(만 0~1세) 자녀 보유', priority: 'high', confidence: 0.96 }
    return NO
  }
  // 영유아 좁은 구간(만 0~2세)만 a<3으로. '만 0~5세'와 한 그룹으로 두면 만 3~5세가 오배제됨(보육료 등).
  if (anyIn(doc, ['만 0~2세', '만 24개월'])) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 3))
      return { eligible: true, reason: '영유아(만 0~2세) 자녀 보유', priority: 'high', confidence: 0.96 }
    return NO
  }
  // 만 0~5세(취학 전) — 보육료·유아학비 등. 만 3~5세도 포함해야 하므로 a<6.
  if (doc.includes('만 0~5세')) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 6))
      return { eligible: true, reason: '영유아(만 0~5세) 자녀 보유', priority: 'high', confidence: 0.96 }
    return NO
  }
  if (doc.includes('만 12세 이하')) {
    if (p.has_children && (p.children_ages || []).some((a) => a <= 12))
      return { eligible: true, reason: '만 12세 이하 자녀 보유', priority: 'medium', confidence: 0.9 }
    return NO
  }
  if (doc.includes('만 18세 미만') && doc.includes('아동')) {
    if (p.has_children && (p.children_ages || []).some((a) => a < 18)) {
      // 한부모·조손 아동양육비(월23만)는 대표 현금급여 → high. 일반 아동매칭 medium에 묻혀 top에서 사라지던 문제.
      const hp = /한부모|조손/.test(p.household_type || '') && /한부모|조손|양육비/.test(doc)
      return { eligible: true, reason: hp ? '한부모·조손 아동양육비 대상' : '만 18세 미만 자녀 보유', priority: hp ? 'high' : 'medium', confidence: hp ? 0.92 : 0.88 }
    }
    return NO
  }
  // 다자녀(자녀 2명 이상) — 통합 감면 등. 미성년 자녀 2명 이상이거나 가구유형이 다자녀일 때.
  if (doc.includes('다자녀')) {
    const minors = (p.children_ages || []).filter((a) => a < 18).length
    if (minors >= 2 || (p.household_type || '').includes('다자녀')) {
      // 명확한 다자녀(자녀 3명 이상 또는 다자녀가구)의 전용 지원은 high — 일반 아동혜택에 묻히지 않게(사각지대)
      const clearlyMulti = minors >= 3 || (p.household_type || '').includes('다자녀')
      return { eligible: true, reason: '다자녀 가구', priority: clearlyMulti ? 'high' : 'medium', confidence: clearlyMulti ? 0.9 : 0.86 }
    }
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
  // ⚠️ 근로·사업·종교인 소득이 있어야 하므로 '무직'으로 명시한 사람에겐 권하지 않는다(오추천 방지).
  if (anyIn(doc, ['근로장려금', '자녀장려금', 'EITC'])) {
    if (p.income_percentile <= 100 && p.employment_status !== 'unemployed')
      return { eligible: true, reason: `저소득 근로·사업 가구로 ${name.includes('자녀') ? '자녀장려금' : '근로장려금'} 신청 대상이에요(소득·재산 요건은 국세청에서 확인)`, priority: 'medium', confidence: 0.8 }
    return NO
  }

  // ── 저소득·기초생활 계열 (2026 정밀 선정기준: 생계32·의료40·주거48·교육/차상위50, medianIncome.ts) ──
  // 여러 급여를 동시에 언급하는 포괄형 정책은 가장 넓은 기준이 적용되도록 넓은 순서로 검사.
  if (anyIn(doc, ['교육급여', '차상위', '중위소득 50%'])) {
    // 교육급여는 초·중·고 재학생(자녀) 대상 — 학령기(만 6~18세) 자녀가 없으면 대상 아님(무자녀에게 과노출 방지)
    if (name.includes('교육급여') && !(p.has_children && (p.children_ages || []).some((a) => a >= 6 && a <= 18)))
      return NO
    if (p.income_percentile <= 50)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 교육급여·차상위 기준 충족`, priority: 'medium', confidence: 0.84 }
    return NO
  }
  if (anyIn(doc, ['주거급여', '중위소득 48%'])) {
    // 주거급여는 기초생활 4대 급여 중 하나인 대표 소득보장 — 자격 시 강력추천(부수 서비스에 묻히지 않게 high)
    if (p.income_percentile <= 48)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 주거급여 기준 충족`, priority: 'high', confidence: 0.86 }
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
  // ── 취업지원(구직) 계열 — 국민취업지원·구직촉진수당·청년구직활동지원금 등 (소득분기보다 먼저) ──
  //   저소득 구직자 대표 현금성 수당인데, eligibility의 '중위 60%'(≠'중위소득 60%' 리터럴)·'저소득 구직자'
  //   (≠'구직 중/미취업')·광역 소득분기(중위120% low) 가로채기로 low에 묻히던 것(감사 확정 치명 FN).
  //   구직 신호(미취업·실직 이벤트)면 소득은 이미 checkPolicy 앞단에서 게이트됨 → 현금수당형 high·서비스형 medium.
  if (/국민취업지원|구직촉진|구직활동\s*지원|취업성공패키지/.test(doc)) {
    const jobless = p.employment_status === 'unemployed' || (p.life_events || []).some((e) => /실직|실업|폐업|해고|권고사직|구직/.test(e))
    if (!jobless) return NO
    // I유형·구직촉진수당·청년구직활동지원금은 현금 수당(대표 급여) → high. II유형(서비스형)은 medium(현금급여 위로 올리지 않음).
    const cashType = /구직촉진|구직활동\s*지원금/.test(doc) || (/I\s*유형/.test(doc) && !/II\s*유형|Ⅱ/.test(doc))
    return {
      eligible: true,
      reason: cashType ? '저소득 구직자 취업지원 대상 (구직촉진수당 등)' : '취업지원 서비스 대상 (직업훈련·일경험)',
      priority: cashType ? 'high' : 'medium',
      confidence: cashType ? 0.85 : 0.75,
    }
  }
  // 중위소득 65/63/60% — 한부모(2026년 65%로 확대) 등. 넓은 기준 순서로 정밀 검사.
  if (anyIn(doc, ['중위소득 65%'])) {
    if (p.income_percentile <= 65) {
      // 한부모·조손 대표 현금급여(아동양육비 등)는 high — 중위65%는 한부모 기준선이라, 소득만 보고 medium 처리하면
      //   대표 양육비가 법률구조·시설입소 등 부수 서비스(high)에 밀려 top에서 묻힌다.
      const hp = /한부모|조손/.test(p.household_type || '') && /한부모|조손|양육비/.test(doc)
      return { eligible: true, reason: `소득 중위소득 ${p.income_percentile}%로 기준 충족`, priority: hp ? 'high' : 'medium', confidence: hp ? 0.9 : 0.82 }
    }
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
  if (anyIn(doc, ['중위소득 120%', '중위소득 150%', '중위소득 180%', '중위소득 200%'])) {
    // 상한을 명시된 최댓값으로 — '중위소득 200% 이하'까지 폭넓게 허용하는 정책(신생아 특례대출·재난적 의료비 등) 대응
    const cap = doc.includes('중위소득 200%') ? 200 : 180
    if (p.income_percentile <= cap)
      return { eligible: true, reason: `소득 기준 충족 (중위소득 ${p.income_percentile}%)`, priority: 'low', confidence: 0.75 }
    return NO
  }

  // ── 실직·취업 계열 ──
  if (anyIn(doc, ['비자발적 이직', '실직', '비자발적 실직자'])) {
    // employment_status='unemployed'뿐 아니라 실직/폐업 life_event도 인정 — 자영업 폐업자(employment='self')가
    //   실직 신호가 있어도 긴급복지·실업급여에서 탈락하던 사각지대 해소.
    const jobless = p.employment_status === 'unemployed' || (p.life_events || []).some((e) => /실직|실업|폐업|해고|권고사직/.test(e))
    if (jobless)
      return { eligible: true, reason: '실직·폐업 등 소득상실로 신청 자격 있음', priority: 'high', confidence: 0.85 }
    // ⚠️ 긴급복지 등 '위기' 정책은 eligibility에 '실직, 사망, 화재 등'을 나열한다 — '실직' 문자열이 먼저 매칭돼
    //   사망·질병·재난으로 위기를 맞은 '재직 중' 가구가 탈락하던 결함(감사 확정). 위기 정책 + 위기 신호면 인정.
    const crisisPolicy = /긴급복지|위기상황|위기사유|긴급\s*지원/.test(doc)
    const crisisSignal = (p.life_events || []).some((e) => /사망|질병|화재|재난|위기|산재/.test(e))
    if (crisisPolicy && crisisSignal && p.income_percentile <= 80)
      return { eligible: true, reason: '갑작스러운 위기사유(사망·질병·재난 등) 발생 — 긴급복지 대상', priority: 'high', confidence: 0.82 }
    return NO
  }
  if (anyIn(doc, ['구직 중', '미취업', '미취업 청년'])) {
    if (p.employment_status === 'unemployed')
      return { eligible: true, reason: '미취업 상태로 신청 자격 있음', priority: 'medium', confidence: 0.82 }
    return NO
  }

  // ── 한부모·조손 계열 ──
  // 한부모가족지원법상 조손가구(조부모+손자녀)도 아동양육비 등 동일 급여 대상 — 조손 오배제 방지.
  if (doc.includes('한부모가족') || doc.includes('한부모') || doc.includes('조손')) {
    if (/한부모|조손/.test(p.household_type))
      return { eligible: true, reason: '한부모·조손가족 확인', priority: 'high', confidence: 0.93 }
    return NO
  }

  // ── 소득 무관 보편 서비스 ──
  if (doc.includes('소득무관') || doc.includes('소득·재산 무관')) {
    return { eligible: true, reason: '소득 무관 전국민 지원 서비스', priority: 'medium', confidence: 0.8 }
  }

  // ── 연령 상·하한 있는 일반 지원(만 15~69세) ──
  if (doc.includes('만 15~69세')) {
    if (p.age >= 15 && p.age <= 69)
      return { eligible: true, reason: `만 ${p.age}세로 연령 기준 충족`, priority: 'low', confidence: 0.72 }
    return NO
  }
  // ── 상한 없는 '만 15세 이상' — 69세 상한을 붙이면 70세 이상이 오배제됨(국민내일배움카드 등) ──
  if (doc.includes('만 15세 이상')) {
    if (p.age >= 15)
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
// 자녀 장애 신호 — 위저드('장애아 자녀')·자연어(parseQuery '장애아동') 양쪽 문자열을 모두 인식.
//   부모 본인은 비장애여도 '장애 자녀'가 있으면 발달재활·장애아동 지원 대상(사각지대 구제).
function hasDisabledChild(p: UserProfile): boolean {
  return (p.life_events || []).some((e) => /장애아동|장애아\s*자녀|자녀\s*장애/.test(e))
}

// 대출·상환형 정책 — '자격 충족(강력추천)'으로 단정하면 안 됨(상환의무·심사, 현금급여와 다름).
//   단 '대출이자 지원'은 이자를 보조받는 현금성 지원이라 대출이 아님(제외).
function isLoanPolicy(policy: Policy): boolean {
  const t = `${policy.name} ${policy.benefit}`
  if (/이자\s*지원|이자지원|대출이자/.test(t)) return false
  return /대출|전세자금|버팀목|융자|보증금\s*대출|저금리|금리\s*로\s*대출/.test(t)
}

// 심사·선발·공모형 정책 — 신청하면 다 받는 게 아니라 경쟁·심사로 선정. 자격을 단정할 수 없어 저신뢰로만.
function isSelectivePolicy(policy: Policy): boolean {
  const t = `${policy.name} ${policy.benefit} ${policy.eligibility}`
  if (/공모|경진|선발|오디션|콘테스트|경쟁률|심사를\s*통해|서류.*면접/.test(t)) return true
  // 창업 사업화 지원금(최대 N억/천만원)은 사실상 경쟁형 공모 — 연령만으로 강력추천 금지.
  if (/창업/.test(policy.name) && /지원금.*최대|사업화\s*지원|최대\s*[\d,]+\s*(억|천만)/.test(t)) return true
  return false
}

export function demographicMismatch(name: string, doc: string, p: UserProfile): boolean {
  const ages = p.children_ages || []
  const hasChild = p.has_children || ages.length > 0
  // 청년 전용인데 명백히 청년 아님(상한 넉넉히 39세) — 72세에 '청년' 정책 방지
  if (/청년/.test(name) && p.age > 39) return true
  // 노인·어르신·고령자·시니어 전용인데 60세 미만
  if (/노인|어르신|경로|고령자|시니어/.test(name) && p.age < 60) return true
  // 아동·영유아·보육·유아·육아 전용인데 자녀 없음
  if (/아동|영유아|보육|유아|어린이집|어린이|육아|키즈|양육|보육료/.test(name) && !hasChild) return true
  // 출생 지원(첫만남이용권·출생아 지원)은 신생아 대상 — 임신 중이거나 만 0~1세 자녀가 있어야.
  // (자녀 없는 성인이 소득무관 분기로 '첫만남이용권 200만원'을 추천받던 오류 차단)
  if (/첫만남|출생아|출생 아동|출산지원금/.test(name) && !(p.is_pregnant || ages.some((a) => a <= 1))) return true
  // 미숙아·선천성이상아 의료비는 해당 영아를 둔(또는 임신) 가구만 — 소득무관이라도 아무에게나 X.
  if (/미숙아|선천성이상아/.test(name) && !(p.is_pregnant || ages.some((a) => a <= 2))) return true
  // 다자녀 전용 혜택은 미성년 자녀 2명 이상(또는 다자녀 가구유형)만.
  if (/다자녀/.test(name) && !((ages.filter((a) => a < 18).length >= 2) || (p.household_type || '').includes('다자녀'))) return true
  // '셋째아 이상' 전용 지원은 자녀가 3명 이상일 때만 — 자녀 2명 가구에 노출되던 오추천 차단(감사 확정 FP).
  if (/셋째|세\s*자녀|자녀\s*3명|3명\s*이상\s*자녀/.test(name) && ages.length > 0 && ages.length < 3 && !(p.household_type || '').includes('다자녀')) return true
  // 유치원 학비(유아학비·누리과정)는 만 3~5세 대상 — 아이 나이가 적혀 있는데 3~5세가 없으면 제외.
  if (/유아학비|유치원|누리과정/.test(name) && ages.length > 0 && !ages.some((a) => a >= 3 && a <= 5)) return true
  // 미취업 전용(일경험·구직지원)인데 이미 직업(재직·자영·은퇴)이 있으면 제외 — 연령만 맞아 강력추천되던 오류 차단.
  if (/미취업|일경험|구직/.test(name) && ['employed', 'self', 'retired'].includes(p.employment_status)) return true
  // 재직·근로소득 전제 정책(내일채움공제·내일저축·미래적금·희망저축 등)인데 실직·학생이면 제외.
  //   (근로소득 있는 재직자만 가입 — 감사: 실직 청년에게 '청년 내일채움공제'가 1위로 오노출되던 문제)
  if (/내일채움공제|내일저축계좌|미래적금|희망저축|자산형성/.test(name) && ['unemployed', 'student'].includes(p.employment_status)) return true
  // 자활근로는 미취업·불안정 저소득에게 공공형 일자리를 주는 사업 — 안정 재직·자영업자는 대상 아님(감사: 재직 워킹푸어 오노출)
  if (/자활\s*근로/.test(name) && ['employed', 'self'].includes(p.employment_status)) return true
  // 재학생 전용(학자금대출 등)인데 학생이 아님이 명시되면 제외(무직·재직 등 학생 아닌 경우).
  if (/학자금대출|재학생/.test(name) && p.employment_status !== '' && p.employment_status !== 'student') return true
  // 청소년·학령기 전용인데 본인이 청소년도 아니고 학령기 자녀도 없음
  if (/청소년|학령기/.test(name) && !(p.age >= 9 && p.age <= 24) && !ages.some((a) => a >= 7 && a <= 18)) return true
  // 장학금·학자금·장학생 전용(민간재단 등)은 '실제로 쓸 수 있는 학생'이 있어야 노출(저소득 신호만으론 뻥튀기).
  //   교육 단계별로 분리: 대학·해외·펠로십형은 대학연령(본인 18~29 또는 자녀 18~24)만, 초중고·청소년·아동형은
  //   학령기(본인 청소년 또는 자녀 7~18)만. 72세 어르신·영유아 부모에게 대학 장학금이 새던 과추천 차단(사용자 지적).
  if (/장학금|장학생|스칼러십|학자금\s*지원|장학재단|펠로십|교환\s*장학|학자금\s*대출/.test(name)) {
    const isStudent = p.employment_status === 'student'
    // 자격요건(doc)까지 보고 대학형 판정 — 이름에 '대학'이 없어도 eligibility에 '대학생'이면 대학형(현대차·관정 등)
    const isUniv = /대학|대학생|대학원|전문대|해외|교환|펠로십|글로벌/.test(doc)
    if (isUniv) {
      // 대학·해외·펠로십: 본인이 대학연령 학생이거나, 대학연령(18~24) 자녀가 있어야
      if (!isStudent && !(p.age >= 18 && p.age <= 29) && !ages.some((a) => a >= 18 && a <= 24)) return true
    } else {
      // 초중고·청소년·아동 장학: 본인이 학령기이거나, 학령기(7~18) 자녀가 있어야
      if (!isStudent && !(p.age >= 8 && p.age <= 24) && !ages.some((a) => a >= 7 && a <= 18)) return true
    }
  }
  // 임산부·산모·임신·난임 전용인데 임신 중도 아니고 영아도 없음
  if (/임산부|산모|임신|난임|출산/.test(name) && !(p.is_pregnant || ages.some((a) => a <= 1))) return true
  // 여성 전용(생리용품·여성청소년 등)인데 명백히 남성이면 제외 — 성별 누수 차단('other'=선택안함은 미상이라 유지)
  if (/생리용품|생리대|월경|여성\s*청소년/.test(name) && p.gender === 'male') return true
  // 장애인 전용인데 비장애 — 단, 장애 '자녀'(발달재활 등)는 본인 비장애여도 대상이므로 장애아동 신호가 있으면 유지
  if (/장애인|장애아/.test(name) && !p.disability && !hasDisabledChild(p)) return true
  // 한부모·모자/부자가정·미혼모/부·조손 전용인데 아님 — 조손가구는 한부모가족지원법상 동일 급여 대상이라 포함
  if (/한부모|모자가정|부자가정|미혼모|미혼부|조손/.test(name) && !/한부모|조손/.test(p.household_type)) return true
  // 농어촌·농업 전용 지원은 대도시(특별시·광역시) 거주자에겐 제외 — 서울 임신부에게 '농어촌 출산지원금'
  // 이 강력추천되던 오류 차단. 도(道) 지역·미지정은 농촌 포함 가능성이 있어 게이트하지 않음(과배제 방지).
  if (/농어촌|농업인|어업인|농촌|귀농|귀어|농가|어가/.test(name) &&
      ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종'].some((m) => (p.region || '').includes(m))) return true
  // 다문화·결혼이민 전용인데 아님
  if (/다문화|결혼이민|이주여성|이주민/.test(name) && !(p.household_type || '').includes('다문화')) return true
  // 여성 생물학·여성 전용 급여인데 명백히 남성 — 남성에게 '생리용품·여성청소년·경력단절여성' 등 방지.
  // 보수적: gender==='male'일 때만(‘other’/미지정은 배제하지 않아 트랜스·논바이너리 포용).
  if (p.gender === 'male' &&
      /생리|모유수유|여성\s?청소년|경력단절\s?여성|여성가장|여성\s?새로일하기|여성경제활동|여성장애인|이주여성/.test(name)) return true
  // 중장년 전용(만 40~64세, 예: 중장년 새출발 재취업)인데 그 연령대 아님 — 29세에 '중장년 재취업' 강추 방지
  if (/중장년/.test(name) && !(p.age >= 40 && p.age <= 64)) return true
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
  // %가 안 적힌 자산심사형('차상위 이하'·'수급 가구' 등)도 저소득 상한으로 본다(중위 50% 근사).
  //   (예: 에너지바우처 '생계·의료급여 수급 가구' — 명시 %가 없어 고소득자에게 새던 것을 막음)
  // ⚠️ 단, 아래 '우대 선정' 표현은 하드 소득요건이 아니라 상한으로 보면 51~100%ile 자격자가 부당 배제된다:
  //   ① '(기초생활수급자·차상위 우선)'처럼 우선/우대로 끝나는 괄호군(그룹 전체가 우대)
  //   ② 괄호 밖 '차상위 우선'·'수급자 우선' 같은 우대 표현
  //   ③ '미수급자'(부정어 — 다른 급여를 안 받는 사람, 소득 무관)
  //   (예: 노인 맞춤돌봄서비스 '(기초생활수급자·차상위 우선)'이 51~100%ile 어르신을 오배제하던 문제)
  if (ceil === null) {
    const docNoPref = doc
      .replace(/\([^)]*(?:우선|우대)[^)]*\)/g, '')        // 우대 괄호군 통째 제거
      .replace(/(?:수급자?|차상위)\s*(?:우선|우대)/g, '') // 괄호 밖 우대 표현
      .replace(/미수급[가-힣]*/g, '')                      // 부정어(소득 무관)
    if (/차상위/.test(docNoPref)) ceil = 50
    else if (/(기초생활|생계급여|기초생활수급|기초수급|수급자|수급\s*가구|급여\s*수급)/.test(docNoPref)) ceil = 50
  }
  return ceil
}

/**
 * 신규 신청이 막힌 정책(모집 종료·신규가입 중단) — '신청할 수 있는 것만 추천' 원칙의 하드 게이트.
 * 예: 청년도약계좌(신규 2025.12 종료, 기존 가입자만 유지) — 연령이 맞아도 새 사용자는 신청 불가.
 * 후속 제도(청년미래적금 등)가 별도 정책으로 있으므로 종료 정책은 추천에서 제외해도 손해가 없다.
 */
export function isClosedForNew(policy: Policy): boolean {
  const doc = `${policy.eligibility} ${policy.benefit} ${policy.target}`
  return /신규\s*(모집|가입|신청)\s*[^,.·(]{0,8}(종료|중단|불가)|모집\s*종료|신규가입.{0,6}종료/.test(doc)
}

// 공개 API: 정책 1건 자격 판별. doc = eligibility + ' ' + target + ' ' + name (mock_eligibility/estimate와 동일).
/**
 * 이 정책이 '왜 나에게 맞는지' — 사용자의 실제 프로필 사실 중 정책 조건에 부합하는 것만 반환(설명가능성).
 * 자격을 단정하지 않고 '해당되는 내 사실'을 정직하게 보여준다("조건이 복잡해 보인다"는 사용자 불편 해소).
 * 경쟁 앱이 조건을 나열만 하는 것과 달리, 내 상황과 대조해 체크리스트로 투명하게 제시하기 위한 데이터.
 */
export function matchFacts(policy: Policy, p: UserProfile): string[] {
  const doc = `${policy.name} ${policy.category} ${policy.target} ${policy.eligibility} ${policy.benefit}`
  const f: string[] = []
  if (p.age >= 65 && /노인|어르신|고령|경로|장기요양|65세/.test(doc)) f.push(`만 ${p.age}세 · 어르신 대상`)
  else if (p.age >= 19 && p.age <= 39 && /청년|대학생|구직|취업준비|34세|39세/.test(doc)) f.push(`만 ${p.age}세 · 청년 연령`)
  if (p.income_percentile > 0 && p.income_percentile <= 60 && /저소득|기초생활|차상위|수급|하위|중위소득/.test(doc))
    f.push(`소득 하위 ${p.income_percentile}% · 소득 조건 부합`)
  if (p.disability && /장애/.test(doc)) f.push('등록 장애인 · 대상')
  if ((p.is_pregnant || (p.children_ages || []).some((a) => a <= 1)) && /임신|임산부|출산|산모|영아|난임/.test(doc)) f.push('임신·출산 가구')
  else if (p.has_children && /아동|영유아|보육|어린이|유아|육아|자녀|양육/.test(doc)) f.push('자녀 양육 가구')
  if (/한부모|조손/.test(p.household_type) && /한부모|모자|부자가정|조손/.test(doc)) f.push('한부모·조손 가구')
  if ((p.household_type || '').includes('다문화') && /다문화|결혼이민|외국인주민/.test(doc)) f.push('다문화 가구')
  if (p.employment_status === 'unemployed' && /실업|실직|구직|일자리|재취업|고용/.test(doc)) f.push('구직 중')
  return f
}

export function checkPolicy(policy: Policy, p: UserProfile): CheckResult {
  const doc = `${policy.eligibility} ${policy.target} ${policy.name}`
  if (isClosedForNew(policy)) return NO // 신규 신청 불가 정책은 추천하지 않음(신뢰 원칙)
  if (demographicMismatch(policy.name, doc, p)) return NO
  // 소득 상한이 명시돼 있고 사용자가 명백히 초과하면 대상 아님(연령만 맞아도 제외)
  const ceil = incomeCeiling(doc)
  if (ceil !== null && p.income_percentile > ceil) return NO
  const res = checkPolicyDoc(doc, policy.name, p)
  // 대출·심사/선발형은 '자격 충족(강력추천)'으로 단정하지 않고 저신뢰 '관련 복지'로 격하(정직성, 감사 확정 FP).
  //   대출은 상환의무·심사, 공모·선발은 경쟁으로 선정 — 신청하면 다 받는 현금급여와 다르다.
  if (res.eligible && res.priority !== 'low' && (isLoanPolicy(policy) || isSelectivePolicy(policy))) {
    const loan = isLoanPolicy(policy)
    return {
      eligible: true,
      priority: 'low',
      confidence: Math.min(res.confidence, 0.5),
      reason: loan
        ? '대출(심사·상환) 상품이에요 — 연령·소득 요건은 맞지만 자격·한도는 신청 시 심사로 정해져요.'
        : '심사·선발형 지원이에요 — 신청하면 다 받는 건 아니고 경쟁·심사로 선정돼요.',
    }
  }
  // 프로필로 확인 불가한 '장애유형(청각·시각 등)·특정 질환' 하드조건 정책은 확신형 강력추천 금지 → 저신뢰(정직성, 감사 확정 FP).
  //   앱은 장애 '유형'을 입력받지 않고(등록·등급만) 질병 보유도 모르므로, 청각와우를 지체장애인에게·소아암 치료비를
  //   건강한 가정에 high/medium으로 단정하던 것을 '해당 조건이면 대상' 저신뢰 안내로 격하. 일반 장애·아동 급여는 영향 없음.
  if (res.eligible && res.priority !== 'low' &&
      /인공와우|와우\s*수술|청각장애|청각\s*장애|시각장애|시각\s*장애|저시력|망막|각막|보청기|점자|수어|언어장애|소아암|백혈병|어린이\s*암|난치성\s*질환/.test(doc)) {
    return {
      eligible: true,
      priority: 'low',
      confidence: Math.min(res.confidence, 0.5),
      reason: '해당 장애유형·질환이 있는 경우 지원 대상이에요 — 상세에서 조건을 확인하세요.',
    }
  }
  // 근로연계 자산형성(내일저축계좌·미래적금·내일채움·희망저축 등)은 '근로·사업소득이 있는' 사람만 가입 가능.
  //   재직(employed) 확인 전엔 강력추천으로 단정하지 않는다 — 나이만 겹친 청년(직업 미상)에게 상단을 도배하던
  //   과추천 차단(사용자 '진짜 쓸 수 있는 것만'). employed면 그대로 high/medium 유지.
  if (res.eligible && res.priority !== 'low' &&
      /내일저축|미래적금|내일채움|희망저축|자산형성|디딤씨앗|청년도약/.test(policy.name) &&
      p.employment_status !== 'employed' && p.employment_status !== 'self') {
    return {
      eligible: true,
      priority: 'low',
      confidence: Math.min(res.confidence, 0.5),
      reason: '근로·사업소득이 있어야 가입돼요 — 일하고 계시면 대상이에요(상세 확인).',
    }
  }
  return res
}

// 요약본(공공데이터) 정책은 정밀 룰의 정형 문구가 없어 룰 매칭이 어렵다.
// 프로필 '상황 신호'와 자연어 키워드가 맞으면 저신뢰(검토) 후보로 surfacing — 과장 없이.
const TEXT_SIGNALS: { id: string; match: (p: UserProfile) => boolean; kw: RegExp; reason: string }[] = [
  { id: 'senior', match: (p) => p.age >= 65, kw: /노인|어르신|고령|경로|장기요양/, reason: '어르신 대상' },
  { id: 'youth', match: (p) => p.age >= 19 && p.age <= 34, kw: /청년|대학생|구직|취업준비/, reason: '청년 대상' },
  { id: 'child', match: (p) => p.has_children, kw: /아동|영유아|보육|어린이|유아|육아|자녀/, reason: '자녀 양육 가구' },
  { id: 'teen', match: (p) => (p.children_ages || []).some((a) => a >= 7 && a <= 18), kw: /청소년|학생|교육|학습|방과후/, reason: '학령기 자녀' },
  { id: 'birth', match: (p) => p.is_pregnant || (p.children_ages || []).some((a) => a <= 1), kw: /임신|임산부|출산|산모|영아|난임/, reason: '임신·출산 가구' },
  { id: 'disability', match: (p) => p.disability, kw: /장애/, reason: '등록 장애인' },
  { id: 'lowincome', match: (p) => p.income_percentile <= 50, kw: /저소득|기초생활|차상위|수급|긴급복지/, reason: '저소득 가구' },
  { id: 'single', match: (p) => /한부모|조손/.test(p.household_type), kw: /한부모|모자|부자가정|조손/, reason: '한부모·조손 가구' },
  { id: 'jobless', match: (p) => p.employment_status === 'unemployed', kw: /실업|실직|구직|일자리|재취업|고용/, reason: '구직 중' },
  { id: 'multi', match: (p) => (p.household_type || '').includes('다문화'), kw: /다문화|결혼이민|외국인주민|북한이탈/, reason: '다문화 가구' },
  // 상태 기반 대상군(사각지대) — 프로필 필드가 없어 life_events 신호로 매칭. 자격 단정 없이 '관련 복지'(저신뢰)로만.
  { id: 'defector', match: (p) => (p.life_events || []).includes('북한이탈'), kw: /북한이탈|탈북|새터민/, reason: '북한이탈주민 대상' },
  { id: 'veteran', match: (p) => (p.life_events || []).includes('보훈'), kw: /국가유공|보훈|유공자|참전|고엽제|독립유공|상이군경/, reason: '국가유공·보훈 대상' },
  { id: 'aftercare', match: (p) => (p.life_events || []).includes('자립준비'), kw: /자립준비|보호종료|자립수당|자립정착|자립지원/, reason: '자립준비청년 대상' },
  { id: 'dv', match: (p) => (p.life_events || []).includes('가정폭력'), kw: /가정폭력|성폭력|폭력피해|보호시설|여성긴급|피해자\s*보호/, reason: '폭력 피해 지원' },
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
  // 민간재단(PRV)·정책서민금융(FIN)은 심사·상환형이라 자격 단정 불가 → 저신뢰 '관련 복지'로만 노출.
  if (/^(PRV|FIN)-/.test(policy.id)) return true
  if (!/^(GOV|LOC)-/.test(policy.id)) return false
  const target = policy.target.replace(/^\[[^\]]+\]\s*/, '')
  return target === policy.eligibility
}

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }

// 전체 적격 정책 리스트 — priority(high>medium>low) → confidence desc 정렬
// 시·도 정규화 — 지자체 정책의 지역과 사용자 지역을 비교하기 위함(별칭 포함).
// ⚠️ 순서 중요: 자유서술 폴백(아래 sidoOf 마지막 줄)이 이 순서로 첫 매칭을 채택하므로,
//    메트로 이름을 부분문자열로 품는 '도(道)'를 먼저 둔다. 예) "경기도 광주시"는 '광주'(메트로)가
//    아니라 '경기'로 잡혀야 한다(안 그러면 광주광역시로 오태깅). 도 이름끼리는 서로를 품지 않아 안전.
const SIDO: [string, string][] = [
  ['경기', '경기'], ['강원', '강원'], ['충북', '충청북'], ['충남', '충청남'], ['전북', '전라북'], ['전남', '전라남'], ['경북', '경상북'], ['경남', '경상남'], ['제주', '제주'],
  ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'], ['대전', '대전'], ['울산', '울산'], ['세종', '세종'],
]
export function sidoOf(text: string): string {
  const t = text || ''
  // 지자체(LOC) target은 "[시도 시군구] …" 접두 — 브라켓 첫 토큰(시도)만으로 판정한다.
  //   전체 부분문자열 매칭이면 '[경기도 광주시]'의 '광주'가 '광주광역시'보다 먼저 히트해 타 지역으로 오태깅됨(실측 22건).
  const head = t.match(/^\s*\[([^\]\s]+)/)?.[1]
  if (head) {
    for (const [code, alias] of SIDO) if (head.includes(code) || head.includes(alias)) return code
    // 브라켓 첫 토큰이 어떤 시도와도 안 맞으면 아래 자유서술 매칭으로 폴백
  }
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
  const nm = policy.name || ''
  const infant = p.is_pregnant || (p.children_ages || []).some((a) => a <= 1)
  const schoolAge = (p.children_ages || []).some((a) => a >= 6 && a <= 18)
  let s = 0
  // ── 대표 핵심 복지(생존·소득보장) — 자격이 되면 부수 서비스보다 항상 최상단 ──
  //   (감사: 생계급여가 노인돌봄·틀니 등 category +4 서비스에 밀려 14위로 묻히던 문제. 대표 급여를 위로.)
  if (/생계급여/.test(nm) && p.income_percentile <= 32) s += 9
  else if (/의료급여/.test(nm) && p.income_percentile <= 40) s += 8
  else if (/주거급여/.test(nm) && p.income_percentile <= 48) s += 8
  else if (/교육급여/.test(nm) && p.income_percentile <= 50 && schoolAge) s += 8
  if (/기초연금/.test(nm) && p.age >= 65) s += 9
  if (/장애인연금/.test(nm) && p.disability) s += 9
  if (/긴급복지|긴급생계|긴급지원/.test(nm)) s += 7
  if (/아동수당/.test(nm) && p.has_children) s += 7
  if (/부모급여/.test(nm) && infant) s += 7
  if (/첫만남/.test(nm) && (infant || p.is_pregnant)) s += 6
  if (/근로장려금|자녀장려금/.test(nm)) s += 5
  if (/국가장학금|학자금\s*지원/.test(nm) && (p.employment_status === 'student' || (p.age >= 18 && p.age <= 29))) s += 8
  if (p.disability && /장애/.test(t)) s += 5
  if (infant && /임신|임산부|출산|출생|산모|영아|신생아|난임|모유|부모급여|첫만남|아동수당/.test(t)) s += 5
  if ((p.household_type || '').includes('한부모') && /한부모|모자|부자가정|조손|양육/.test(t)) s += 4
  // 사각지대 대표 현금급여를 상위로 — 한부모 아동양육비(월23만)가 법률구조·시설입소 등 부수 서비스에 밀려 top에서 묻히던 문제
  if (/(한부모|조손).*(양육비|아동양육)|아동양육비/.test(nm) && /한부모|조손/.test(p.household_type || '')) s += 8
  if ((p.household_type || '').includes('다문화') && /다문화|결혼이민|이주|외국인/.test(t)) s += 4
  // 다문화가족엔 다문화 전용 지원(방문교육·한국어·이중언어 등)을 상위로 — 나이만 겹쳐 청년 저축/월세가 도배하던 문제
  if ((p.household_type || '').includes('다문화') && /다문화|결혼이민|이주민|방문교육|한국어|이중언어|통번역/.test(t)) s += 7
  // 다자녀가구엔 다자녀 전용 지원(셋째아 양육비·요금감면 등)을 상위로
  if ((p.household_type || '').includes('다자녀') && /다자녀|셋째|다둥이/.test(t)) s += 6
  // 장애 자녀 부모엔 장애아동 지원(발달재활 등)을 상위로 — 일반 아동혜택·청년정책에 묻히지 않게
  if ((p.life_events || []).includes('장애아동') && /발달재활|장애\s*아동|장애아동/.test(t)) s += 8
  // 산재(업무상 재해)·북한이탈 신호면 해당 전용 지원을 상위로(연령만 겹친 청년정책에 묻히지 않게)
  if ((p.life_events || []).includes('산재') && /산재|산업재해|업무상\s*재해/.test(t)) s += 8
  if ((p.life_events || []).some((e) => /북한이탈|탈북|새터민/.test(e)) && /북한이탈|탈북|새터민/.test(t)) s += 8
  if (p.age >= 65 && /노인|어르신|경로|기초연금|장기요양|치매|틀니/.test(t)) s += 4
  if (p.has_children && /아동|보육|육아|어린이|자녀|양육|유아|급식|돌봄|부모급여|다자녀|출산|출생|첫만남/.test(t)) s += 3
  if (p.employment_status === 'unemployed' && /실업|구직|취업|재취업|일자리|자활/.test(t)) s += 3
  if (p.income_percentile <= 32 && /생계|긴급|기초생활|의료급여/.test(t)) s += 3   // 생존 욕구 우선
  else if (p.income_percentile <= 50 && /저소득|차상위|주거급여|교육급여|바우처/.test(t)) s += 2
  // 상태 기반 대상군(사각지대) — 본인 자격군 전용 정책을 일반 청년·저소득 정책보다 위로(가장 정확한 매칭)
  const ev = p.life_events || []
  if (ev.includes('북한이탈') && /북한이탈|탈북|새터민/.test(t)) s += 5
  if (ev.includes('보훈') && /국가유공|보훈|유공자|참전|고엽제|상이군경/.test(t)) s += 5
  if (ev.includes('자립준비') && /자립준비|보호종료|자립수당|자립정착/.test(t)) s += 5
  if (ev.includes('가정폭력') && /가정폭력|성폭력|폭력피해|여성긴급|보호시설/.test(t)) s += 5
  // 자연어 질의의 '주제어'(틀니·전세·창업 등)와 정책이 직접 일치하면 상위로 — 주제 질문에 나이만 겹친
  //   청년/기본값 정책이 도배하던 문제 완화(자격판정엔 무관, 랭킹만). 대표 급여를 완전히 덮지 않게 소폭(캡).
  if (p._query) s += queryTopicBoost(`${nm} ${policy.category} ${policy.benefit}`, p._query)
  return s
}

// 질의 원문에서 의미있는 주제어를 뽑아 정책 텍스트와 겹치면 가점(불용어·너무 흔한 말은 제외).
const QUERY_STOPWORDS = new Set([
  '지원', '혜택', '받을', '받는', '받고', '있나요', '있어요', '싶어요', '싶은', '관련', '정책', '복지', '알려',
  '궁금', '해줘', '해주세요', '무엇', '어떤', '어떻게', '가능', '신청', '대상', '경우', '저는', '제가', '나는',
  '내가', '합니다', '입니다', '해요', '인데', '하는', '되는', '무슨', '뭐가', '뭔가', '거나', '건가', '건지',
])
function queryTopicBoost(text: string, query: string): number {
  const toks = (query.match(/[가-힣]{2,}/g) || []).filter((w) => !QUERY_STOPWORDS.has(w))
  let boost = 0
  const seen = new Set<string>()
  for (const w of toks) {
    if (seen.has(w) || !text.includes(w)) continue
    seen.add(w)
    boost += 5
  }
  return Math.min(boost, 10) // 대표 현금급여(≈9)를 완전히 덮지 않도록 상한
}

export function getEligiblePolicies(p: UserProfile): EligiblePolicy[] {
  const userSido = sidoOf(p.region)
  const precise: EligiblePolicy[] = []
  const inferred: EligiblePolicy[] = []
  for (const policy of getCatalog()) {
    // 신규 신청이 막힌 정책(모집 종료)은 정밀·추론 양쪽 모두에서 제외 — '신청할 수 있는 것만'
    if (isClosedForNew(policy)) continue
    // 정책서민금융(FIN-)은 저소득·저신용 전용(연소득 3,500만 안팎 상한) — 절대소득 상한이라 중위% 게이트에
    // 안 잡히므로 별도 게이트. 가구원수를 모르니 넉넉히 중위 150% 초과일 때만 제외(과배제 방지).
    if (policy.id.startsWith('FIN-') && p.income_percentile > 150) continue
    // 인구통계 하드 미스매치(예: 72세에 청년·유아 정책)는 정밀·추론 양쪽 모두에서 제외
    if (demographicMismatch(policy.name, `${policy.eligibility} ${policy.target} ${policy.name}`, p)) continue
    // 민간재단(PRV-)은 심사·선발형 — 일반 소득룰 등 정밀 매칭으로 '자격 충족'을 단정하지 않고
    // 항상 아래 저신뢰 텍스트 신호(inferFromText)로만 '관련 복지'로 제시한다(과장 방지).
    // ⚠️ 지자체(LOC-)도 정밀 분기에서 제외 — LOC target/eligibility의 요약문에 '만 65세'·'중증장애인'
    //    같은 문구가 있으면 checkPolicy가 지역을 무시하고 고신뢰 정밀 매칭해, 타 지역 정책이
    //    강력추천으로 새어나갔다(예: 서울 사용자에게 하동군 정책). LOC는 항상 아래 inferred(지역 필터)로.
    // ⚠️ 정책서민금융(FIN-)도 정밀 분기에서 제외 — '만 19~34세' 등 문구가 정밀 매칭돼 심사·상환형
    //    대출이 '강력추천'으로 단정되면 안 된다(햇살론유스 등). FIN은 항상 저신뢰 '관련 복지'로만.
    if (!policy.id.startsWith('PRV-') && !policy.id.startsWith('LOC-') && !policy.id.startsWith('FIN-')) {
      const c = checkPolicy(policy, p)
      if (c.eligible) {
        precise.push({ ...policy, reason: c.reason, priority: c.priority, confidence: c.confidence })
        continue
      }
    }
    // 정밀 룰이 못 잡은 요약본(공공데이터) 정책은 상황 신호로 보조 매칭
    if (!isSummaryPolicy(policy)) continue
    // 요약문에 명시 소득 상한이 있고 사용자가 초과하면 '관련'에서도 제외(현실성).
    // ⚠️ 단 정책서민금융(FIN-)은 위 전용 150% 게이트로만 판정 — '차상위 이하 또는 저신용'의 '차상위'가
    //    incomeCeiling 50%로 잡혀 저신용 51~150%ile을 오배제하던 문제 방지(FIN은 저신용 포함 설계).
    if (!policy.id.startsWith('FIN-')) {
      const ic = incomeCeiling(`${policy.eligibility} ${policy.target} ${policy.name}`)
      if (ic !== null && p.income_percentile > ic) continue
    }
    const inf = inferFromText(policy, p)
    if (!inf) continue
    // 지자체는 사용자 시·도와 다르면 제외(지역 입력 시). 미입력이면 숨기지 않되(지역 미상=관할 확정 불가, 과배제 방지)
    //   '해당 지역 주민 대상' 관할 안내를 붙인다 — 타 지역 정책을 신청 가능한 것처럼 오노출하지 않게(감사, 정직성).
    let locReason = inf.reason
    if (policy.id.startsWith('LOC-')) {
      const ps = sidoOf(policy.target)
      if (userSido) {
        if (ps && ps !== userSido) continue
      } else {
        locReason = `${inf.reason} (거주지 확인 필요 — 해당 지역 주민 대상)`
      }
    }
    inferred.push({ ...policy, reason: locReason, priority: inf.priority, confidence: inf.confidence })
  }
  // 추론(저신뢰)은 신뢰도 상위 일부만 — 정밀 매칭은 모두 유지.
  // 민간재단(PRV)은 공공 5,000건과 같은 캡을 두고 경쟁시키지 않는다(전용 💝 섹션의 소스이고
  // 최대 ~20건뿐인데, 데이터가 커지면 신뢰도 컷에 밀려 통째로 사라지는 회귀가 실제 발생).
  inferred.sort((a, b) => b.confidence - a.confidence)
  // 큐레이션 소량 소스(PRV 민간재단·FIN 정책서민금융)는 공공 5,000건과 같은 캡에 밀려 사라지지 않게 전용 레인.
  const prvInferred = inferred.filter((p) => p.id.startsWith('PRV-'))
  const finInferred = inferred.filter((p) => p.id.startsWith('FIN-'))
  const pubInferred = inferred.filter((p) => !/^(PRV|FIN)-/.test(p.id))
  const result = [...precise, ...prvInferred, ...finInferred, ...pubInferred.slice(0, MAX_INFERRED)]
  // 정렬: 우선순위(high>med>low) → 상황 관련도(핵심 상황 우선) → 신뢰도
  result.sort((a, b) => {
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    if (pr !== 0) return pr
    const rel = situationRelevance(b, p) - situationRelevance(a, p)
    if (rel !== 0) return rel
    return b.confidence - a.confidence
  })
  // 대표 급여·같은 프로그램의 사실상 중복 항목을 접어 상위 1개만 남긴다(정렬 후 호출). 결과·탐색 공용.
  return collapseProgramDuplicates(result)
}

/** 프로그램 중복 접기 — 대표급여 그룹 + 이름 정확중복을 POL- 시드에만 적용, 상위(먼저 오는) 1개만.
 *  getEligiblePolicies(결과)와 Explore(탐색 브라우징) 양쪽에서 동일 기준으로 재사용(단일 출처). */
const PROGRAM_DEDUP: { key: string; re: RegExp }[] = [
  { key: '의료급여', re: /^의료급여/ },
  { key: '주거급여', re: /^주거급여/ },
  { key: '교육급여', re: /^교육급여/ },
  { key: '자활근로', re: /자활\s*근로/ },
  // 같은 프로그램이 여러 시드로 중복된 것들(2026 데이터검증에서 확인)
  { key: '문화누리', re: /문화누리|통합문화이용권/ },
  { key: '임신출산진료비', re: /임신.?출산\s*진료비/ },
  { key: '청소년특별지원', re: /청소년\s*특별지원/ },
  { key: '긴급복지', re: /긴급복지지원/ },
  { key: '장애인활동지원', re: /장애인\s*활동지원/ },
  { key: '청년월세', re: /청년\s*월세/ },
  { key: '틀니임플란트', re: /틀니|임플란트/ },
  { key: '산재요양', re: /산재.*요양|산업재해.*요양/ },
]
export function collapseProgramDuplicates<T extends { id: string; name: string }>(list: T[]): T[] {
  const seenGroup = new Set<string>()
  const seenName = new Set<string>()
  return list.filter((pol) => {
    if (!pol.id.startsWith('POL-')) return true
    const g = PROGRAM_DEDUP.find((d) => d.re.test(pol.name))
    if (g) {
      if (seenGroup.has(g.key)) return false
      seenGroup.add(g.key)
    }
    const nm = pol.name.replace(/\s+/g, '')
    if (seenName.has(nm)) return false
    seenName.add(nm)
    return true
  })
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
  '국민기초생활보장 생계급여': {
    desc: '기준 중위소득 32% 이하 가구에 생계급여 기준액에서 소득인정액을 뺀 금액을 매월 지급합니다.',
    steps: [
      '1단계: 주민센터 방문 신청(복지로 온라인도 가능)',
      '2단계: 소득·재산 및 부양의무자 조사',
      '3단계: 소득인정액 산정 후 지급액 결정 (약 2~4주)',
      '4단계: 매월 20일 계좌 지급',
    ],
    tips: '의료·주거·교육급여를 함께 신청하세요. 부양의무자 기준은 대폭 완화되었습니다(생계급여는 2021년 폐지, 일부 고소득 예외).',
    days: 30,
  },
  부모급여: {
    desc: '0세 월 100만원, 1세 월 50만원을 지급합니다(2026년, 어린이집 이용 시 보육료 바우처로 차감·차액 현금).',
    steps: [
      '1단계: 출생신고와 동시에 신청(주민센터 또는 복지로·정부24 온라인)',
      '2단계: 보호자 신분증·통장사본 제출',
      '3단계: 가정양육(현금)·어린이집(바우처) 중 선택',
      '4단계: 신청 다음 달부터 매월 25일 지급',
    ],
    tips: '출생 후 60일 이내 신청 시 출생월부터 소급 지급됩니다. 아동수당·첫만남이용권과 별도로 중복 수급됩니다.',
    days: 7,
  },
  장애인연금: {
    desc: '만 18세 이상 중증장애인 중 소득 하위계층에 기초급여+부가급여를 지급합니다(2026년 월 최대 약 43.9만원).',
    steps: [
      '1단계: 주민센터 방문 또는 복지로 온라인 신청',
      '2단계: 장애정도 심사(국민연금공단) + 소득·재산 조사',
      '3단계: 신청서·금융정보 제공 동의서 제출',
      '4단계: 결과 통보 후 매월 지급',
    ],
    tips: '65세가 되면 기초연금으로 전환되며 유리한 쪽으로 조정됩니다. 활동지원서비스도 함께 신청하세요.',
    days: 30,
  },
  주거급여: {
    desc: '기준 중위소득 48% 이하 가구에 임차료(임차가구) 또는 수선유지비(자가가구)를 지원합니다.',
    steps: [
      '1단계: 주민센터 방문 또는 복지로 온라인 신청',
      '2단계: 소득·재산 조사 및 주택조사(임대차계약서 제출)',
      '3단계: 지역별 기준임대료 한도 내 지급액 결정',
      '4단계: 매월 20일 계좌 지급(임차가구)',
    ],
    tips: '생계·의료급여와 함께 신청하면 편리합니다. 부모와 떨어져 사는 20대는 청년 주거급여 분리지급도 확인하세요.',
    days: 30,
  },
}

// mock_guides 포팅: 적격 정책 상위 5건. 전용 템플릿 없으면 정책 자체 정보로 fallback 가이드 생성.
export function generateGuides(eligible: EligiblePolicy[]): ApplicationGuide[] {
  const guides: ApplicationGuide[] = []
  for (const ep of eligible.slice(0, 5)) {
    // 정확 이름 대신 접두/포함 매칭 — '실업급여 (구직급여)'가 '실업급여' 템플릿과 안 맞아 dead였던 문제 해소
    const key = GUIDE_TEMPLATES[ep.name] ? ep.name : Object.keys(GUIDE_TEMPLATES).find((k) => ep.name.startsWith(k))
    const tmpl = key ? GUIDE_TEMPLATES[key] : undefined
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

  // 안전 직결 — 최우선 노출
  if (events.includes('가정폭력')) {
    notes.push({
      title: '🆘 폭력 피해 긴급 안내',
      message: '위급하면 즉시 112. 여성긴급전화 1366(24시간)에서 안전한 보호시설·상담·법률·의료를 무료로 연결받을 수 있어요.',
      type: 'safety',
    })
  }
  if (events.includes('산재')) {
    notes.push({
      title: '산재 요양급여 청구 안내',
      message: '업무상 재해는 근로복지공단(1588-0075)에 요양급여를 청구하세요(치료비·휴업급여). 요양급여 청구권은 3년 시효가 있어요.',
      type: 'deadline',
    })
  }
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

  // 화면 헤더(맞춤 추천/강력 추천)와 같은 분류로 집계해 숫자가 어긋나지 않게 한다.
  // primary = 정밀 큐레이션(POL-), related = 공공데이터 텍스트신호로 '관련'만(낮은 신뢰)
  const primary = eligible.filter((p) => /^POL-/.test(p.id))
  const related = eligible.filter((p) => !/^(POL|PRV)-/.test(p.id))
  const base = primary.length ? primary : eligible
  const high = base.filter((p) => p.priority === 'high')
  // 가장 먼저 권할 정책은 정밀 추천(primary)에서 신뢰도순으로 — 낮은 신뢰 '관련'이 앞서지 않게.
  const top3 = [...base].sort((a, b) => b.confidence - a.confidence).slice(0, 3)
  const names = top3.map((p) => p.name).join(', ')

  const sentences: string[] = [
    `분석 결과 맞춤 복지 ${base.length}건을 찾았고, ` +
      `그 중 강력 추천이 ${high.length}건입니다.` +
      (related.length ? ` 이 밖에 관련 있어 보이는 복지 ${related.length}건도 아래에 따로 모았어요.` : ''),
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
