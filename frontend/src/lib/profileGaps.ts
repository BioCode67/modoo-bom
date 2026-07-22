// 숨은 자격 발굴기(profileGaps) — 프로필에서 '아니오/공백'으로 남은 차원을 되짚어
// "혹시 이것도 해당되세요?"라고 선제적으로 물어보는 순수 로직.
//
// 목적: 사용자가 위저드에서 무심코 비워둔 축(등록 장애·임신·자녀·실직·한부모/다문화·저소득)이
// 사실은 큰 복지 사각지대일 수 있다. 각 축을 '대표 자격값'으로 가정(flip)해 복지 목록이 어떻게
// 바뀌는지 diff를 내고, 새로 열리는 복지 수·월 현금 증가분(추정)이 큰 순으로 되물음을 만든다.
//
// 정직성 원칙(모두봄 핵심):
//  - 자격을 재판정·게이트하지 않는다. 기존 엔진(getEligiblePolicies) 결과를 그대로 존중해 diff만 낸다.
//  - 새 금액/연도값을 날조하지 않는다. 금액은 오직 카탈로그 문구를 sumCashMonthly로 파싱한 값.
//  - 사실 단정 금지 — note/질문에 '추정 · 해당되시면'을 붙이고 '혹시 …세요?'로 되묻는다.
//  - 새로 열리는 게 없으면(newCount 0) 헛질문이므로 제외한다.
//  - 전부 온디바이스 순수 함수(외부 호출 없음).

import { getEligiblePolicies, type UserProfile } from '@/lib/welfare-engine'
import { formatWon, parseMonthly, sumCashMonthly } from '@/lib/format'

/** 진단 대상 차원 키 — 프로필에서 자주 '아니오/공백'으로 남는 축들. */
export type GapKey =
  | 'disability'
  | 'pregnant'
  | 'children'
  | 'unemployed'
  | 'singleParent'
  | 'multicultural'
  | 'lowIncome'

/** 한 차원의 선제 질문 결과(임팩트 포함). */
export interface GapProbe {
  key: GapKey
  /** 사용자에게 되묻는 한 문장('혹시 …세요?'). 사실 단정이 아닌 질문. */
  question: string
  /** '해당된다면'을 전제한 짧은 가정 라벨(예: '등록 장애가 있다면'). */
  assumeLabel: string
  /** 이 차원이 해당될 때 새로 열리는 복지 수(baseline 대비 id 기준 증가분). */
  newCount: number
  /** 새로 열리는 복지의 월 현금 합계 추정(최대치 — 중복수급 제한 미반영). */
  monthlyDelta: number
  /** 새로 열리는 복지 예시(현금 큰 순). */
  examples: { id: string; name: string }[]
  /** 정직성 라벨을 담은 안내 문구('추정 · 해당되시면 …'). */
  note: string
}

/** 한 차원의 정의 — 비어있는지 판정(isEmpty) + 대표 자격값 가정(flip) + 되물음 문구. */
export interface GapDimension {
  key: GapKey
  /** true면 이 축이 '아니오/공백'이라 되물을 가치가 있음. 이미 채워졌으면 false(스킵). */
  isEmpty: (p: UserProfile) => boolean
  /** 이 축만 대표 자격값으로 가정한 가설 프로필(원본 불변, 얕은 복사 후 해당 필드만 변경). */
  flip: (p: UserProfile) => UserProfile
  question: string
  assumeLabel: string
}

/**
 * 차원 정의 목록(단일 출처). flipProfile·scanProfileGaps가 공유한다.
 *
 * 대표 자격값 선정 근거:
 *  - disability: 등록 장애 + 정도값 '중증'(엔진의 /중증|심한/ 매칭 → 중증장애인 정책까지 열림).
 *  - children: 만 3세 1명(아동수당·보육료·아이돌봄 등 영유아 대표 정책이 열리는 대표 나이).
 *  - unemployed: employment_status='unemployed' + life_events '실직'(실업급여·국민취업지원 신호).
 *  - singleParent: household_type='한부모가족'(엔진 /한부모|조손/ 매칭 + 앱의 표준 가구유형 값).
 *  - multicultural: household_type='다문화가족'(엔진은 정확일치 '다문화가족'을 요구).
 *  - lowIncome: 중위 30%(생계 32·의료 40 등 저소득 급여가 열리는 대표 소득 수준).
 * 값은 어디까지나 '대표 예시'이며, 실제 자격·금액은 신청 시 확정됨을 note에서 밝힌다.
 */
