// 오해 진단 — 복지 통념 교정기(Misconception Buster).
// 복지 미신청의 최대 원인은 '틀린 확신'(부양의무자·재산·근로소득 오해)이다.
// 프로필 + getEligiblePolicies 결과에 '실제로 걸리는' 통념만 골라, 2026 구조 규칙으로 반박하고
// 근거로 적격 정책의 eligibility/target 원문을 인용해 개인화한다.
//
// 정직성 원칙(모두봄 핵심):
//   · 자격을 재판정/게이트하지 않는다(기존 엔진 결과를 그대로 존중).
//   · 검증 못 하는 정부 정액·연도 고시값을 새로 날조하지 않는다 — '구조 규칙 + 원문 파싱'에만 의존.
//   · 각 반박(truth) 끝에 '일반 안내이며 최종 자격은 심사에서 확정' 취지를 반드시 노출.
import type { EligiblePolicy, UserProfile } from '@/lib/welfare-engine'
import { disabilityLabel } from '@/lib/welfare-engine'

export type MythSeverity = 'blocks' | 'reduces' | 'info'

/** 이 프로필에 실제로 걸린 통념 1건(반박·근거·왜 걸리는지 포함). */
export interface Myth {
  id: string
  belief: string // 흔한 통념(틀린 확신) 원문
  truth: string // 구조 규칙 기반 반박(끝에 정직성 라벨 포함)
  evidencePolicyIds: string[] // 근거로 인용한 적격 정책 id(없으면 빈 배열)
  evidenceText: string // 인용한 적격 정책 원문 1건(없으면 규칙 기본 근거)
  severity: MythSeverity // blocks(아예 포기) > reduces(과소·지연) > info(인지)
  appliesWhy: string // 이 프로필에 왜 걸리는지 한 문장(프로필에서 유도)
}

/** 통념 규칙 — 구조 규칙 하나 + '이 프로필에 걸리는지' 판정기. */
export interface MythRule {
  id: string
  belief: string
  truth: string
  severity: MythSeverity
  /** 이 통념이 이 프로필+적격결과에 실제로 걸리는지(프로필 신호 + 적격 정책 존재로만 판단, 자격 재판정 없음). */
  trigger: (p: UserProfile, eligible: EligiblePolicy[]) => boolean
  /** 반박을 뒷받침하는 근거가 이 적격 정책의 eligibility/target 원문에 있는지. */
  evidenceMatch: (pol: EligiblePolicy) => boolean
  /** 이 프로필에 왜 걸리는지 사람이 읽는 한 문장(프로필에서 유도). */
  appliesWhy: (p: UserProfile) => string
  /** 근거 원문을 못 찾을 때 쓰는 규칙 기본 근거(구조 규칙 문장). */
  basis: string
  /** 적격 정책 원문에서 근거 '절'을 뽑아낼 때 쓰는 패턴(전역 플래그 g 금지 — .test 상태 오염 방지). */
  evidenceRe: RegExp
}

// 모든 반박 끝에 붙는 정직성 라벨 — '이건 확정이 아니라 일반 안내'임을 데이터에 각인.
const HONESTY = ' 일반 안내이며, 최종 자격은 신청 후 행정 심사에서 확정돼요.'

// ── 근거 패턴(적격 정책 eligibility/target 원문에서 반박을 뒷받침하는 신호) ──
//   전부 비-전역(no /g): 반복 .test에도 lastIndex 오염이 없어야 한다.
const ASSET_RE = /소득인정액|기본재산|부채|소득\s*환산|재산/
const DEPENDANT_RE = /부양의무자/
const WORK_RE = /근로소득|차상위|자활|근로능력/
const REAPPLY_RE = /재신청|재판정|변동\s*시|상황\s*변경|재확인/
const DISABILITY_RE = /등록\s*장애인|장애수당|장애인|장애/
const FOREIGNER_RE = /다문화|결혼이민|귀화|영주|난민|외국인|이주/

