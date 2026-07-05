import { describe, it, expect } from 'vitest'
import { annotateTerms } from './glossary'

describe('annotateTerms — 본문 인라인 용어 하이라이트', () => {
  it('사전 용어를 세그먼트로 분리하고 term을 붙인다', () => {
    const segs = annotateTerms('소득인정액이 기준 중위소득 50% 이하')
    const terms = segs.filter((s) => s.term).map((s) => s.text)
    expect(terms).toContain('소득인정액')
    // '기준 중위소득'이 '중위소득'보다 먼저 매칭(길이 우선)
    expect(terms.some((t) => t === '기준 중위소득')).toBe(true)
  })
  it('같은 용어 반복은 첫 등장만 표시', () => {
    const segs = annotateTerms('차상위계층 지원. 차상위계층 확인.')
    expect(segs.filter((s) => s.term?.term === '차상위계층').length).toBe(1)
  })
  it('과잉매칭 방지 — 단독 흔한 단어는 하이라이트 안 함', () => {
    const segs = annotateTerms('소득이 낮은 가구 지원')
    // '소득' 단독은 별칭에 없음 → term 없음
    expect(segs.every((s) => !s.term)).toBe(true)
  })
  it('사전 용어 없는 문장은 원문 그대로', () => {
    const segs = annotateTerms('월 최대 20만원 지급')
    expect(segs).toHaveLength(1)
    expect(segs[0].term).toBeUndefined()
  })
  it('감사 회귀: 합성어 내부/접두 오매칭 금지 — "국민기초생활보장법"의 "기초생활"을 잘라 붙이지 않음', () => {
    const segs = annotateTerms('국민기초생활보장법에 따른 수급자')
    // '기초생활'(→기초생활수급자) 별칭이 합성어 중간에서 하이라이트되면 안 됨
    expect(segs.every((s) => s.text !== '기초생활' || !s.term)).toBe(true)
    // 원문 텍스트는 손실 없이 보존
    expect(segs.map((s) => s.text).join('')).toBe('국민기초생활보장법에 따른 수급자')
  })
  it('단어+조사는 정상 하이라이트 유지 — "생계급여를"의 생계급여', () => {
    const segs = annotateTerms('생계급여를 받는 가구')
    expect(segs.some((s) => s.term?.term === '생계급여')).toBe(true)
  })
  it('2차 회귀 방지: "기초생활수급 장애인"의 기초생활수급자 용어는 살아있어야(경계가드 과차단 방지)', () => {
    const segs = annotateTerms('기초생활수급 장애인 대상')
    expect(segs.some((s) => s.term?.term === '기초생활수급자')).toBe(true)
  })
  it('2차 회귀 방지: 긴 별칭이 거부돼도 내부 짧은 별칭은 살아남음 — "소득기준 중위소득"의 중위소득', () => {
    const segs = annotateTerms('소득기준 중위소득 130% 이하')
    // '기준 중위소득'은 앞글자 '득'(합성어)로 거부되지만, 그 안의 '중위소득'은 매칭돼야 한다
    expect(segs.some((s) => s.term?.term === '기준 중위소득')).toBe(true)
  })
})
