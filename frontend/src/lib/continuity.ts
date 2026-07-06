import { getEligiblePolicies, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 연속성 에이전트 — 지속적 관계·경험 축적.
 *
 * 방문마다 프로필 스냅샷을 브라우저(localStorage)에 쌓아, 지난 방문 이후 '무엇이 달라졌고
 * 그래서 어떤 복지가 새로 열렸는지'를 선제적으로 안내한다. 질문-응답을 넘어 사용자와의
 * 지속적 상호작용으로 경험을 축적하는 능동형 에이전트의 핵심.
 *
 * 모든 데이터는 사용자 브라우저에만 저장되고 서버로 전송되지 않는다(프라이버시 우선).
 */
const KEY = 'modoo:profileHistory'
const MAX = 5

export interface Snapshot { profile: UserProfile; at: number }
export interface ProfileChange { label: string; from: string; to: string; kind: 'up' | 'down' | 'change' }

const EMP: Record<string, string> = {
  employed: '재직 중', unemployed: '미취업/구직', student: '학생', self: '자영업', retired: '은퇴',
}

function safeGet(): Snapshot[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch { return [] }
}

export function getLastSnapshot(): Snapshot | null {
  const h = safeGet()
  return h.length ? h[h.length - 1] : null
}

/** 현재 프로필을 스냅샷으로 기록(직전과 동일하면 중복 저장하지 않음). */
export function recordSnapshot(profile: UserProfile, now: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    const h = safeGet()
    const last = h[h.length - 1]
    if (last && profilesEqual(last.profile, profile)) return
    // 최소저장: 이름(호칭)은 이력에 남기지 않는다 — diff 비교(FIELDS)에도 불필요(개인정보 노출면 축소)
    h.push({ profile: { ...profile, name: '' }, at: now })
    localStorage.setItem(KEY, JSON.stringify(h.slice(-MAX)))
  } catch { /* 저장 실패는 조용히 무시(핵심 기능 아님) */ }
}

const FIELDS: (keyof UserProfile)[] = [
  'age', 'income_percentile', 'household_type', 'employment_status',
  'is_pregnant', 'has_children', 'disability',
]

export function profilesEqual(a: UserProfile, b: UserProfile): boolean {
  for (const f of FIELDS) if (a[f] !== b[f]) return false
  if ((a.children_ages || []).join(',') !== (b.children_ages || []).join(',')) return false
  if ((a.life_events || []).join(',') !== (b.life_events || []).join(',')) return false
  return true
}

/** 지난 프로필 대비 사람이 읽을 수 있는 변화 목록. */
export function diffProfiles(prev: UserProfile, curr: UserProfile): ProfileChange[] {
  const out: ProfileChange[] = []
  if (prev.age !== curr.age)
    out.push({ label: '나이', from: `${prev.age}세`, to: `${curr.age}세`, kind: curr.age > prev.age ? 'up' : 'change' })
  if (prev.income_percentile !== curr.income_percentile)
    out.push({ label: '소득수준', from: `중위 ${prev.income_percentile}%`, to: `중위 ${curr.income_percentile}%`, kind: curr.income_percentile < prev.income_percentile ? 'down' : 'up' })
  if (prev.household_type !== curr.household_type && curr.household_type)
    out.push({ label: '가구유형', from: prev.household_type || '-', to: curr.household_type, kind: 'change' })
  if (prev.employment_status !== curr.employment_status)
    out.push({ label: '고용상태', from: EMP[prev.employment_status] || prev.employment_status || '-', to: EMP[curr.employment_status] || curr.employment_status || '-', kind: 'change' })
  if (prev.is_pregnant !== curr.is_pregnant)
    out.push({ label: '임신', from: prev.is_pregnant ? '있음' : '없음', to: curr.is_pregnant ? '있음' : '없음', kind: 'change' })
  if (prev.has_children !== curr.has_children || (prev.children_ages || []).join(',') !== (curr.children_ages || []).join(','))
    out.push({ label: '자녀', from: (prev.children_ages || []).length ? `${prev.children_ages.length}명` : '없음', to: (curr.children_ages || []).length ? `${curr.children_ages.length}명(${curr.children_ages.join('·')}세)` : '없음', kind: 'change' })
  if (prev.disability !== curr.disability)
    out.push({ label: '장애', from: prev.disability ? '있음' : '없음', to: curr.disability ? '있음' : '없음', kind: 'change' })
  const newEvents = (curr.life_events || []).filter((e) => !(prev.life_events || []).includes(e))
  for (const e of newEvents) out.push({ label: '생애 사건', from: '-', to: e, kind: 'change' })
  return out
}

/** 변화로 인해 새로 자격이 생긴 복지(엔진 diff).
 *  ⚠️ '새로 받을 수 있는 복지'라는 단정 표기라, 저신뢰 '관련 복지'(공공데이터 요약·민간재단 PRV·서민금융 대출 FIN)는
 *  제외하고 **정밀 매칭(POL- 시드)** 만 비교한다. 그래야 심사·선발형·대출을 '받을 수 있다'고 과장하지 않고(정직성),
 *  120건 상한(inferred)의 랭킹 변동이 '새로 열림'으로 오표시되는 것도 막는다. */
const isPrecise = (p: EligiblePolicy) => /^POL-/.test(p.id)
export function newlyUnlocked(prev: UserProfile, curr: UserProfile): EligiblePolicy[] {
  const prevIds = new Set(getEligiblePolicies(prev).filter(isPrecise).map((p) => p.id))
  return getEligiblePolicies(curr).filter(isPrecise).filter((p) => !prevIds.has(p.id))
}

/** 이 앱이 기기에 남긴 데이터 전부 삭제 — 초기화·'다시 분석' 등에서 사용(개인정보처리방침 §5 이행). */
export function clearLocalData(): void {
  try {
    if (typeof localStorage === 'undefined') return
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('modoo:') || k.startsWith('modoobom-')) localStorage.removeItem(k)
    }
    try { sessionStorage.removeItem('modoo-chat-draft-v1') } catch { /* noop */ }
  } catch { /* noop */ }
}
