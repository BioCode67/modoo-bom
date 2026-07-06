import { describe, it, expect } from 'vitest'
import { buildPrefill, prefillText } from './prefill'
import type { UserProfile } from './welfare-engine'

const base: UserProfile = {
  name: '', age: 0, gender: 'other', region: '', household_type: '',
  income_percentile: 0, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

describe('buildPrefill', () => {
  it('값 있는 비민감 항목만 생성 + 포맷', () => {
    const p: UserProfile = { ...base, name: '김복순', age: 72, region: '서울특별시', household_type: '1인가구', income_percentile: 25 }
    const f = buildPrefill(p, { birth_date: '19531101', phone: '01012345678', carrier: 'SKT' })
    const map = Object.fromEntries(f.map((x) => [x.label, x.value]))
    expect(map['이름']).toBe('김복순')
    expect(map['생년월일']).toBe('1953-11-01')
    expect(map['휴대폰']).toBe('010-1234-5678')
    expect(map['통신사']).toBe('SKT')
    expect(map['나이']).toBe('만 72세')
    expect(map['소득 수준']).toContain('25%')
  })

  it('빈 프로필은 빈 목록(값 없는 항목 제외)', () => {
    expect(buildPrefill(null)).toEqual([])
    expect(buildPrefill(base)).toEqual([])
  })

  it('장애·자녀·임신 상황 반영', () => {
    const p: UserProfile = { ...base, disability: true, disability_grade: '1급', has_children: true, children_ages: [3, 6], is_pregnant: true }
    const map = Object.fromEntries(buildPrefill(p).map((x) => [x.label, x.value]))
    // 현행 체계(심한/심하지 않은 장애)로 표시 — 폐지된 1/2/3급 대신
    expect(map['장애']).toContain('심한 장애')
    expect(map['자녀']).toContain('2명')
    expect(map['임신']).toBe('임신 중')
  })

  it('🔒 민감정보(주민번호/주민등록번호)는 절대 포함하지 않음', () => {
    const p: UserProfile = { ...base, name: '홍길동', age: 40 }
    const txt = prefillText(buildPrefill(p, { birth_date: '19840101', phone: '01099998888' }))
    expect(txt).not.toMatch(/주민(등록)?번호/)
    // 6자리-7자리 형태의 주민번호 패턴이 없어야 함
    expect(txt).not.toMatch(/\d{6}\s*[-]\s*\d{7}/)
  })

  it('prefillText는 라벨: 값 줄바꿈 형식', () => {
    const txt = prefillText([{ label: '이름', value: '김복순' }, { label: '나이', value: '만 72세' }])
    expect(txt).toBe('이름: 김복순\n나이: 만 72세')
  })

  it('정부 폼 대체 형식(alt) — 생년월일 YYYYMMDD·휴대폰 하이픈 제거', () => {
    const f = buildPrefill(null, { name: '김복순', birth_date: '1953-11-01', phone: '010-1234-5678' })
    const byLabel = Object.fromEntries(f.map((x) => [x.label, x]))
    expect(byLabel['생년월일'].alt).toBe('19531101')
    expect(byLabel['휴대폰'].alt).toBe('01012345678')
    expect(byLabel['이름'].alt).toBeUndefined() // 변형이 없는 값엔 alt 없음
  })
})
