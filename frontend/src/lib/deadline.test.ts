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
  it('감사 회귀: 앵커 없는 긴 기한(퇴원 180일)은 기한 표시하되 급박(빨강) 아님', () => {
    const h = deadlineHint(mk({ name: '재난적 의료비 지원', application: '국민건강보험공단 지사 방문(퇴원 180일 이내)' }))
    expect(h).toBeTruthy()
    expect(h?.label).toMatch(/180일/)
    expect(h?.urgent).toBe(false) // 6개월은 '기한이 짧아요'가 아님
  })
  it('감사 회귀: 짧은 기한(14일 이내)은 급박', () => {
    expect(deadlineHint(mk({ application: '사유 발생 14일 이내 신고' }))?.urgent).toBe(true)
  })
  it('감사 회귀: 바우처 사용기한(N일 이내 사용)은 신청기한으로 오표기 안 함', () => {
    // '포인트 30일 이내 사용'은 신청이 아님 → 신청 라벨로 오인 금지(매칭 안 돼 null이 정상)
    const h = deadlineHint(mk({ benefit: '문화포인트 30일 이내 사용' }))
    expect(h?.label ?? '').not.toMatch(/신청/)
  })
})
