import { describe, it, expect } from 'vitest'
import { parseProfileFromText } from './parseQuery'

describe('parseProfileFromText', () => {
  it('72세 혼자 사는 저소득 어르신', () => {
    const p = parseProfileFromText('72세 혼자 사는데 소득이 적어요')
    expect(p.age).toBe(72)
    expect(p.household_type).toBe('1인가구')
    expect(p.income_percentile).toBeLessThanOrEqual(40)
  })

  it('서울 한부모 + 5살 아이', () => {
    const p = parseProfileFromText('서울 사는 한부모인데 5살 아이를 키워요')
    expect(p.region).toBe('서울')
    expect(p.household_type).toBe('한부모가족')
    expect(p.has_children).toBe(true)
    expect(p.children_ages).toContain(5)
  })

  it('기초생활수급자 → 매우 낮은 소득', () => {
    expect(parseProfileFromText('기초생활수급자입니다').income_percentile).toBeLessThanOrEqual(30)
  })

  it('중증 장애인', () => {
    const p = parseProfileFromText('중증 장애가 있어요')
    expect(p.disability).toBe(true)
    expect(p.disability_grade).toBe('1급')
  })

  it('실직한 청년 구직자', () => {
    const p = parseProfileFromText('회사에서 퇴사하고 일자리를 찾는 청년이에요')
    expect(p.employment_status).toBe('unemployed')
    expect(p.life_events).toContain('실직')
    expect(p.age).toBeLessThanOrEqual(30)
  })

  it('임신 중 → 출산 이벤트·여성', () => {
    const p = parseProfileFromText('임신 중이에요')
    expect(p.is_pregnant).toBe(true)
    expect(p.life_events).toContain('출산')
    expect(p.gender).toBe('female')
  })

  it('70대 → 약 75세, 경기 거주', () => {
    const p = parseProfileFromText('경기도 사는 70대입니다')
    expect(p.age).toBeGreaterThanOrEqual(70)
    expect(p.region).toBe('경기')
  })

  it('빈 입력 → 안전한 기본값', () => {
    const p = parseProfileFromText('')
    expect(p.age).toBe(30)
    expect(p.income_percentile).toBe(80)
    expect(p.life_events).toEqual([])
  })
})
