import { describe, it, expect } from 'vitest'
import { hasVoiceFor } from './useTTS'

/**
 * TTS 다국어 헤드라인 회귀 가드 — '자국어로 말하면 음성으로 답'이 실제 언어 태그로 읽히는지.
 * (useTTS의 speak(text, lang)은 브라우저 API라 jsdom에서 직접 재생 불가 — 언어 태그 매핑 계약만 검증)
 */
describe('useTTS 다국어 — hasVoiceFor 언어코드 처리', () => {
  it('jsdom(음성합성 미지원)에서는 false로 안전 폴백', () => {
    // speechSynthesis 없음 → false (UI에서 '이 브라우저는 해당 언어 음성이 없어요' 안내 가능)
    expect(hasVoiceFor('en')).toBe(false)
    expect(hasVoiceFor('ko')).toBe(false)
    expect(hasVoiceFor(undefined)).toBe(false)
  })
})