export const GAP_DIMENSIONS: GapDimension[] = [
  {
    key: 'disability',
    // disability=true면 이미 채워짐(스킵).
    isEmpty: (p) => !p.disability,
    flip: (p) => ({ ...p, disability: true, disability_grade: '중증' }),
    question: '혹시 본인이나 가족 중 등록된 장애가 있으세요?',
    assumeLabel: '등록 장애(중증)가 있다면',
  },
  {
    key: 'pregnant',
    isEmpty: (p) => !p.is_pregnant,
    flip: (p) => ({ ...p, is_pregnant: true }),
    question: '혹시 임신 중이거나 출산 예정이신가요?',
    assumeLabel: '임신 중이라면',
  },
  {
    key: 'children',
    // 자녀 여부·나이 배열이 모두 비어야 '공백'으로 본다(무가드 접근 금지 — 항상 방어).
    isEmpty: (p) => !p.has_children && (p.children_ages || []).length === 0,
    flip: (p) => ({ ...p, has_children: true, children_ages: [3] }),
    question: '혹시 양육 중인 어린 자녀가 있으세요?',
    assumeLabel: '어린 자녀(만 3세)가 있다면',
  },
  {
    key: 'unemployed',
    // 이미 실직 신호(무직 상태 또는 실직류 생애이벤트)가 있으면 스킵.
    isEmpty: (p) =>
      p.employment_status !== 'unemployed' &&
      !(p.life_events || []).some((e) => /실직|실업|폐업|해고|권고사직/.test(e)),
    flip: (p) => ({
      ...p,
      employment_status: 'unemployed',
      life_events: [...(p.life_events || []), '실직'],
    }),
    question: '혹시 실직하셨거나 구직 중이신가요?',
    assumeLabel: '실직·구직 중이라면',
  },
  {
    key: 'singleParent',
    isEmpty: (p) => !/한부모|조손/.test(p.household_type || ''),
    // 엔진은 /한부모|조손/ 정규식과 정확일치 '한부모가족' 둘 다 인식 → 앱 표준값 '한부모가족' 사용.
    flip: (p) => ({ ...p, household_type: '한부모가족' }),
    question: '혹시 한부모 또는 조손 가정이신가요?',
    assumeLabel: '한부모·조손 가정이라면',
  },
  {
    key: 'multicultural',
    isEmpty: (p) =>
      !(p.household_type || '').includes('다문화') &&
      !(p.life_events || []).some((e) => /다문화|이주|결혼이민/.test(e)),
    // 엔진의 다문화 분기는 household_type === '다문화가족' 정확일치를 요구.
    flip: (p) => ({ ...p, household_type: '다문화가족' }),
    question: '혹시 다문화·결혼이민 가정이신가요?',
    assumeLabel: '다문화가족이라면',
  },
  {
    key: 'lowIncome',
    // 이미 중위 40% 이하면 저소득으로 채워진 셈(스킵).
    isEmpty: (p) => p.income_percentile > 40,
    flip: (p) => ({ ...p, income_percentile: 30 }),
    question: '혹시 소득이 기준 중위소득 30% 안팎으로 낮으신가요?',
    assumeLabel: '저소득(중위 30% 수준)이라면',
  },
]

