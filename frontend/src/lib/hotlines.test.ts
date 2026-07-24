import { describe, it, expect } from 'vitest'
import { HOTLINES, hotlinesFor } from './hotlines'

describe('HOTLINES — 데이터 무결성', () => {
  it('모든 항목이 이름·번호·설명·카테고리를 가진다', () => {
    for (const h of HOTLINES) {
      expect(h.name.length).toBeGreaterThan(0)
      expect(h.tel).toMatch(/^[\d-]{3,13}$/) // 숫자·하이픈만
      expect(h.desc.length).toBeGreaterThan(0)
      expect(h.category.length).toBeGreaterThan(0)
    }
  })
  it('129(보건복지상담)가 맨 앞(복지 전반 관문)', () => {
    expect(HOTLINES[0].tel).toBe('129')
  })
})

describe('hotlinesFor — 키워드 매칭', () => {
  it('키워드 없으면 대표 순서 상위', () => {
    const r = hotlinesFor('', 3)
    expect(r.length).toBe(3)
    expect(r[0].tel).toBe('129')
  })
  it('상황 키워드로 관련 상담처', () => {
    expect(hotlinesFor('빚').some((h) => h.tel === '1397')).toBe(true)       // 서민금융
    expect(hotlinesFor('폭력').some((h) => h.tel === '1366')).toBe(true)     // 여성긴급전화
    expect(hotlinesFor('노인 학대').some((h) => h.tel === '1577-1389')).toBe(true) // 노인보호
    expect(hotlinesFor('주거').some((h) => h.tel === '1600-1004')).toBe(true) // LH
  })
  it('매칭 없으면 대표 목록으로 폴백(막다르지 않게)', () => {
    const r = hotlinesFor('존재하지않는키워드zzz')
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].tel).toBe('129')
  })
  it('limit을 지킨다', () => {
    expect(hotlinesFor('', 2).length).toBe(2)
  })
})
