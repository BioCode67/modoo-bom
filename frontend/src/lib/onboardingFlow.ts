import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 대화형 온보딩(마스코트와 말하듯 프로필 입력)의 '두뇌' — 순수 로직/데이터만.
 * 렌더링(MascotChat.tsx)과 분리해 흐름·매핑을 단위 테스트로 지킨다.
 *
 * 설계 원칙:
 *  - 한 번에 하나씩, 대부분 '탭 한 번'으로 답할 수 있게(어르신·저자력층 접근성).
 *  - 나이는 정책 임계값(19·34·65 등)에 안전한 대표값으로 저장(대략 골라도 자격판정이 어긋나지 않게).
 *  - 조건부 질문(자녀 나이·장애 정도)은 상황 선택 결과에 따라만 등장.
 */

export const EMPTY_PROFILE: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

// 나이 구간 — 대표값은 정책 연령 임계값(19~34 청년, 65+ 어르신 등) 안에 안전하게 들도록 선택
export const AGE_BRACKETS: { label: string; emoji: string; age: number }[] = [
  { label: '18세 이하', emoji: '🧒', age: 16 },
  { label: '19~34세 청년', emoji: '🧑', age: 27 },
  { label: '35~49세', emoji: '🧑‍💼', age: 42 },
  { label: '50~64세', emoji: '👩‍🌾', age: 58 },
  { label: '65세 이상 어르신', emoji: '👵', age: 70 },
]

// 소득 — 생활어(쉬운 말) + 행정 기준 병기 (ProfileWizard와 동일한 값 체계)
export const INCOME_OPTIONS: { label: string; sub: string; emoji: string; value: number }[] = [
  { label: '소득이 적은 편이에요', sub: '하위 25%', emoji: '🌱', value: 25 },
  { label: '가운데보다 낮아요', sub: '중위 50%', emoji: '🌿', value: 50 },
  { label: '딱 가운데쯤이에요', sub: '중위 80%', emoji: '🌾', value: 80 },
  { label: '가운데보다 높아요', sub: '중위 120%', emoji: '🌻', value: 120 },
  { label: '소득이 많은 편이에요', sub: '상위권', emoji: '💰', value: 180 },
]

export const HOUSEHOLD_OPTIONS: { label: string; emoji: string }[] = [
  { label: '1인가구', emoji: '🧍' },
  { label: '신혼부부', emoji: '💑' },
  { label: '다자녀가구', emoji: '👨‍👩‍👧‍👦' },
  { label: '한부모가족', emoji: '👩‍👧' },
  { label: '조손가구', emoji: '👵👦' },
  { label: '다문화가족', emoji: '🌏' },
  { label: '일반가구', emoji: '🏠' },
]

// 상황(복수 선택) — 각 항목이 프로필 여러 필드에 매핑. life_events는 누적(append).
export const SITUATIONS: { id: string; label: string; emoji: string; patch: Partial<UserProfile>; events?: string[] }[] = [
  { id: 'pregnant', label: '임신 중이에요', emoji: '🤰', patch: { is_pregnant: true } },
  { id: 'newborn', label: '최근 아기를 낳았어요', emoji: '🍼', patch: { has_children: true }, events: ['출산'] },
  { id: 'children', label: '어린 자녀가 있어요', emoji: '👶', patch: { has_children: true } },
  { id: 'disability', label: '등록 장애가 있어요', emoji: '♿', patch: { disability: true, disability_grade: '1급' } },
  { id: 'jobless', label: '일자리를 찾고 있어요', emoji: '💼', patch: { employment_status: 'unemployed' }, events: ['실직'] },
  { id: 'student', label: '학생이에요', emoji: '🎓', patch: { employment_status: 'student' } },
  { id: 'sick', label: '아프거나 다쳤어요', emoji: '🏥', patch: {}, events: ['질병'] },
  { id: 'none', label: '해당 없어요', emoji: '🙆', patch: {} },
]

