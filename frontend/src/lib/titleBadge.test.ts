/** 탭 제목 완료 배지 — visible no-op·원제목 1회 저장·복귀 시 원복 계약. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function makeDoc(visibility: string) {
  const listeners: Record<string, (() => void)[]> = {}
  return {
    title: '모두봄',
    visibilityState: visibility,
    addEventListener: (ev: string, cb: () => void) => { (listeners[ev] ??= []).push(cb) },
    removeEventListener: (ev: string, cb: () => void) => {
      listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== cb)
    },
    fire(ev: string) { for (const cb of [...(listeners[ev] ?? [])]) cb() },
  }
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals() })

describe('titleBadge', () => {
  it('화면이 보이는 중(visible)에는 아무것도 하지 않는다 — 카드가 이미 상태를 보여주므로 소음 금지', async () => {
    const doc = makeDoc('visible')
    vi.stubGlobal('document', doc)
    const { titleBadge } = await import('./titleBadge')
    titleBadge('✅ 완료')
    expect(doc.title).toBe('모두봄')
  })

  it('백그라운드면 배지로 바꾸고, 돌아오면 원제목으로 복원한다', async () => {
    const doc = makeDoc('hidden')
    vi.stubGlobal('document', doc)
    const { titleBadge } = await import('./titleBadge')
    titleBadge('✅ 등본 발급 완료 — 모두봄')
    expect(doc.title).toBe('✅ 등본 발급 완료 — 모두봄')
    doc.visibilityState = 'visible'
    doc.fire('visibilitychange')
    expect(doc.title).toBe('모두봄')
  })

  it('백그라운드 중 배지가 여러 번 갱신돼도 원제목은 첫 값으로 복원된다(배지가 원제목을 오염하지 않음)', async () => {
    const doc = makeDoc('hidden')
    vi.stubGlobal('document', doc)
    const { titleBadge } = await import('./titleBadge')
    titleBadge('📱 인증 승인 필요')
    titleBadge('✅ 발급 완료 — 모두봄') // 두 번째 배지 — prevTitle을 덮으면 안 됨
    expect(doc.title).toBe('✅ 발급 완료 — 모두봄')
    doc.visibilityState = 'visible'
    doc.fire('visibilitychange')
    expect(doc.title).toBe('모두봄')
  })
})
