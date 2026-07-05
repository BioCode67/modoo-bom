import { describe, it, expect } from 'vitest'
import { encodeHelperLink, decodeHelperPayload } from './helperLink'
import type { UserProfile } from '@/lib/welfare-engine'

const prof: UserProfile = {
  name: '김복순', age: 72, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('helperLink — 가족 도움 링크 인코딩/복원', () => {
  it('라운드트립 복원 — 프로필·정책이 살아난다', () => {
    const link = encodeHelperLink(prof, [{ policyId: 'POL-001', name: '기초연금' }])
    expect(link).toContain('#helper=')
    const d = decodeHelperPayload(link)
    expect(d).not.toBeNull()
    expect(d!.profile.age).toBe(72)
    expect(d!.profile.income_percentile).toBe(25)
    expect(d!.tracked[0].policyId).toBe('POL-001')
  })
  it('보안: 이름은 절대 링크에 넣지 않는다', () => {
    const link = encodeHelperLink(prof, [])
    const d = decodeHelperPayload(link)
    expect(d!.profile.name).toBe('')
    // 인코딩된 페이로드에 원본 이름이 들어있지 않음(base64 디코드해도)
    const enc = link.split('#helper=')[1]
    const json = Buffer.from(enc.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    expect(json).not.toContain('김복순')
  })
  it('변조·쓰레기 입력 → null(안전)', () => {
    expect(decodeHelperPayload('#helper=!!!garbage!!!')).toBeNull()
    expect(decodeHelperPayload('nothing here')).toBeNull()
    expect(decodeHelperPayload('')).toBeNull()
  })
  it('과대 페이로드 → null(악용 방지)', () => {
    expect(decodeHelperPayload('#helper=' + 'A'.repeat(9000))).toBeNull()
  })
  it('필수 필드 없으면 null', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, profile: {}, tracked: [] })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeHelperPayload('#helper=' + bad)).toBeNull()
  })
  it('값 클램프 — 비정상 나이/소득 범위 제한', () => {
    const evil = { ...prof, age: 9999, income_percentile: -5 }
    const d = decodeHelperPayload(encodeHelperLink(evil, []))
    expect(d!.profile.age).toBeLessThanOrEqual(120)
    expect(d!.profile.income_percentile).toBeGreaterThanOrEqual(0)
  })
})
