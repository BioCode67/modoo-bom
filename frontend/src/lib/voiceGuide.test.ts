import { describe, expect, it } from 'vitest'
import {
  GUIDE_STEPS, matchGuideCommand, applyGuideCommand,
  GUIDE_LANGS, GUIDE_UI, guideSteps, guideUi,
} from './voiceGuide'

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

describe('다국어 대본·UI 패리티(ko·en·vi·zh)', () => {
  it('모든 언어가 같은 단계 구조(id·순서·goto)를 가진다', () => {
    const koIds = guideSteps('ko').map((s) => s.id)
    for (const lang of GUIDE_LANGS) {
      const steps = guideSteps(lang)
      expect(steps.map((s) => s.id), lang).toEqual(koIds)
      // 마지막만 goto, 값은 언어 무관
      expect(steps.filter((s) => s.goto).map((s) => s.goto), lang).toEqual(['analyze'])
    }
  })

  it('각 언어 낭독문·제목·칩이 비어있지 않고, 이모지·마크다운·URL이 없다', () => {
    for (const lang of GUIDE_LANGS) {
      for (const s of guideSteps(lang)) {
        expect(s.title.length, `${lang}/${s.id}`).toBeGreaterThan(0)
        expect(s.chip.length, `${lang}/${s.id}`).toBeGreaterThan(0)
        expect(s.say.length, `${lang}/${s.id}`).toBeGreaterThan(10)
        expect(s.say, `${lang}/${s.id}`).not.toMatch(/https?:\/\//)
        expect(s.say, `${lang}/${s.id}`).not.toMatch(/[*_#`•]/)
        expect(s.say, `${lang}/${s.id}`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      }
    }
  })

  it('모든 언어에 조작 UI 문자열이 채워져 있다', () => {
    for (const lang of GUIDE_LANGS) {
      const ui = guideUi(lang)
      for (const k of Object.keys(GUIDE_UI.ko) as (keyof typeof ui)[]) {
        expect(ui[k], `${lang}/${k}`).toBeTruthy()
      }
    }
    // a11y 감사가 여는 다이얼로그 라벨(ko)은 고정 문자열
    expect(GUIDE_UI.ko.dialogLabel).toBe('음성 사용법 안내')
  })

  it('미지원 코드는 한국어로 폴백', () => {
    // @ts-expect-error 지원 목록 밖 코드로 폴백 동작 검증
    expect(guideSteps('xx')).toEqual(guideSteps('ko'))
    // @ts-expect-error 지원 목록 밖 코드로 폴백 동작 검증
    expect(guideUi('xx')).toBe(GUIDE_UI.ko)
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

  it('다국어 명령(en·vi·zh)도 판정한다', () => {
    // next
    expect(matchGuideCommand('next please')).toBe('next')
    expect(matchGuideCommand('tiếp theo')).toBe('next')
    expect(matchGuideCommand('下一步')).toBe('next')
    // prev
    expect(matchGuideCommand('go back')).toBe('prev')
    expect(matchGuideCommand('quay lại')).toBe('prev')
    expect(matchGuideCommand('上一步')).toBe('prev')
    // repeat
    expect(matchGuideCommand('say it again')).toBe('repeat')
    expect(matchGuideCommand('lặp lại')).toBe('repeat')
    expect(matchGuideCommand('再说一遍')).toBe('repeat')
    // stop
    expect(matchGuideCommand('stop')).toBe('stop')
    expect(matchGuideCommand('dừng lại')).toBe('stop')
    expect(matchGuideCommand('退出')).toBe('stop')
    // start
    expect(matchGuideCommand("let's go")).toBe('start')
    expect(matchGuideCommand('bắt đầu')).toBe('start')
    expect(matchGuideCommand('开始')).toBe('start')
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
