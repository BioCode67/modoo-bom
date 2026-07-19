import { describe, expect, it } from 'vitest'
import { VOICE_LANGS, voiceStrings, voiceRouteLang, routeReplyFor } from './voiceI18n'

describe('voiceI18n — 통화 상담 다국어', () => {
  it('4개 언어 문자열이 전부 채워져 있다(빈 문구 노출 방지)', () => {
    for (const code of ['ko', 'en', 'vi', 'zh']) {
      const s = VOICE_LANGS[code]
      expect(s.label).toBeTruthy()
      expect(s.sttTag).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
      expect(s.greeting).toBeTruthy()
      expect(s.micIdle).toBeTruthy()
      expect(s.placeholder).toBeTruthy()
      expect(s.statusListening).toBeTruthy()
    }
    // 외국어 3종은 라우팅 안내문 필수(한국어는 규칙 두뇌가 직접 답하므로 없음)
    for (const code of ['en', 'vi', 'zh']) {
      expect(VOICE_LANGS[code].routeReply).toBeTruthy()
      expect(VOICE_LANGS[code].routeCta).toBeTruthy()
    }
  })

  it('voiceStrings — 미지원 코드는 한국어 폴백', () => {
    expect(voiceStrings('th').label).toBe('한국어')
    expect(voiceStrings('en').label).toBe('English')
  })

  it('voiceRouteLang — 외국어 문장만 라우팅, 한국어·오타는 규칙 두뇌 유지', () => {
    expect(voiceRouteLang('기초연금 알려줘')).toBe('ko')
    expect(voiceRouteLang('dkssud')).toBe('ko') // 한/영 IME 오타 오발동 금지
    expect(voiceRouteLang('LH 청약')).toBe('ko') // 영문 약어 오발동 금지
    expect(voiceRouteLang('housing support for foreigners')).toBe('en')
    expect(voiceRouteLang('hỗ trợ nhà ở')).toBe('vi')
    expect(voiceRouteLang('住房补贴咨询')).toBe('zh')
  })

  it('routeReplyFor — 지원 언어는 자국어, 그 밖은 영어 폴백', () => {
    expect(routeReplyFor('vi').speakLang).toBe('vi')
    expect(routeReplyFor('vi').text).toContain('AI')
    expect(routeReplyFor('th')).toEqual(routeReplyFor('ru')) // 미지원 → 동일 영어 폴백
    expect(routeReplyFor('th').speakLang).toBe('en')
  })
})
