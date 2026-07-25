import { describe, it, expect } from 'vitest'
import { requestVoiceCall, consumePendingVoiceCall, markVoiceCallHandled } from './callBridge'

// 순수 로직 전용(프로젝트 컨벤션: 무DOM) — 이벤트 경로는 실브라우저 smoke(2.7/3.7/4.8)가 검증하고,
// 여기선 '위젯 미탑재 시 유실 방지'라는 pending 계약만 고정한다.
describe('callBridge — 지연 로딩 통화 요청 유실 방지', () => {
  it('요청은 pending을 보관한다(리스너 유무와 무관 — 무DOM에서도 안전)', () => {
    requestVoiceCall({ briefing: true })
    expect(consumePendingVoiceCall()).toEqual({ briefing: true })
  })

  it('마운트 전에 눌린 요청을 이어받는다(위젯 미탑재 시나리오)', () => {
    requestVoiceCall({ lang: 'en' })          // 리스너 없음 — 이벤트는 허공, pending만 생존
    expect(consumePendingVoiceCall()).toEqual({ lang: 'en' }) // 마운트 시 이어받기
    expect(consumePendingVoiceCall()).toBeNull()              // 1회성 — 중복 통화 방지
  })

  it('실수신(markVoiceCallHandled) 후엔 pending이 소거돼 이중 실행이 없다', () => {
    requestVoiceCall({ briefing: true })
    markVoiceCallHandled()                    // ChatWidget 리스너가 실제로 받음
    expect(consumePendingVoiceCall()).toBeNull()
  })

  it('detail 없는 기본 요청도 동작(Analyze 모드화면 CTA)', () => {
    requestVoiceCall()
    expect(consumePendingVoiceCall()).toEqual({})
  })
})
