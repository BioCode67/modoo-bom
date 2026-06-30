import { describe, it, expect } from 'vitest'
import { deadlineHint } from './deadline'
import type { Policy } from '@/data/policies'

const mk = (over: Partial<Policy>): Policy =>
  ({ id: 'T', name: '', category: '', target: '', benefit: '', eligibility: '', application: '',
     required_docs: [], department: '', renewal: '', ...over } as Policy)

describe('deadlineHint', () => {
  it('출생 후 60일 이내 → 긴급', () => {
    const h = deadlineHint(mk({ benefit: '첫만남이용권, 출생 후 60일 이내 신청' }))
    expect(h?.urgent).toBe(true)
    expect(h?.label).toMatch(/출생 후 60일/)
  })
  it('퇴직 후 1년 → 긴급', () => {
    const h = deadlineHint(mk({ eligibility: '퇴직 후 1년 이내 신청 가능' }))
    expect(h?.urgent).toBe(true)
  })
  it('한시 사업 → 긴급', () => {
    expect(deadlineHint(mk({ name: '한시 긴급생활지원' }))?.urgent).toBe(true)
  })
  it('신청기간 → 비긴급(기간 한정 안내)', () => {
    const h = deadlineHint(mk({ application: '매년 신청 기간 내 접수' }))
    expect(h).toBeTruthy()
    expect(h?.urgent).toBe(false)
  })
  it('기한 신호 없으면 null (상시 신청)', () => {
    expect(deadlineHint(mk({ name: '기초연금', eligibility: '만 65세 이상', application: '상시 신청' }))).toBeNull()
  })
  it('만기·사용기한은 신청기한으로 오인하지 않음', () => {
    // '5년 만기'는 신청 기한이 아님 → null
    expect(deadlineHint(mk({ name: '청년도약계좌', benefit: '5년 만기 시 5000만원' }))).toBeNull()
  })
})