/**
 * 한 차원만 '대표 자격값'으로 가정한 가설 프로필을 만든다(원본 불변).
 * 흐름:
 *  1) GAP_DIMENSIONS에서 key에 해당하는 차원을 찾는다.
 *  2) 있으면 그 차원의 flip으로 해당 필드만 바꾼 얕은 복사본을 반환.
 *  3) 없으면(알 수 없는 key) 안전하게 원본의 얕은 복사본만 반환(불변 보장).
 */
export function flipProfile(p: UserProfile, key: GapKey): UserProfile {
  const dim = GAP_DIMENSIONS.find((d) => d.key === key)
  return dim ? dim.flip(p) : { ...p }
}

/** 정직성 라벨('추정 · 해당되시면')을 담은 안내 문구를 만든다. 현금 증가분 유무로 분기. */
function buildNote(newCount: number, monthlyDelta: number): string {
  if (monthlyDelta > 0) {
    return `추정 · 해당되시면 복지 ${newCount}개가 새로 열리고 월 최대 약 ${formatWon(monthlyDelta)}까지 늘 수 있어요. 실제 자격·금액은 신청할 때 확인돼요.`
  }
  return `추정 · 해당되시면 관련 복지 ${newCount}개를 더 안내받을 수 있어요. 실제 자격은 신청할 때 확인돼요.`
}

/**
 * 숨은 자격 스캔 — 비어있는 각 차원을 가정했을 때의 임팩트를 임팩트 큰 순으로 반환.
 * 흐름:
 *  1) baseline = 현재 프로필의 자격 복지 목록(id 집합화).
 *  2) 각 차원: 이미 채워졌으면 스킵. 아니면 flip 후 자격 복지를 다시 구해
 *     baseline에 없던 정책(id 기준)만 '새로 열린 것'으로 추린다.
 *  3) 새로 열린 게 없으면 헛질문이므로 제외. 있으면 현금 월액 내림차순으로 예시 정렬,
 *     monthlyDelta = 새 정책들의 현금 월 합계(추정) 계산.
 *  4) minMonthly(옵션) 미달이면 제외(현금 임팩트만 보고 싶을 때의 게이트).
 *  5) newCount 내림차순 → monthlyDelta 내림차순 → 정의 순서로 안정 정렬 후 limit 적용.
 */
export function scanProfileGaps(
  p: UserProfile,
  opts: { limit?: number; minMonthly?: number } = {},
): GapProbe[] {
  const minMonthly = opts.minMonthly ?? 0
  const baseIds = new Set(getEligiblePolicies(p).map((x) => x.id))

  const scored: { probe: GapProbe; order: number }[] = []
  GAP_DIMENSIONS.forEach((dim, idx) => {
    if (!dim.isEmpty(p)) return // 이미 채워진 차원은 되묻지 않음
    const flipped = getEligiblePolicies(dim.flip(p))
    const fresh = flipped.filter((x) => !baseIds.has(x.id)) // baseline에 없던 것만
    if (fresh.length === 0) return // 새로 열리는 게 없으면 헛질문 방지(제외)

    const monthlyDelta = sumCashMonthly(fresh)
    if (monthlyDelta < minMonthly) return // 현금 임계(옵션) 미달 제외

    // 큰 혜택이 먼저 보이게 현금 월액 내림차순, 동률은 id로 안정 정렬
    const examples = [...fresh]
      .sort((a, b) => parseMonthly(b.benefit) - parseMonthly(a.benefit) || a.id.localeCompare(b.id))
      .map((x) => ({ id: x.id, name: x.name }))

    scored.push({
      probe: {
        key: dim.key,
        question: dim.question,
        assumeLabel: dim.assumeLabel,
        newCount: fresh.length,
        monthlyDelta,
        examples,
        note: buildNote(fresh.length, monthlyDelta),
      },
      order: idx,
    })
  })

  scored.sort(
    (a, b) =>
      b.probe.newCount - a.probe.newCount ||
      b.probe.monthlyDelta - a.probe.monthlyDelta ||
      a.order - b.order,
  )
  const out = scored.map((s) => s.probe)
  return opts.limit != null ? out.slice(0, opts.limit) : out
}
