import { describe, expect, it } from 'vitest'
import { speakableText } from './speakable'

describe('speakableText — TTS 낭독용 정제', () => {
  it('마크다운 굵게·글머리·URL·이모지를 제거한다', () => {
    const md = '**기초연금** 대상이에요 🎉\n• 월 최대 349,700원\n자세히: https://bokjiro.go.kr'
    const s = speakableText(md)
    expect(s).not.toMatch(/\*|•|https|🎉/)
    expect(s).toContain('기초연금')
    expect(s).toContain('월 최대 349,700원')
  })

  it('줄바꿈을 문장 쉼으로 바꿔 낭독이 끊기지 않게 한다', () => {
    expect(speakableText('첫 줄\n둘째 줄')).toBe('첫 줄, 둘째 줄')
    expect(speakableText('첫 문단\n\n둘째 문단')).toBe('첫 문단. 둘째 문단')
  })

  it('빈 입력은 빈 문자열', () => {
    expect(speakableText('')).toBe('')
  })
})
