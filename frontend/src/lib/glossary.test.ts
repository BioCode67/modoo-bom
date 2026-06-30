import { describe, it, expect } from 'vitest'
import { GLOSSARY, searchGlossary } from './glossary'

describe('glossary', () => {
  it('핵심 용어 포함 + 필수 필드', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(15)
    for (const t of GLOSSARY) {
      expect(t.term).toBeTruthy()
      expect(t.short).toBeTruthy()
      expect(t.plain).toBeTruthy()
    }
    expect(GLOSSARY.some((t) => t.term.includes('소득인정액'))).toBe(true)
    expect(GLOSSARY.some((t) => t.term.includes('차상위'))).toBe(true)
  })
  it('빈 검색은 전체', () => {
    expect(searchGlossary('').length).toBe(GLOSSARY.length)
  })
  it('용어명 검색', () => {
    expect(searchGlossary('소득인정액').some((t) => t.term.includes('소득인정액'))).toBe(true)
  })
  it('태그/설명으로도 검색(예: 카카오 → 간편인증)', () => {
    expect(searchGlossary('카카오').some((t) => t.term.includes('간편인증'))).toBe(true)
  })
  it('없는 단어는 빈 결과', () => {
    expect(searchGlossary('존재하지않는단어xyz').length).toBe(0)
  })
})