// 자녀 나이대(복수) — 대표 나이로 저장
export const CHILD_AGE_OPTIONS: { label: string; emoji: string; age: number }[] = [
  { label: '0~1세 (영아)', emoji: '🍼', age: 0 },
  { label: '2~5세 (유아)', emoji: '🧸', age: 4 },
  { label: '6~12세 (초등)', emoji: '🎒', age: 9 },
  { label: '13~18세 (청소년)', emoji: '📚', age: 15 },
]

export const DISABILITY_OPTIONS: { label: string; value: string }[] = [
  { label: '심한 장애 (중증)', value: '1급' },
  { label: '심하지 않은 장애 (경증)', value: '4급' },
  { label: '지적장애', value: '지적' },
  { label: '자폐성장애', value: '자폐' },
  { label: '잘 모르겠어요', value: '기타' },
]

export const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']

/** 상황(복수) 선택 → 프로필 패치 병합. life_events는 중복 없이 누적. */
export function applySituations(base: UserProfile, ids: string[]): UserProfile {
  let next: UserProfile = { ...base }
  const events = new Set(base.life_events)
  for (const s of SITUATIONS) {
    if (!ids.includes(s.id)) continue
    next = { ...next, ...s.patch }
    for (const e of s.events ?? []) events.add(e)
  }
  next.life_events = [...events]
  // 자녀 있음이면 최소 1개 나이 자리 확보(뒤 단계에서 실제 나이 채움)
  if (next.has_children && next.children_ages.length === 0) next.children_ages = [0]
  return next
}

export type StepId = 'name' | 'age' | 'income' | 'household' | 'situations' | 'childAges' | 'disability' | 'region'
export const STEP_ORDER: StepId[] = ['name', 'age', 'income', 'household', 'situations', 'childAges', 'disability', 'region']

/** 해당 단계가 현재 프로필에서 물어볼 필요가 있는지(조건부 질문 게이팅). */
export function isStepActive(id: StepId, p: UserProfile): boolean {
  if (id === 'childAges') return p.has_children
  if (id === 'disability') return p.disability
  return true
}

/** 현재 단계 다음에 물어볼 단계(없으면 null=완료). */
export function nextStep(current: StepId, p: UserProfile): StepId | null {
  const i = STEP_ORDER.indexOf(current)
  for (let j = i + 1; j < STEP_ORDER.length; j++) {
    if (isStepActive(STEP_ORDER[j], p)) return STEP_ORDER[j]
  }
  return null
}

/** 진행률(0~1) — 활성 단계 기준. */
export function progressOf(current: StepId, p: UserProfile): number {
  const active = STEP_ORDER.filter((s) => isStepActive(s, p))
  const idx = active.indexOf(current)
  return active.length ? (idx + 1) / active.length : 1
}

/** 답변에 대한 마스코트의 짧은 리액션(대화감). 없으면 빈 문자열. */
export function mascotReaction(step: StepId, p: UserProfile): string {
  if (step === 'age') {
    if (p.age >= 65) return '어르신을 위한 복지가 정말 많아요. 꼼꼼히 찾아드릴게요! 🌷'
    if (p.age <= 34 && p.age >= 19) return '청년을 위한 지원이 많답니다. 좋아요! ✨'
  }
  if (step === 'income' && p.income_percentile <= 50) return '네, 도움이 되는 제도를 빠짐없이 살펴볼게요. 🌱'
  if (step === 'situations') {
    if (p.disability) return '활동지원·의료비 등 챙길 게 많아요. 잘 오셨어요.'
    if (p.is_pregnant || p.life_events.includes('출산')) return '축하드려요! 임신·출산 지원을 모아드릴게요. 🍼'
    if (p.has_children) return '아이 키우시는군요! 육아 지원이 든든하게 있어요. 👶'
    if (p.employment_status === 'unemployed') return '괜찮아요, 다시 일어설 수 있게 돕는 제도가 있어요. 💪'
  }
  return ''
}
