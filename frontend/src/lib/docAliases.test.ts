import { describe, it, expect } from 'vitest'
import { issuableCanonical, substituteIssuableDoc } from './docAliases'

describe('docAliases — 발급 서류 표기 정규화', () => {
  it('정식명은 그대로 정식명으로', () => {
    expect(issuableCanonical('주민등록등본', 'local')).toBe('주민등록등본')
    expect(issuableCanonical('한부모가족 증명서', 'local')).toBe('한부모가족 증명서')
  })

  it('포함관계 변형은 정식명으로 해석된다 — 백엔드 정확명 요구와의 드리프트 해소', () => {
    expect(issuableCanonical('자녀 주민등록등본', 'local')).toBe('주민등록등본')
    expect(issuableCanonical('주민등록 등본', 'local')).toBe('주민등록등본')
    // 데이터가 충족 서류를 괄호로 명시한 표기 — 그 명시 서류를 발급하는 게 데이터의 지시
    expect(issuableCanonical('소득 확인서류(소득금액증명 등)', 'local')).toBe('소득금액증명')
  })

  it('중첩 이름은 가장 긴 정식명 우선 — 초본이 등본으로 오해석되지 않는다', () => {
    expect(issuableCanonical('주민등록초본', 'local')).toBe('주민등록초본')
    expect(issuableCanonical('세대주 주민등록초본', 'local')).toBe('주민등록초본')
  })

  it('확실한 별칭(같은 문서의 다른 이름)은 정식명으로', () => {
    expect(issuableCanonical('한부모 확인서', 'local')).toBe('한부모가족 증명서')
    expect(issuableCanonical('출입국사실증명', 'local')).toBe('출입국에 관한 사실증명')
  })

  it('지원되지 않는 서류는 null — 없는 지원을 지어내지 않는다', () => {
    expect(issuableCanonical('임대차계약서', 'local')).toBeNull()
    expect(issuableCanonical('진단서', 'local')).toBeNull()
    expect(issuableCanonical('', 'local')).toBeNull()
  })

  it('대체 제안은 정식명 해석 불가한 이름에만, 힌트로만', () => {
    expect(substituteIssuableDoc('소득확인서류')).toBe('소득금액증명')
    expect(substituteIssuableDoc('장애인등록증')).toBe('장애인증명서')
    expect(substituteIssuableDoc('수급자 확인서 또는 차상위 확인서')).toBe('기초생활수급자 증명서')
  })

  it('정식명으로 해석되는 이름엔 대체 제안을 내지 않는다(이중 안내 방지)', () => {
    expect(substituteIssuableDoc('주민등록등본')).toBeNull()
    expect(substituteIssuableDoc('한부모 확인서')).toBeNull()
  })

  it('대체 불가 서류는 null', () => {
    expect(substituteIssuableDoc('임대차계약서')).toBeNull()
    expect(substituteIssuableDoc('통장 사본')).toBeNull()
  })
})
