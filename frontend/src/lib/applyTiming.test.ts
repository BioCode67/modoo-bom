import { describe, it, expect } from 'vitest'
import { applyTiming } from './applyTiming'
import type { EligiblePolicy, UserProfile } from './welfare-engine'

const baseProfile: UserProfile = {
  name: '테스트', age: 40, gender: 'female', region: '서울', household_type: '3인가구',
  income_percentile: 50, disability: false, disability_grade: '', employment_status: 'employed',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

const mkE = (id: string, name: string, extra: Partial<EligiblePolicy> = {}): EligiblePolicy => ({
  id, name, category: '', target: '', benefit: '', eligibility: '', required_docs: [], application: '',
  department: '', renewal: '', reason: '', priority: 'medium', confidence: 0.8, ...extra,
})

describe('applyTiming — 소급(신생아)', () => {
  it('신생아(0~1세) + 출생 관련 복지 적격 → 소급 알림(high)', () => {
    const p = { ...baseProfile, has_children: true, children_ages: [0] }
    const alerts = applyTiming(p, [mkE('POL-A', '아동수당'), mkE('POL-B', '부모급여')])
    const retro = alerts.find((a) => a.kind === 'retroactive')
    expect(retro).toBeTruthy()
    expect(retro!.urgency).toBe('high')
    expect(retro!.policyNames).toEqual(['아동수당', '부모급여'])
    // 하드 일수를 단정하지 않고 '확인' 프레이밍(정직성)
    expect(retro!.detail).toMatch(/확인/)
    expect(retro!.detail).not.toMatch(/\d+\s*일\s*이내/)
  })

  it('출산 생애이벤트로도 소급 신호를 잡는다', () => {
    const p = { ...baseProfile, life_events: ['출산'] }
    const alerts = applyTiming(p, [mkE('POL-A', '첫만남이용권')])
    expect(alerts.some((a) => a.kind === 'retroactive')).toBe(true)
  })

  it('신생아가 아니면(자녀 없음·큰 자녀) 소급 알림 없음', () => {
    expect(applyTiming(baseProfile, [mkE('POL-A', '아동수당')]).some((a) => a.kind === 'retroactive')).toBe(false)
    const older = { ...baseProfile, has_children: true, children_ages: [8] }
    expect(applyTiming(older, [mkE('POL-A', '아동수당')]).some((a) => a.kind === 'retroactive')).toBe(false)
  })

  it('신생아라도 출생 관련 적격 복지가 없으면 소급 알림 없음(과장 방지)', () => {
    const p = { ...baseProfile, has_children: true, children_ages: [1] }
    expect(applyTiming(p, [mkE('POL-A', '노인일자리')]).some((a) => a.kind === 'retroactive')).toBe(false)
  })
})

describe('applyTiming — 사전신청(65세 임박)', () => {
  it('63~64세면 기초연금 사전신청 안내(medium)', () => {
    for (const age of [63, 64]) {
      const alerts = applyTiming({ ...baseProfile, age }, [])
      const pre = alerts.find((a) => a.kind === 'preapply')
      expect(pre).toBeTruthy()
      expect(pre!.detail).toMatch(/확인/)
    }
  })

  it('65세 이상·62세 이하는 사전신청 안내 없음', () => {
    expect(applyTiming({ ...baseProfile, age: 66 }, []).some((a) => a.kind === 'preapply')).toBe(false)
    expect(applyTiming({ ...baseProfile, age: 62 }, []).some((a) => a.kind === 'preapply')).toBe(false)
  })
})

describe('applyTiming — 신청 기한', () => {
  it('적격 복지에 기한 신호가 있으면 마감 알림', () => {
    const withDeadline = mkE('POL-D', '한시 지원사업', { eligibility: '출생 후 60일 이내 신청' })
    const alerts = applyTiming(baseProfile, [withDeadline])
    const dl = alerts.find((a) => a.kind === 'deadline')
    expect(dl).toBeTruthy()
    expect(dl!.policyNames).toContain('한시 지원사업')
    expect(dl!.urgency).toBe('high') // 60일 내 = urgent
  })

  it('기한 신호가 없으면 마감 알림 없음', () => {
    expect(applyTiming(baseProfile, [mkE('POL-X', '평범한 복지')]).some((a) => a.kind === 'deadline')).toBe(false)
  })
})

describe('applyTiming — 정직성·정렬·경계', () => {
  it('아무 신호 없으면 빈 배열(잔소리 안 함)', () => {
    expect(applyTiming(baseProfile, [])).toEqual([])
    expect(applyTiming(null, [])).toEqual([])
  })

  it('high 알림이 medium보다 앞선다', () => {
    const p = { ...baseProfile, age: 63, has_children: true, children_ages: [0] }
    const alerts = applyTiming(p, [mkE('POL-A', '아동수당')])
    // 소급(high) + 사전신청(medium) 둘 다 → high 먼저
    expect(alerts[0].urgency).toBe('high')
    expect(alerts.length).toBeGreaterThanOrEqual(2)
  })

  it('프로필 없어도(null) 안전하게 동작', () => {
    expect(() => applyTiming(null, [mkE('POL-A', '아동수당')])).not.toThrow()
  })
})
