import { describe, it, expect } from 'vitest'
import { getEligiblePolicies, type UserProfile } from '@/lib/welfare-engine'
import { parseMonthly, sumCashMonthly } from '@/lib/format'
import {
  GAP_DIMENSIONS,
  flipProfile,
  scanProfileGaps,
  type GapKey,
  type GapProbe,
} from '@/lib/profileGaps'

// 모든 축이 '아니오/공백'인 기준 프로필 — 7개 차원 모두 되물음 후보.
// (30세·중위 60%·무직 미상 → 저소득/장애/임신/자녀/실직/한부모/다문화 전부 비어있음)
const BASE: UserProfile = {
  name: '',
  age: 30,
  gender: 'other',
  region: '',
  household_type: '',
  income_percentile: 60,
  disability: false,
  disability_grade: '',
  employment_status: '',
  has_children: false,
  children_ages: [],
  is_pregnant: false,
  life_events: [],
}

const ALL_KEYS: GapKey[] = [
  'disability',
  'pregnant',
  'children',
  'unemployed',
  'singleParent',
  'multicultural',
  'lowIncome',
]

// diff를 테스트 안에서 독립적으로 재계산해 라이브러리 내부 배선을 검증한다.
function freshFor(p: UserProfile, key: GapKey) {
  const baseIds = new Set(getEligiblePolicies(p).map((x) => x.id))
  return getEligiblePolicies(flipProfile(p, key)).filter((x) => !baseIds.has(x.id))
}

describe('GAP_DIMENSIONS — 차원 정의', () => {
  it('정확히 7개 차원, 키는 유일하고 GapKey 집합과 일치', () => {
    expect(GAP_DIMENSIONS).toHaveLength(7)
    const keys = GAP_DIMENSIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(7)
    expect(new Set(keys)).toEqual(new Set(ALL_KEYS))
  })

  it('각 차원은 isEmpty·flip·질문·가정라벨을 갖춘다', () => {
    for (const d of GAP_DIMENSIONS) {
      expect(typeof d.isEmpty).toBe('function')
      expect(typeof d.flip).toBe('function')
      expect(d.question).toContain('혹시') // 사실 단정이 아닌 되물음
      expect(d.assumeLabel.length).toBeGreaterThan(0)
    }
  })
})

describe('flipProfile — 대표 자격값 가정(원본 불변)', () => {
  it('원본을 절대 변형하지 않는다(얕은 복사 + 새 배열)', () => {
    const snapshot = JSON.parse(JSON.stringify(BASE))
    for (const key of ALL_KEYS) flipProfile(BASE, key)
    expect(BASE).toEqual(snapshot) // 모든 flip 후에도 원본 그대로
    // 배열 필드도 공유·변형되지 않아야
    const flipped = flipProfile(BASE, 'unemployed')
    expect(flipped.life_events).not.toBe(BASE.life_events)
    expect(BASE.life_events).toEqual([])
  })

  it('새 객체를 반환한다(참조 동일성 아님)', () => {
    const r = flipProfile(BASE, 'lowIncome')
    expect(r).not.toBe(BASE)
  })

  it('disability → disability=true, 정도값 중증', () => {
    const r = flipProfile(BASE, 'disability')
    expect(r.disability).toBe(true)
    expect(r.disability_grade).toBe('중증')
  })

  it('pregnant → is_pregnant=true', () => {
    expect(flipProfile(BASE, 'pregnant').is_pregnant).toBe(true)
  })

  it('children → has_children=true, children_ages=[3]', () => {
    const r = flipProfile(BASE, 'children')
    expect(r.has_children).toBe(true)
    expect(r.children_ages).toEqual([3])
  })

  it('unemployed → employment_status=unemployed + 실직 신호 누적', () => {
    const r = flipProfile(BASE, 'unemployed')
    expect(r.employment_status).toBe('unemployed')
    expect(r.life_events).toContain('실직')
  })

  it('singleParent → 한부모 신호(엔진 정규식 매칭)', () => {
    const r = flipProfile(BASE, 'singleParent')
    expect(/한부모|조손/.test(r.household_type)).toBe(true)
  })

  it('multicultural → household_type=다문화가족(엔진 정확일치 요구)', () => {
    expect(flipProfile(BASE, 'multicultural').household_type).toBe('다문화가족')
  })

  it('lowIncome → income_percentile=30', () => {
    expect(flipProfile(BASE, 'lowIncome').income_percentile).toBe(30)
  })

  it('한 축만 바꾸고 나머지 필드는 그대로 유지', () => {
    const r = flipProfile(BASE, 'lowIncome')
    // 소득만 달라지고 나머지는 base와 동일
    expect({ ...r, income_percentile: BASE.income_percentile }).toEqual(BASE)
  })

  it('알 수 없는 key는 원본 얕은 복사만 반환(불변·방어)', () => {
    const r = flipProfile(BASE, 'bogus' as GapKey)
    expect(r).toEqual(BASE)
    expect(r).not.toBe(BASE)
  })
})

