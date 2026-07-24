import { describe, expect, it } from 'vitest'
import { GUIDE_STEPS, matchGuideCommand, applyGuideCommand } from './voiceGuide'

describe('GUIDE_STEPS — 음성 사용법 대본', () => {
  it('발견→이해→신청→관리 흐름의 여러 단계가 있다', () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(4)
  })

  it('낭독문에 이모지·마크다운·URL이 없다(그대로 TTS에 들어가도 소음 없게)', () => {
    for (const s of GUIDE_STEPS) {
      expect(s.say, s.id).not.toMatch(/https?:\/\//)
      expect(s.say, s.id).not.toMatch(/[*_#`•]/)
      // 이모지/기호 영역
      expect(s.say, s.id).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      expect(s.say.length, s.id).toBeGreaterThan(10)
    }
  })

  it('id가 유일하고, 마지막 단계만 goto(마무리 이동)를 가진다', () => {
    const ids = GUIDE_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const withGoto = GUIDE_STEPS.filter((s) => s.goto)
    expect(withGoto).toHaveLength(1)
    expect(GUIDE_STEPS[GUIDE_STEPS.length - 1].goto).toBe('analyze')
  })
})

describe('matchGuideCommand — 발화 → 명령', () => {
  it('다음 계열', () => {
    for (const t of ['다음', '다음이요', '넘겨 주세요', '계속', '넘어가', '다음 거']) {
      expect(matchGuideCommand(t), t).toBe('next')
    }
  })
  it('이전 계열', () => {
    for (const t of ['이전', '뒤로', '뒤로 가줘', '전으로', '돌아가']) {
      expect(matchGuideCommand(t), t).toBe('prev')
    }
  })
  it('다시 계열(다음과 혼동 없음)', () => {
    for (const t of ['다시', '다시 들려줘', '한 번 더', '못 들었어요']) {
      expect(matchGuideCommand(t), t).toBe('repeat')
    }
    // '다음'은 '다시'로 오인되지 않는다
    expect(matchGuideCommand('다음')).toBe('next')
  })
  it('그만 계열', () => {
    for (const t of ['그만', '그만할래요', '멈춰', '종료', '끝내줘', '닫아 줘', '나갈래']) {
      expect(matchGuideCommand(t), t).toBe('stop')
    }
  })
  it('시작 계열', () => {
    for (const t of ['시작', '시작할게요', '복지 찾으러 가자', '해볼게요']) {
      expect(matchGuideCommand(t), t).toBe('start')
    }
  })
  it('알 수 없는 말은 null(무시)', () => {
    expect(matchGuideCommand('오늘 날씨 좋네요')).toBeNull()
    expect(matchGuideCommand('')).toBeNull()
    expect(matchGuideCommand('   ')).toBeNull()
  })
})

describe('applyGuideCommand — 명령 → 다음 인덱스', () => {
  const total = GUIDE_STEPS.length
  it('next는 다음으로, 마지막에서 next는 종료(-1)', () => {
    expect(applyGuideCommand('next', 0, total)).toBe(1)
    expect(applyGuideCommand('next', total - 1, total)).toBe(-1)
  })
  it('prev는 이전으로, 첫 단계에서 prev는 0 유지', () => {
    expect(applyGuideCommand('prev', 2, total)).toBe(1)
    expect(applyGuideCommand('prev', 0, total)).toBe(0)
  })
  it('repeat은 같은 단계 유지', () => {
    expect(applyGuideCommand('repeat', 2, total)).toBe(2)
  })
  it('stop·start는 종료(-1)', () => {
    expect(applyGuideCommand('stop', 1, total)).toBe(-1)
    expect(applyGuideCommand('start', 1, total)).toBe(-1)
  })
})