/** 근거 스캔 대상 원문 — 정책의 eligibility + target(자격 재판정과 무관, 인용용). */
function docOf(pol: EligiblePolicy): string {
  return `${pol.eligibility || ''} ${pol.target || ''}`
}

// evidenceMatch(적격 정책이 이 반박을 뒷받침하는가) — 규칙별 명명 함수(trigger·정렬 임팩트와 공유).
const matchAsset = (pol: EligiblePolicy): boolean => ASSET_RE.test(docOf(pol))
const matchDependant = (pol: EligiblePolicy): boolean => DEPENDANT_RE.test(docOf(pol))
const matchWork = (pol: EligiblePolicy): boolean => WORK_RE.test(docOf(pol))
const matchReapply = (pol: EligiblePolicy): boolean => REAPPLY_RE.test(docOf(pol))
// 경증 장애 근거: 장애 관련이지만 '중증장애인' 하드조건이 아닌 정책(경증도 대상임을 보여줌).
const matchDisabilityMild = (pol: EligiblePolicy): boolean =>
  /장애/.test(docOf(pol)) && !/중증장애인|중증\s*장애/.test(pol.eligibility || '')
const matchForeigner = (pol: EligiblePolicy): boolean => FOREIGNER_RE.test(docOf(pol))

/** 등록 장애인이면서 '경증(심하지 않은 장애)'으로 확인되는가 — 확인 안 되면 false(모르면 단정 안 함). */
function isMildDisability(p: UserProfile): boolean {
  if (!p.disability) return false
  const g = (p.disability_grade || '').trim()
  if (/중증|심한/.test(g)) return false
  if (/지적|자폐/.test(g)) return false // 법상 항상 '심한 장애(중증)'로 등록 → 경증 아님
  return /4급|5급|6급|경증|심하지\s*않/.test(g) || ['4', '5', '6'].includes(g)
}

const hasElig = (e: EligiblePolicy[] | undefined): boolean => (e || []).length > 0