describe('scanProfileGaps — 임팩트 진단', () => {
  const probes = scanProfileGaps(BASE)

  it('비어있는 축들을 되물음으로 만든다(newCount>0만)', () => {
    expect(probes.length).toBeGreaterThanOrEqual(5)
    for (const pr of probes) {
      expect(ALL_KEYS).toContain(pr.key)
      expect(pr.newCount).toBeGreaterThan(0)
    }
    // 키 중복 없음
    expect(new Set(probes.map((pr) => pr.key)).size).toBe(probes.length)
  })

  it('현금성 축(장애·자녀·실직·저소득)은 월 증가분 추정 > 0', () => {
    for (const key of ['disability', 'children', 'unemployed', 'lowIncome'] as GapKey[]) {
      const pr = probes.find((x) => x.key === key)
      expect(pr, `${key} 축이 있어야 함`).toBeDefined()
      expect(pr!.monthlyDelta).toBeGreaterThan(0)
    }
  })

  it('임신 축은 열리지만 현금 아닌 바우처·서비스라 monthlyDelta=0 가능(정직)', () => {
    const preg = probes.find((x) => x.key === 'pregnant')
    expect(preg).toBeDefined()
    expect(preg!.newCount).toBeGreaterThan(0)
    // 현금 아닌 축이 하나 이상 존재(임신 등) — delta 0이어도 되물음은 유지
    expect(probes.some((pr) => pr.monthlyDelta === 0)).toBe(true)
  })

  it('newCount·examples·monthlyDelta가 실제 diff와 일치(내부 배선 검증)', () => {
    for (const pr of probes) {
      const fresh = freshFor(BASE, pr.key)
      const freshIds = new Set(fresh.map((x) => x.id))
      // examples는 정확히 새로 열린 정책 집합과 같다
      expect(pr.newCount).toBe(fresh.length)
      expect(pr.examples).toHaveLength(fresh.length)
      expect(new Set(pr.examples.map((e) => e.id))).toEqual(freshIds)
      // 예시는 baseline에 없던 것뿐(진짜 '새 것')
      const baseIds = new Set(getEligiblePolicies(BASE).map((x) => x.id))
      for (const e of pr.examples) expect(baseIds.has(e.id)).toBe(false)
      // monthlyDelta는 새 정책들의 현금 월 합계와 정확히 일치
      expect(pr.monthlyDelta).toBe(sumCashMonthly(fresh))
    }
  })

  it('examples는 현금 큰 순(parseMonthly 내림차순)으로 정렬', () => {
    const big = probes.find((x) => x.key === 'lowIncome')!
    const flipped = getEligiblePolicies(flipProfile(BASE, 'lowIncome'))
    // 실제 엔진의 parseMonthly로 각 예시의 월액을 복원 → 비증가(내림차순)인지 확인
    const monthly = big.examples.map((e) => parseMonthly(flipped.find((p) => p.id === e.id)!.benefit))
    for (let i = 1; i < monthly.length; i++) {
      expect(monthly[i - 1]).toBeGreaterThanOrEqual(monthly[i])
    }
    // 최대 현금(생계급여 등)이 실제로 존재해 맨 앞이 0보다 큼
    expect(monthly[0]).toBeGreaterThan(0)
  })

  it('정렬: newCount 내림차순 → monthlyDelta 내림차순', () => {
    for (let i = 1; i < probes.length; i++) {
      const prev = probes[i - 1]
      const cur = probes[i]
      const ok =
        prev.newCount > cur.newCount ||
        (prev.newCount === cur.newCount && prev.monthlyDelta >= cur.monthlyDelta)
      expect(ok, `정렬 위배: ${prev.key}(${prev.newCount},${prev.monthlyDelta}) → ${cur.key}(${cur.newCount},${cur.monthlyDelta})`).toBe(true)
    }
  })

  it('이미 채워진 축은 되묻지 않는다(스킵)', () => {
    // disability=true → disability 축 없음
    const p1 = scanProfileGaps({ ...BASE, disability: true, disability_grade: '중증' })
    expect(p1.some((x) => x.key === 'disability')).toBe(false)
    // is_pregnant=true → pregnant 축 없음
    expect(scanProfileGaps({ ...BASE, is_pregnant: true }).some((x) => x.key === 'pregnant')).toBe(false)
    // 중위 40% 이하 → lowIncome 축 없음
    expect(scanProfileGaps({ ...BASE, income_percentile: 35 }).some((x) => x.key === 'lowIncome')).toBe(false)
    // 이미 무직 → unemployed 축 없음
    expect(scanProfileGaps({ ...BASE, employment_status: 'unemployed' }).some((x) => x.key === 'unemployed')).toBe(false)
    // 한부모 → singleParent 축 없음
    expect(scanProfileGaps({ ...BASE, household_type: '한부모가족' }).some((x) => x.key === 'singleParent')).toBe(false)
  })

  it('모든 축이 채워진 프로필은 되물음 0개', () => {
    const filled: UserProfile = {
      ...BASE,
      age: 40,
      income_percentile: 30, // lowIncome 채움
      disability: true,
      disability_grade: '중증', // disability 채움
      is_pregnant: true, // pregnant 채움
      has_children: true,
      children_ages: [10], // children 채움
      employment_status: 'unemployed', // unemployed 채움
      household_type: '한부모가족', // singleParent 채움
      life_events: ['다문화'], // multicultural 채움(가구유형은 한부모라 별도 신호로)
    }
    expect(scanProfileGaps(filled)).toEqual([])
  })

  it('limit 옵션이 상위 N개로 제한', () => {
    const two = scanProfileGaps(BASE, { limit: 2 })
    expect(two).toHaveLength(2)
    // 제한해도 상위 2개는 무제한의 앞 2개와 동일
    expect(two.map((x) => x.key)).toEqual(probes.slice(0, 2).map((x) => x.key))
  })

  it('minMonthly 옵션이 현금 임계 미달 축을 거른다', () => {
    const cashOnly = scanProfileGaps(BASE, { minMonthly: 1 })
    expect(cashOnly.length).toBeLessThanOrEqual(probes.length)
    for (const pr of cashOnly) expect(pr.monthlyDelta).toBeGreaterThanOrEqual(1)
    // delta=0 축(임신 등)은 minMonthly=1에서 사라진다
    expect(cashOnly.some((x) => x.key === 'pregnant')).toBe(false)
    // 큰 현금 축(저소득)은 남는다
    expect(cashOnly.some((x) => x.key === 'lowIncome')).toBe(true)
  })

  it('입력 프로필을 변형하지 않는다(순수)', () => {
    const snapshot = JSON.parse(JSON.stringify(BASE))
    scanProfileGaps(BASE)
    expect(BASE).toEqual(snapshot)
  })

  it('결정적: 두 번 호출해도 같은 결과', () => {
    expect(scanProfileGaps(BASE)).toEqual(scanProfileGaps(BASE))
  })
})

describe('정직성 라벨 — 사실 단정 금지', () => {
  it('모든 note는 추정·해당되시면을 포함(단정 아님)', () => {
    const probes = scanProfileGaps(BASE)
    for (const pr of probes) {
      expect(pr.note).toContain('추정')
      expect(pr.note).toContain('해당되시면')
      expect(pr.note).toContain('확인') // 공식 확인 권장 뉘앙스
    }
  })

  it('모든 질문은 되물음 형태(혹시 …?)', () => {
    const probes: GapProbe[] = scanProfileGaps(BASE)
    for (const pr of probes) {
      expect(pr.question).toContain('혹시')
      expect(pr.question.trim().endsWith('?') || pr.question.includes('요?')).toBe(true)
    }
  })
})
