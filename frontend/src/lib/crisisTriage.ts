import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 위기 대응 속도 트리아지 — Time-to-Relief Ladder.
 *
 * 긴급 상황에서 사용자가 궁금한 건 '어떤 복지가 있나'가 아니라 '언제 실제로 도움이 오나'다.
 * 정책 텍스트(name/application/benefit/eligibility)의 '도달 속도' 신호만 읽어
 *   지금 당장(선지원 후심사) → 오늘 전화(129·신고) → 이번 주(방문 신청) → 이번 달(심사 후 지급) → 회복 준비
 * 5단 사다리로 재정렬하고, '오늘 할 단 하나'(fastestAction)를 짚어 준다.
 *
 * 정직성 원칙: 금액을 다시 계산하지 않고(Policy를 그대로 담는다), 모든 시간 표기에 '추정'을 붙인다.
 * 버킷은 텍스트 신호 + 선택 입력 estimated_days 로만 정한다(없는 날짜를 날조하지 않는다).
 */

export type SpeedTag = '선지원' | '즉시전화' | '방문' | '심사후'
export type RungWhen = 'now' | 'today' | 'week' | 'month' | 'recovery'

export interface TriageItem {
  policy: Policy
  speedTag: SpeedTag
  /** 예상 도달 시간(항상 '추정' 라벨 포함) */
  timeHint: string
  /** 일회성(일시금·첫만남·해산급여 등) 성격 대략 추론 */
  oneShot: boolean
}

export interface TriageRung {
  when: RungWhen
  label: string
  urgencyNote: string
  items: TriageItem[]
}

export interface TriageResult {
  rungs: TriageRung[]
  fastestAction: TriageItem | null
}

/**
 * 신청 가이드에서 넘어오는 소요일 힌트(선택). ApplicationGuide 등 외부 타입에 하드 의존하지 않도록
 * 로컬 최소 타입으로 둔다 — 배선부에서 { policyId, policyName, estimated_days } 로 매핑해 넘겨준다.
 */
export interface TriageGuideHint {
  policyName?: string
  policyId?: string
  estimated_days?: number
}

// ── 사다리 단계별 표시 메타. 모든 안내에 '추정' 등 정직성 라벨을 포함한다. ──────────────
const RUNG_META: Record<RungWhen, { label: string; note: string }> = {
  now: {
    label: '지금 당장',
    note: '해당되시면 먼저 돕고 심사는 나중에 하는 선지원 성격이에요 — 바로 접수하세요. (추정 · 공식 확인 권장)',
  },
  today: {
    label: '오늘 전화',
    note: '전화 한 통으로 시작돼요 — 129 복지콜센터 등으로 오늘 바로 상담하세요. (추정)',
  },
  week: {
    label: '이번 주',
    note: '가까운 주민센터를 방문해 이번 주 안에 신청하세요. (추정)',
  },
  month: {
    label: '이번 달',
    note: '심사를 거쳐 이번 달 안에 지급될 수 있어요. (추정 · 공식 확인 권장)',
  },
  recovery: {
    label: '회복 준비',
    note: '시간이 걸리는 지원이에요 — 회복기를 위해 미리 준비해 두세요. (추정)',
  },
}

// speedTag → 기본 when 버킷.
const BASE_WHEN: Record<SpeedTag, RungWhen> = {
  선지원: 'now',
  즉시전화: 'today',
  방문: 'week',
  심사후: 'month',
}

// 사다리 순서(빠른 것부터). rungs·fastestAction 산출에 공통 사용.
const LADDER: RungWhen[] = ['now', 'today', 'week', 'month', 'recovery']

/**
 * 정책 한 건의 '도달 속도' 태그를 텍스트 신호로 판별한다.
 * 흐름:
 *   1) name/application/benefit/eligibility 를 한 덩어리로 스캔(contact 전화번호는 보지 않음).
 *   2) 빠른 신호부터 검사(선지원 > 즉시전화 > 방문 > 심사후) — 여러 신호가 겹치면 가장 빠른 것을 채택.
 *   3) '즉시/신속'은 지원·지급 동사와 붙었을 때만 선지원으로 본다('임신 확인 즉시'류 오탐 방지 — 정직성).
 *   4) 어떤 신호도 없으면 심사후(기본).
 */
export function speedTagOf(policy: Policy): SpeedTag {
  const text = `${policy.name || ''} ${policy.application || ''} ${policy.benefit || ''} ${policy.eligibility || ''}`
  // 선지원(선지급·선보호) 또는 '즉시/신속 + 지원/지급/보호/처리' → 먼저 돕고 나중에 심사
  if (/선지원|선지급|선보호|(?:즉시|신속)\s*(?:지원|지급|보호|처리|집행)/.test(text)) return '선지원'
  // 전화·129·1366·신고·상담·콜센터·핫라인 → 오늘 전화 한 통으로 시작
  if (/전화|129|1366|1577|신고|상담|콜센터|핫라인/.test(text)) return '즉시전화'
  // 방문·주민센터·행정복지센터 → 이번 주 방문 신청
  if (/방문|주민센터|행정복지센터/.test(text)) return '방문'
  return '심사후'
}

