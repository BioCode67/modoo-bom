import { describe, it, expect } from 'vitest'
import { sameDocName } from './extension'

// 확장은 서류명을 정규화(resolveDoc)해 STATUS를 보내므로, 웹의 카드 키와 퍼지 매칭해야 한다.
// 이 매칭이 '포함(containment)' 기반이라 표기변형이 같은 정규명에 겹칠 수 있음 →
// DocumentCenter는 '첫 매칭'이 아니라 '매칭되는 카드 전부'를 갱신해야 함(그 근거를 여기서 고정).
describe('sameDocName — 서류명 퍼지 매칭', () => {
  it('공백 차이를 무시한다', () => {
    expect(sameDocName('주민등록 등본', '주민등록등본')).toBe(true)
    expect(sameDocName('가족관계증명서', '가족관계 증명서')).toBe(true)
  })

  it('포함 관계면 매칭된다(표기변형 카드가 정규명과 겹치는 근거)', () => {
    // 확장이 정규명 '주민등록등본'을 echo → 아래 카드 키들이 모두 매칭됨
    expect(sameDocName('청년 주민등록등본', '주민등록등본')).toBe(true)
    expect(sameDocName('자녀 주민등록등본', '주민등록등본')).toBe(true)
    expect(sameDocName('주민등록등본', '주민등록등본')).toBe(true)
  })

  it('서로 다른 서류는 매칭되지 않는다', () => {
    expect(sameDocName('주민등록등본', '가족관계증명서')).toBe(false)
    expect(sameDocName('건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서')).toBe(false)
  })

  it('빈 값은 매칭 실패로 처리(잘못된 라우팅 방지)', () => {
    expect(sameDocName('', '주민등록등본')).toBe(false)
    expect(sameDocName('주민등록등본', undefined)).toBe(false)
    expect(sameDocName(undefined, undefined)).toBe(false)
  })

  it('정규명 하나가 여러 카드 키에 매칭됨 — 전부 갱신해야 정지 카드가 안 생김', () => {
    const cardKeys = ['주민등록등본', '청년 주민등록등본', '가족관계증명서']
    const echoed = '주민등록등본' // 확장이 보낸 정규명
    const matched = cardKeys.filter((k) => sameDocName(k, echoed))
    expect(matched).toEqual(['주민등록등본', '청년 주민등록등본']) // 2개 — 첫 매칭만 갱신하면 두 번째가 멈춤
  })
})
