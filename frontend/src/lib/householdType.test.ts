import { describe, it, expect } from 'vitest'
import { classifyHousehold, classificationHint, type HHMember } from './householdType'

const M = (relation: string, age: number): HHMember => ({ relation, age })

describe('classifyHousehold — 유형 판별', () => {
  it('구성원 1명 → 1인가구', () => {
    const c = classifyHousehold([M('본인', 30)])
    expect(c.type).toBe('1인가구')
  })

  it('노인 1인가구는 1인가구로 두되 노인 사유·플래그를 남긴다', () => {
    const c = classifyHousehold([M('본인', 72)])
    expect(c.type).toBe('1인가구')
    expect(c.reasons.some((r) => /노인|65/.test(r))).toBe(true)
    expect(c.flags).toContain('노인')
  })

  it('배우자 없이 미성년 자녀 → 한부모가족', () => {
    const c = classifyHousehold([M('본인', 40), M('자녀', 8)])
    expect(c.type).toBe('한부모가족')
    expect(c.flags).toContain('한부모')
  })

  it('배우자 있으면 한부모 아님(자녀 있어도 일반/다자녀)', () => {
    expect(classifyHousehold([M('본인', 40), M('배우자', 39), M('자녀', 8)]).type).toBe('일반가구')
  })

  it('배우자 + 미성년 자녀 2명 → 다자녀가구', () => {
    const c = classifyHousehold([M('본인', 40), M('배우자', 39), M('자녀', 8), M('자녀', 5)])
    expect(c.type).toBe('다자녀가구')
    expect(c.flags).toContain('다자녀')
  })

  it('한부모 + 자녀 2명은 한부모가족 우선(다자녀는 플래그로)', () => {
    const c = classifyHousehold([M('본인', 40), M('자녀', 8), M('자녀', 5)])
    expect(c.type).toBe('한부모가족')
    expect(c.flags).toContain('다자녀')
  })

  it('구성원 모두 65세 이상(2명↑) → 노인가구', () => {
    expect(classifyHousehold([M('본인', 70), M('배우자', 68)]).type).toBe('노인가구')
  })

  it('노인이지만 미성년 자녀가 있으면 노인가구 아님(조부모+손자 상황은 일반/한부모로)', () => {
    // 배우자 없이 손자녀(자녀로 입력)를 키우는 조부모 → 한부모 규칙에 걸림(미성년 양육)
    const c = classifyHousehold([M('본인', 68), M('자녀', 10)])
    expect(c.type).toBe('한부모가족')
  })

  it('다문화는 명시 입력일 때만', () => {
    expect(classifyHousehold([M('본인', 35), M('배우자', 33)], { multicultural: true }).type).toBe('다문화가족')
    expect(classifyHousehold([M('본인', 35), M('배우자', 33)]).type).toBe('일반가구')
  })

  it('일반 가구(부부, 자녀 없음)', () => {
    expect(classifyHousehold([M('본인', 45), M('배우자', 43)]).type).toBe('일반가구')
  })
})

describe('flags — 부가 특성', () => {
  it('영유아·청년·노인 플래그', () => {
    const c = classifyHousehold([M('본인', 30), M('배우자', 68), M('자녀', 2)])
    expect(c.flags).toContain('영유아')
    expect(c.flags).toContain('청년') // 30세
    expect(c.flags).toContain('노인') // 68세
  })
  it('성인 자녀는 다자녀 카운트에서 제외(미성년만)', () => {
    const c = classifyHousehold([M('본인', 50), M('배우자', 48), M('자녀', 22), M('자녀', 20)])
    expect(c.flags).not.toContain('다자녀') // 둘 다 19세 이상
    expect(c.type).toBe('일반가구')
  })
})

describe('classificationHint', () => {
  it('유형·사유·특성을 한 줄로', () => {
    const c = classifyHousehold([M('본인', 40), M('자녀', 8), M('자녀', 5)])
    const h = classificationHint(c)
    expect(h).toMatch(/한부모가족/)
    expect(h).toMatch(/특성/)
  })
  it('빈 입력도 안전(1인가구 취급)', () => {
    expect(classifyHousehold([]).type).toBe('1인가구')
  })
})
