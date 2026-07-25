import { describe, it, expect } from 'vitest'
import { sharedGovLoginCount, isSeparateAuthDoc, oneLoginNote } from './oneLogin'

describe('oneLogin — 발급 전 "한 번 인증" 오보 방지', () => {
  it('정부24 서류만 공유 로그인으로 카운트(출입국·병적·소득 등 gov24 포함)', () => {
    expect(sharedGovLoginCount(['주민등록등본', '주민등록초본'])).toBe(2)
    expect(sharedGovLoginCount(['주민등록등본', '소득금액증명', '병적증명서'])).toBe(3)
    expect(sharedGovLoginCount(['주민등록등본'])).toBe(1) // 1종은 공유할 상대가 없음
    expect(sharedGovLoginCount([])).toBe(0)
  })

  it('건보·고용24·가족관계·국민연금은 별도 인증이라 제외', () => {
    expect(isSeparateAuthDoc('건강보험 자격득실확인서')).toBe(true) // nhis
    expect(isSeparateAuthDoc('고용보험 피보험자격 이력내역서')).toBe(true) // work24
    expect(isSeparateAuthDoc('가족관계증명서')).toBe(true) // 대법원 efamily
    expect(isSeparateAuthDoc('국민연금 가입자 증명서')).toBe(true) // nps
    // ⚠️ '건강보험료 납부확인서'는 정부24 발급이라 별도 인증이 아니다(오분류 회귀 방지)
    expect(isSeparateAuthDoc('건강보험료 납부확인서')).toBe(false)
  })

  it('별도 인증 서류만 고르면 공유 수 0 — "한 번 인증" 주장 불가', () => {
    expect(sharedGovLoginCount(['건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서'])).toBe(0)
  })

  it('정부24 1종 + 별도 인증 1종이면 공유 수 1 — 실제로는 2번 인증(오보 방지)', () => {
    expect(sharedGovLoginCount(['주민등록등본', '건강보험 자격득실확인서'])).toBe(1)
  })

  it('oneLoginNote: 2종 이상만 "한 번 인증", 그 외는 "차례로"', () => {
    expect(oneLoginNote(2)).toContain('한 번 인증')
    expect(oneLoginNote(3)).toContain('한 번 인증')
    expect(oneLoginNote(1)).toContain('차례로')
    expect(oneLoginNote(0)).toContain('차례로')
  })
})
