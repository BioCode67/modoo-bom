/** 📱 인증 대기 알림음 — 전이 판정·1회 재생·디바운스·미지원 무해성. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function makeFakeAudio() {
  const started: number[] = []
  class FakeGainNode {
    gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
    connect = vi.fn()
  }
  class FakeOscillator {
    type = ''
    frequency = { value: 0 }
    connect = vi.fn(() => new FakeGainNode())
    start = () => { started.push(this.frequency.value) }
    stop = vi.fn()
  }
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    resume = vi.fn(async () => {})
    createOscillator() { return new FakeOscillator() as unknown as OscillatorNode }
    createGain() { return new FakeGainNode() as unknown as GainNode }
  }
  return { FakeAudioContext, started }
}

beforeEach(() => { vi.useFakeTimers(); vi.resetModules() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('isAuthWaitTransition', () => {
  it('비대기→대기 순간만 true (같은 대기 폴링·종결 전이는 false)', async () => {
    const { isAuthWaitTransition } = await import('./authCue')
    expect(isAuthWaitTransition('running', 'waiting_login')).toBe(true)
    expect(isAuthWaitTransition(undefined, 'waiting_login')).toBe(true)
    expect(isAuthWaitTransition('waiting_login', 'waiting_login')).toBe(false)
    expect(isAuthWaitTransition('waiting_login', 'done')).toBe(false)
    expect(isAuthWaitTransition('running', 'running')).toBe(false)
  })
})

describe('playAuthCue', () => {
  it('두 음을 재생하고, 3초 안 재호출은 디바운스, 지나면 다시 울린다', async () => {
    vi.setSystemTime(1_000_000)
    const { FakeAudioContext, started } = makeFakeAudio()
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const { playAuthCue } = await import('./authCue')
    playAuthCue()
    expect(started).toEqual([880, 1174.66])
    playAuthCue() // 즉시 재호출 — 디바운스
    expect(started).toHaveLength(2)
    vi.setSystemTime(1_000_000 + 3500)
    playAuthCue()
    expect(started).toHaveLength(4)
  })

  it('AudioContext 미지원이면 조용히 무해하게 넘어간다', async () => {
    vi.stubGlobal('window', {})
    const { playAuthCue } = await import('./authCue')
    expect(() => playAuthCue()).not.toThrow()
  })
})
