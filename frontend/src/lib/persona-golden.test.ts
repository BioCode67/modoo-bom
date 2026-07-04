import { describe, it, expect } from 'vitest'
import { runAnalysis, type UserProfile, type EligiblePolicy } from '@/lib/welfare-engine'

/**
 * 페르소나 골든 테스트 — 대회 취지(복지 사각지대 해소)의 5대 대표 페르소나에 대해
 * "결과의 품질" 자체를 회귀로부터 지킨다. 개별 룰 테스트가 못 잡는 전체 조립 수준의 파손
 * (필수 정책 누락·인구통계 누수·민간재단 미노출)을 감지.
 *
 * ⚠️ 유지보수 원칙: 데이터(시드·민간)가 계속 자라므로 '정확 개수'가 아니라
 *   포함(⊇)·하한(≥)·부재(∌) 속성만 고정한다.
 */
const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

function ids(list: EligiblePolicy[]): Set<string> {
  return new Set(list.map((p) => p.id))
}
function names(list: EligiblePolicy[]): string {
  return list.map((p) => p.name).join(' ')
}

describe('페르소나 골든 — 결과 품질 고정', () => {
  it('👵 독거 어르신(72세·중위25%): 기초연금 high + 노인 핵심 + 청년·보육 누수 0', () => {
    const r = runAnalysis({ ...base, age: 72, household_type: '1인가구', income_percentile: 25 })
    const pol = r.eligible_policies.filter((p) => p.id.startsWith('POL-'))
    const high = pol.filter((p) => p.priority === 'high')
    expect(ids(pol).has('POL-001')).toBe(true) // 기초연금
    expect(pol.find((p) => p.id === 'POL-001')?.priority).toBe('high')
    expect(high.length).toBeGreaterThanOrEqual(5) // 노인 핵심 묶음
    expect(r.eligible_policies.some((p) => p.id.startsWith('PRV-'))).toBe(true) // 민간(의료·위기) 연계
    // 인구통계 누수 방지 — 어르신에게 청년·영유아 정책이 나오면 신뢰 붕괴
    expect(names(pol)).not.toMatch(/청년|어린이집|영유아|보육료/)
  })

  it('🧑 위기 청년(26세·실직·중위45%): 내일저축·구직 지원 + 노인 정책 누수 0', () => {
    const r = runAnalysis({ ...base, age: 26, income_percentile: 45, employment_status: 'unemployed', life_events: ['실직'] })
    const pol = r.eligible_policies.filter((p) => p.id.startsWith('POL-'))
    expect(ids(pol).has('POL-006')).toBe(true) // 청년 내일저축계좌
    expect(names(pol)).toMatch(/실업|구직|취업/) // 고용 위기 대응 포함
    expect(pol.filter((p) => p.priority === 'high').length).toBeGreaterThanOrEqual(5)
    expect(r.eligible_policies.some((p) => p.id.startsWith('PRV-'))).toBe(true) // 장학·위기 민간
    expect(names(pol)).not.toMatch(/기초연금|노인일자리|틀니/)
  })

  it('👶 출산 가정(0세 자녀): 아동수당+부모급여 high + 60일 소급 알림', () => {
    const r = runAnalysis({ ...base, age: 32, has_children: true, children_ages: [0], life_events: ['출산'] })
    const pol = r.eligible_policies.filter((p) => p.id.startsWith('POL-'))
    expect(ids(pol).has('POL-004')).toBe(true) // 아동수당
    expect(ids(pol).has('POL-005')).toBe(true) // 부모급여
    expect(pol.find((p) => p.id === 'POL-005')?.priority).toBe('high')
    // 출산 후 60일 소급 — 놓치면 돈을 잃는 핵심 알림
    expect(r.notifications.some((n) => /60일/.test(n.message))).toBe(true)
  })

  it('♿ 중증장애인(45세·중위35%): 장애인연금·활동지원 high + 밀알(민간) 연계', () => {
    const r = runAnalysis({ ...base, age: 45, disability: true, disability_grade: '1급', income_percentile: 35 })
    const pol = r.eligible_policies.filter((p) => p.id.startsWith('POL-'))
    expect(ids(pol).has('POL-003')).toBe(true) // 장애인연금
    expect(names(pol)).toMatch(/활동지원/)
    expect(r.eligible_policies.some((p) => p.id === 'PRV-009')).toBe(true) // 밀알 의료·재활
    expect(names(pol)).not.toMatch(/기초연금/) // 45세에 노인 정책 누수 0
  })

  it('🌏 다문화 가정(34세·5세 자녀): 아동수당 + 다문화 지원 + 민간 노출', () => {
    const r = runAnalysis({ ...base, age: 34, household_type: '다문화가족', has_children: true, children_ages: [5], income_percentile: 55 })
    const pol = r.eligible_policies.filter((p) => p.id.startsWith('POL-'))
    expect(ids(pol).has('POL-004')).toBe(true)
    expect(names(r.eligible_policies as EligiblePolicy[])).toMatch(/다문화/)
    expect(r.eligible_policies.some((p) => p.id.startsWith('PRV-'))).toBe(true)
  })

  it('👵♿ 복합(70세·장애2급·중위30%): 노인+장애 두 영역이 모두 high로 함께 뜬다(누락 없이)', () => {
    // 현실의 다수는 한 축이 아니다(노인이면서 장애·저소득). 두 영역 필수급여가 동시에 잡혀야 한다.
    const r = runAnalysis({ ...base, age: 70, income_percentile: 30, disability: true, disability_grade: '2급', region: '부산' })
    const pol = r.eligible_policies as EligiblePolicy[]
    expect(ids(pol).has('POL-001')).toBe(true) // 기초연금(노인)
    expect(ids(pol).has('POL-003')).toBe(true) // 장애인연금(장애)
    expect(pol.find((p) => p.id === 'POL-001')?.priority).toBe('high')
    expect(pol.find((p) => p.id === 'POL-003')?.priority).toBe('high')
    // 두 영역 혜택이 실제로 함께(노인 돌봄/틀니 + 장애 활동지원 등) 노출.
    expect(names(pol)).toMatch(/활동지원/)
    expect(names(pol)).toMatch(/노인|어르신|틀니/)
  })

  it('💰 고소득 가구(40세·중위150%): 소득상한 있는 자산심사형(생계·기초연금·차상위)은 강력추천에서 배제', () => {
    // 대회 취지의 '잡다한 것·신청 불가한 것 제외' — 명백히 소득초과인데 연령만 맞아 추천되면 신뢰가 깨진다.
    const r = runAnalysis({ ...base, age: 40, income_percentile: 150, has_children: true, children_ages: [3] })
    const pol = r.eligible_policies as EligiblePolicy[]
    const high = pol.filter((p) => p.priority === 'high')
    // 자산심사형(소득상한 명시) 정책은 high로 오노출되지 않아야 한다.
    expect(names(high)).not.toMatch(/생계급여|의료급여|주거급여|차상위|기초생활|긴급복지/)
    // 소득 무관 보편급여(아동수당 등)는 정상 노출 — 과배제도 아님.
    expect(ids(pol).has('POL-004')).toBe(true) // 아동수당(소득무관)
  })

  it('공통 정직성: 민간재단(PRV)은 어느 페르소나에서도 high/precise로 과장되지 않음', () => {
    const personas: UserProfile[] = [
      { ...base, age: 72, income_percentile: 25 },
      { ...base, age: 26, income_percentile: 45 },
      { ...base, age: 45, disability: true, disability_grade: '1급' },
    ]
    for (const p of personas) {
      const prv = runAnalysis(p).eligible_policies.filter((x) => x.id.startsWith('PRV-'))
      for (const x of prv) {
        expect(x.priority).toBe('low')
        expect(x.confidence).toBeLessThanOrEqual(0.68)
      }
    }
  })
})
