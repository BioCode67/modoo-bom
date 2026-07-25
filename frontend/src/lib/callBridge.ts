/**
 * 📞 통화 열기 브리지 — ChatWidget(지연 로딩)이 아직 안 떠 있어도 통화 요청이 유실되지 않게.
 *
 * 왜: ChatWidget을 lazy로 바꾸면서(첫 화면 번들 −88KB) 'modoobom:voice-call' 이벤트 수신이
 * 청크 로드 후에야 붙는다. 느린 네트워크에서 사용자가 그 전에 [📞 전화로 설명 듣기] 등을 누르면
 * 이벤트가 허공에 사라져 버튼이 죽은 것처럼 보인다(심사위원 폰에서 최악의 첫인상).
 *
 * 해법: issueBridge와 동일한 pending+이벤트 이중화 — 발신은 requestVoiceCall 하나로 통일하고,
 * ChatWidget은 마운트 시 pending을 이어받아 소비한다(이벤트를 받았으면 pending은 이미 소거됨).
 * 순수 모듈 상태(서버·저장소 무관), 소비는 1회성(중복 통화 방지).
 */

export interface VoiceCallDetail {
  briefing?: boolean
  lang?: string
}

let pending: VoiceCallDetail | null = null

/** 통화 열기 요청 — 어디서든 이걸로(직접 dispatchEvent 금지). 리스너가 있으면 즉시, 없으면 마운트 때 이어받음. */
export function requestVoiceCall(detail: VoiceCallDetail = {}): void {
  pending = detail
  try {
    window.dispatchEvent(new CustomEvent('modoobom:voice-call', { detail }))
  } catch { /* SSR·테스트 등 window 부재 시 pending만 유지 */ }
}

/** 리스너가 실제 수신했을 때 호출 — pending을 소거해 마운트 시 중복 실행을 막는다. */
export function markVoiceCallHandled(): void {
  pending = null
}

/** ChatWidget 마운트 시 1회 호출 — 마운트 전에 눌린 요청을 반환하고 소거(없으면 null). */
export function consumePendingVoiceCall(): VoiceCallDetail | null {
  const p = pending
  pending = null
  return p
}
