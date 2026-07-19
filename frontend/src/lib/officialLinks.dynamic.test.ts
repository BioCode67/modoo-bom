import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_RPA_DOCS, setLocalRpaDocs, localRpaDocs, isRpaSupported, isLocalBetaDoc } from './officialLinks'
import { issuableCanonical } from './docAliases'

describe('동적 서류 커버리지 — setLocalRpaDocs 승격', () => {
  afterEach(() => setLocalRpaDocs([...LOCAL_RPA_DOCS], [])) // 모듈 상태 복원(스위트 오염 방지)

  it('기본값: 내장 15종 — 미등록 서류는 local 미지원', () => {
    expect(localRpaDocs()).toEqual(LOCAL_RPA_DOCS)
    expect(isRpaSupported('혼인관계증명서', 'local')).toBe(false)
    expect(isLocalBetaDoc('혼인관계증명서')).toBe(false)
  })

  it('서버 지원목록으로 승격하면 게이트·정식명 해석·β 배지가 함께 반영된다', () => {
    setLocalRpaDocs([...LOCAL_RPA_DOCS, '혼인관계증명서'], ['혼인관계증명서'])
    expect(isRpaSupported('혼인관계증명서', 'local')).toBe(true)
    expect(isRpaSupported('혼인관계증명서')).toBe(true) // 채널 미지정(최대 집합)도 포함
    expect(isLocalBetaDoc('혼인 관계 증명서')).toBe(true) // 공백 변형 무관
    // 자동첨부 정식명 해석(docAliases)도 동적 목록을 따른다
    expect(issuableCanonical('혼인관계증명서', 'local')).toBe('혼인관계증명서')
    expect(issuableCanonical('배우자 혼인관계증명서', 'local')).toBe('혼인관계증명서')
  })

  it('빈 목록은 무시 — 서버 오응답이 내장 15종을 지우지 못한다(정직 폴백)', () => {
    setLocalRpaDocs([], ['x'])
    expect(localRpaDocs()).toEqual(LOCAL_RPA_DOCS)
    expect(isRpaSupported('주민등록등본', 'local')).toBe(true)
  })
})