/**
 * speedTag 와 (선택)소요일로 최종 when 버킷을 정한다.
 * 흐름: 기본은 BASE_WHEN. '과정 기반' 태그(방문·심사후)에만 estimated_days 로 정밀화한다
 *       — 즉시성 태그(선지원·즉시전화)는 소요일이 커도 상단(now/today) 유지(즉시 행동이 요점).
 *       days ≤ 7 → week, 8~30 → month, > 30 → recovery.
 */
function bucketFor(tag: SpeedTag, days?: number): RungWhen {
  if ((tag === '방문' || tag === '심사후') && typeof days === 'number' && days > 0) {
    if (days <= 7) return 'week'
    if (days > 30) return 'recovery'
    return 'month'
  }
  return BASE_WHEN[tag]
}

/**
 * 항목의 예상 도달 시간 문구(항상 '추정'). 흐름:
 *   - 과정 기반 버킷(week/month/recovery)이고 소요일이 있으면 '약 N일 내(추정)'로 구체화.
 *   - 그 외에는 버킷별 정성 문구.
 * (now/today 는 즉시 행동이 요점이라 소요일 대신 정성 문구를 쓴다 — 버킷과 표기 불일치 방지.)
 */
function timeHintFor(when: RungWhen, days?: number): string {
  if ((when === 'week' || when === 'month' || when === 'recovery') && typeof days === 'number' && days > 0) {
    return `약 ${days}일 내(추정)`
  }
  switch (when) {
    case 'now':
      return '접수 즉시(추정)'
    case 'today':
      return '전화 상담 당일(추정)'
    case 'week':
      return '방문 후 이번 주(추정)'
    case 'month':
      return '심사 후 수 주(추정)'
    case 'recovery':
      return '회복기까지 준비(추정)'
  }
}

/**
 * 일회성(일시금) 성격 대략 추론. 흐름:
 *   1) 이름·혜택에 첫만남·해산급여·출산지원금·장제급여·일시금 등 명시 신호가 있으면 일회성.
 *   2) renewal 이 '1회/일시/한 번'인데 혜택이 '월 반복'이 아니면 일회성(국민취업처럼 월지급 프로그램은 제외).
 * 자격 판정과 무관한 부가 표식일 뿐이라 '대략'이면 충분하다.
 */
function inferOneShot(policy: Policy): boolean {
  const nameBenefit = `${policy.name || ''} ${policy.benefit || ''}`
  if (/첫만남|해산급여|해산\s*급여|출산지원금|출산\s*축하|장제급여|장례비|일시금|일시\s*지급|한\s*번에\s*지급/.test(nameBenefit)) {
    return true
  }
  const renew = policy.renewal || ''
  const monthly = /월\s|매월|월별|개월간|달마다/.test(policy.benefit || '')
  if (/1\s*회|일시|한\s*번/.test(renew) && !monthly) return true
  return false
}

/**
 * 위기 정책 목록을 도달 속도 사다리로 재정렬한다. 흐름:
 *   1) 빈 입력이면 { rungs: [], fastestAction: null }.
 *   2) guides(선택)를 policyId/policyName → estimated_days 맵으로 색인.
 *   3) 각 정책: speedTagOf → 매칭 소요일 조회 → bucketFor 로 when 결정 → TriageItem 조립(금액 재계산 없음).
 *   4) LADDER 순서로 비어있지 않은 버킷만 rung 으로, 각 rung 에 label/urgencyNote 부여.
 *   5) fastestAction = 가장 빠른 rung 의 첫 항목(없으면 null).
 */
export function triageCrises(
  policies: (Policy | EligiblePolicy)[],
  opts?: { guides?: TriageGuideHint[] },
): TriageResult {
  if (!policies || policies.length === 0) return { rungs: [], fastestAction: null }

  // guides 색인 — id 우선, 없으면 name 으로 소요일을 찾는다.
  const byId = new Map<string, number>()
  const byName = new Map<string, number>()
  for (const g of opts?.guides || []) {
    if (typeof g.estimated_days !== 'number') continue
    if (g.policyId) byId.set(g.policyId, g.estimated_days)
    if (g.policyName) byName.set(g.policyName, g.estimated_days)
  }
  const daysOf = (p: Policy): number | undefined => {
    const byid = p.id ? byId.get(p.id) : undefined
    if (typeof byid === 'number') return byid
    return p.name ? byName.get(p.name) : undefined
  }

  // 버킷 채우기(입력 순서 보존).
  const buckets: Record<RungWhen, TriageItem[]> = { now: [], today: [], week: [], month: [], recovery: [] }
  for (const p of policies) {
    const tag = speedTagOf(p)
    const days = daysOf(p)
    const when = bucketFor(tag, days)
    buckets[when].push({
      policy: p, // Policy 원본 그대로 — 금액·문구 재계산 없음(정직성)
      speedTag: tag,
      timeHint: timeHintFor(when, days),
      oneShot: inferOneShot(p),
    })
  }

  const rungs: TriageRung[] = LADDER.filter((w) => buckets[w].length > 0).map((w) => ({
    when: w,
    label: RUNG_META[w].label,
    urgencyNote: RUNG_META[w].note,
    items: buckets[w],
  }))

  const fastestAction = rungs.length > 0 ? rungs[0].items[0] : null
  return { rungs, fastestAction }
}