// ── 구조 규칙셋 ── (전부 '구조 규칙/텍스트'만 — 정부 정액·특정 고시값 날조 없음)
export const MYTH_RULES: MythRule[] = [
  {
    id: 'asset',
    belief: '재산이 조금이라도 있으면(집·차·약간의 저축) 복지를 못 받는다.',
    truth:
      '재산이 조금 있다고 자동 탈락하지 않아요. 재산은 「소득인정액」으로 환산할 때 기본재산액과 부채를 먼저 공제하고, 남은 부분만 소득으로 반영해요.' +
      HONESTY,
    severity: 'blocks',
    trigger: (p, e) => (p.income_percentile ?? 0) <= 70 && (e || []).some(matchAsset),
    evidenceMatch: matchAsset,
    appliesWhy: (p) =>
      `소득이 기준 중위 ${p.income_percentile ?? 0}% 수준이라 소득·재산 심사가 있는 급여의 후보예요 — 약간의 저축·집·차가 있다고 지레 포기하기 쉬운 상황이에요.`,
    basis: '「소득인정액」은 재산을 소득으로 환산할 때 기본재산액·부채를 공제하는 구조예요(구조 규칙).',
    evidenceRe: ASSET_RE,
  },
  {
    id: 'dependant',
    belief: '자식(부양의무자)이 있으면 그 소득 때문에 복지를 못 받는다.',
    truth:
      '자녀·부모가 있다고 못 받는 게 아니에요. 생계·의료급여 등 상당수 급여에서 부양의무자 기준이 대부분 폐지·완화됐어요(고소득·고재산 예외만 남음).' +
      HONESTY,
    severity: 'blocks',
    trigger: (p, e) =>
      (p.has_children || (p.age ?? 0) >= 60) && (p.income_percentile ?? 0) <= 60 && (e || []).some(matchDependant),
    evidenceMatch: matchDependant,
    appliesWhy: (p) =>
      `${p.has_children ? '자녀' : '가족'}가 있어 '부양의무자(가족) 때문에 안 될 것'이라 미리 포기하기 쉬운 조건이에요.`,
    basis: '생계·의료급여 등에서 부양의무자 기준이 대부분 폐지·완화된 구조예요(구조 규칙).',
    evidenceRe: DEPENDANT_RE,
  },
  {
    id: 'work',
    belief: '일을 시작하면 받던 복지가 곧바로 다 끊긴다.',
    truth:
      '일하면 곧바로 다 끊기는 게 아니에요. 근로소득은 약 30%가량을 공제한 뒤 반영되고, 소득이 늘어도 차상위 등 자격이 유지되는 구간이 있어 단계적으로 조정돼요.' +
      HONESTY,
    severity: 'reduces',
    trigger: (p, e) => ['employed', 'self'].includes(p.employment_status) && (p.income_percentile ?? 0) <= 60 && hasElig(e),
    evidenceMatch: matchWork,
    appliesWhy: () => `일하고 계셔서 '일하면 받던 게 끊길까' 걱정으로 신청을 미루기 쉬운 상황이에요.`,
    basis: '근로소득공제(약 30%)와 차상위 유지 구간이 있어 소득이 늘어도 단계적으로 조정돼요(구조 규칙).',
    evidenceRe: WORK_RE,
  },
  {
    id: 'reapply',
    belief: '한 번 떨어졌으니(신청했다 안 됐으니) 이제 끝이다.',
    truth:
      '한 번 탈락했어도 끝이 아니에요. 소득·가구원수·재산 등 상황이 바뀌면 언제든 다시 신청할 수 있고, 새 기준으로 다시 판정받아요.' +
      HONESTY,
    severity: 'blocks',
    trigger: (p, e) => hasElig(e) && (p.life_events || []).some((ev) => /실직|실업|폐업|해고|질병|출산|이혼|사망|장애/.test(ev)),
    evidenceMatch: matchReapply,
    appliesWhy: (p) => {
      const ev = (p.life_events || []).find((e) => /실직|실업|폐업|해고|질병|출산|이혼|사망|장애/.test(e)) || '상황 변화'
      return `최근 ${ev} 등 변화가 있어, 예전에 안 됐더라도 지금은 다시 신청하면 될 수 있어요.`
    },
    basis: '소득·가구 상황이 바뀌면 다시 신청·재판정받을 수 있어요(구조 규칙).',
    evidenceRe: REAPPLY_RE,
  },
  {
    id: 'disability-mild',
    belief: '경증(심하지 않은) 장애는 복지 대상이 아니다.',
    truth:
      '경증이라 안 되는 게 아니에요. 장애수당·감면·활동지원 등 등록 장애인이면 경증도 대상인 복지가 많아요(급여별로 중증 조건이 따로 있는 경우만 제외).' +
      HONESTY,
    severity: 'reduces',
    trigger: (p, e) => isMildDisability(p) && (e || []).some(matchDisabilityMild),
    evidenceMatch: matchDisabilityMild,
    appliesWhy: (p) => `${disabilityLabel(p.disability_grade)}로 등록돼 있어 '경증은 복지 대상이 아니다'라고 오해하기 쉬워요.`,
    basis: '등록 장애인이면 경증도 대상인 복지가 많아요(구조 규칙).',
    evidenceRe: DISABILITY_RE,
  },
  {
    id: 'foreigner',
    belief: '외국인·이주민은 복지를 받을 수 없다.',
    truth:
      '외국인이라 무조건 안 되는 게 아니에요. 결혼이민자·영주권자·난민 인정자 등은 대상이 되는 복지가 있고, 다문화가족 전용 지원도 별도로 있어요.' +
      HONESTY,
    severity: 'info',
    trigger: (p, e) =>
      ((p.household_type || '').includes('다문화') || (p.life_events || []).some((ev) => /외국인|이주|다문화/.test(ev))) &&
      (e || []).some(matchForeigner),
    evidenceMatch: matchForeigner,
    appliesWhy: (p) => {
      const tag = (p.household_type || '').includes('다문화') ? '다문화가족' : '이주·외국인 배경'
      return `${tag}이라 '외국인은 복지가 안 된다'는 오해로 받을 수 있는 지원을 놓치기 쉬워요.`
    },
    basis: '결혼이민·영주·난민 인정 등 일부 체류자격은 복지 대상이에요(구조 규칙).',
    evidenceRe: FOREIGNER_RE,
  },
  {
    id: 'single',
    belief: '1인 가구라 받을 수 있는 복지가 별로 없다.',
    truth:
      '1인 가구도 대상인 복지가 많아요. 주거급여·청년/노인 주거지원·기초생활보장·긴급복지 등은 1인 가구를 폭넓게 지원해요.' +
      HONESTY,
    severity: 'reduces',
    trigger: (p, e) => (p.household_type || '').includes('1인') && hasElig(e),
    evidenceMatch: (pol) => /1인|단독|독거|혼자|1명|주거/.test(docOf(pol)),
    appliesWhy: () => '1인 가구라 복지가 적을 거라 여기기 쉽지만, 1인 가구 대상 지원이 꽤 있어요.',
    basis: '1인 가구도 주거·기초생활·긴급복지 등 다양한 복지 대상이에요(구조 안내).',
    evidenceRe: /1인|단독|독거|주거/,
  },
  {
    id: 'middle-income',
    belief: '나는 소득이 낮지 않아서(중산층이라) 복지 대상이 아니다.',
    truth:
      '소득과 무관하게 받는 복지도 많아요. 아동수당·출산지원·건강검진·교육 등은 소득을 보지 않고, 중위소득 100~150%까지 대상인 복지도 있어요.' +
      HONESTY,
    severity: 'info',
    trigger: (p, e) => (p.income_percentile ?? 0) >= 50 && (p.income_percentile ?? 0) <= 95 && hasElig(e),
    evidenceMatch: (pol) => /소득\s*무관|누구나|전\s*국민|소득\s*(기준\s*)?없|150%|120%|100%|아동수당|출산/.test(docOf(pol)),
    appliesWhy: (p) => `소득이 중위 ${p.income_percentile ?? 0}% 정도라 '나는 대상이 아니다'라고 지레 여기기 쉬운데, 소득 무관 복지도 있어요.`,
    basis: '아동수당·출산·교육 등은 소득과 무관하고, 중위 100~150% 대상 복지도 있어요(구조 안내).',
    evidenceRe: /소득|누구나|아동|출산|교육/,
  },
  // ── 태도 장벽(자격이 아니라 마음가짐) — 카드로 자동 노출하지 않고(trigger:false) '대화에서 그 말이 나올 때만' 바로잡는다 ──
  {
    id: 'complex',
    belief: '신청 절차가 복잡하고 어려워서 나는 못 할 것 같다.',
    truth:
      '복잡해 보여도 대부분 주민센터 방문 한 번이나 복지로 온라인 신청으로 끝나요. 서류도 행정정보 공동이용 동의로 상당수 생략되고, 어려우면 주민센터 담당자가 곁에서 도와줘요.' +
      HONESTY,
    severity: 'reduces',
    trigger: () => false, // 카드 자동노출 안 함 — 대화 인텐트 전용
    evidenceMatch: () => false,
    appliesWhy: () => '신청이 복잡해 보여 미루기 쉽지만, 생각보다 간단하고 도와줄 곳이 있어요.',
    basis: '대부분 주민센터 1회 방문·복지로 온라인으로 신청되고, 서류는 공동이용으로 줄어요(구조 안내).',
    evidenceRe: /복지로|주민센터|온라인/,
  },
  {
    id: 'healthy',
    belief: '나는 건강해서 해당되는 복지가 없다.',
    truth:
      '복지는 아플 때만 주는 게 아니에요. 소득·나이·주거·양육·고용처럼 건강과 무관한 기준으로 받는 복지가 훨씬 많아요.' +
      HONESTY,
    severity: 'info',
    trigger: () => false,
    evidenceMatch: () => false,
    appliesWhy: () => '건강하셔도 소득·주거·양육 등 다른 기준으로 받을 수 있는 복지가 많아요.',
    basis: '복지 자격은 질병 외 소득·연령·주거·양육·고용 등 다양한 기준으로 정해져요(구조 안내).',
    evidenceRe: /소득|주거|양육|고용|연령/,
  },
]

/** 긴 원문을 카드용으로 자름(정직하게 …로 표기). */
function truncate(s: string, n: number): string {
  const t = (s || '').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** 원문에서 근거 패턴이 들어있는 '절' 하나만 추출(쉼표·세미콜론 단위). 없으면 null. */
function clauseWith(text: string, re: RegExp): string | null {
  const t = text || ''
  if (!t) return null
  const parts = t
    .split(/[,，、;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.find((s) => re.test(s)) || null
}

/**
 * 반박을 뒷받침하는 적격 정책 원문 1건을 고른다(개인화의 핵심).
 * 흐름:
 *   1) 적격 목록을 순회하며 evidenceMatch가 참인 첫 정책을 찾는다.
 *   2) 그 정책의 eligibility(→target 순)에서 근거 '절'만 뽑아 '정책명 — 원문' 형태로 인용.
 *   3) 근거를 못 찾으면 규칙의 기본 근거(basis, 구조 규칙 문장)로 폴백(빈 ids).
 * 자격을 재판정하지 않고 '이미 적격인 정책의 원문'만 인용한다(정직성).
 */
export function pickEvidence(rule: MythRule, eligible: EligiblePolicy[]): { ids: string[]; text: string } {
  const list = eligible || []
  for (const pol of list) {
    let matched = false
    try {
      matched = rule.evidenceMatch(pol)
    } catch {
      matched = false
    }
    if (!matched) continue
    const src = pol.eligibility || pol.target || ''
    const clause = clauseWith(pol.eligibility || '', rule.evidenceRe) || clauseWith(pol.target || '', rule.evidenceRe) || src
    return { ids: [pol.id], text: `${pol.name} — ${truncate(clause, 90)}` }
  }
  return { ids: [], text: rule.basis }
}

/**
 * 이 프로필에 '실제로 걸리는' 통념만 골라 반박 카드로 반환한다.
 * 흐름:
 *   1) 각 규칙의 trigger(프로필 신호 + 적격 정책 존재)로 걸리는 통념만 선별(자격 재판정 없음).
 *   2) 규칙별로 적격 정책 원문 근거를 인용(pickEvidence)해 Myth를 만든다.
 *   3) 정렬: severity(blocks>reduces>info) → 프로필 임팩트(근거로 걸리는 적격 정책 수)가 큰 순.
 * 걸린 게 없으면(적격 없음·신호 없음) 빈 배열 — 억지로 겁주지 않는다(정직성).
 */
export function matchMyths(p: UserProfile, eligible: EligiblePolicy[]): Myth[] {
  const elig = eligible || []
  const rows = MYTH_RULES.filter((r) => {
    try {
      return r.trigger(p, elig)
    } catch {
      return false
    }
  }).map((r) => {
    const ev = pickEvidence(r, elig)
    // 프로필 임팩트: 이 통념이 실제로 영향을 주는 적격 정책 수(많을수록 개인화·관련도 높음).
    const impact = elig.filter((pol) => {
      try {
        return r.evidenceMatch(pol)
      } catch {
        return false
      }
    }).length
    let why = ''
    try {
      why = r.appliesWhy(p)
    } catch {
      why = ''
    }
    const myth: Myth = {
      id: r.id,
      belief: r.belief,
      truth: r.truth,
      evidencePolicyIds: ev.ids,
      evidenceText: ev.text,
      severity: r.severity,
      appliesWhy: why,
    }
    return { myth, impact }
  })

  const rank: Record<MythSeverity, number> = { blocks: 0, reduces: 1, info: 2 }
  rows.sort((a, b) => {
    const s = rank[a.myth.severity] - rank[b.myth.severity]
    if (s !== 0) return s
    return b.impact - a.impact // 같은 심각도면 임팩트 큰 통념 먼저
  })
  return rows.map((x) => x.myth)
}
