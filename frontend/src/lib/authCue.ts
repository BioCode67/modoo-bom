/**
 * 📱 인증 대기 알림음 — RPA 태스크가 '휴대폰 인증 승인 대기'(waiting_login)로 넘어가는 순간
 * 짧은 두 음(라→레, 0.4초)을 울려, 화면을 안 보고 있어도 "지금 폰을 집으세요" 신호를 준다.
 * 발표(연쇄 발급 중 설명하느라 화면을 못 봄)·멀티태스킹(다른 탭 작업 중) 모두에서 유효.
 *
 * 원칙:
 * - 에셋 없는 Web Audio 합성음(사인파) — 파일 로드·네트워크 없음
 * - 발급/신청은 항상 버튼 클릭으로 시작되므로 자동재생 정책상 재생 가능(제스처 이력 있음).
 *   그래도 실패(미지원·정책 차단)는 조용히 무시 — 소리는 부가 기능, 흐름을 막지 않는다
 * - 3초 디바운스: 여러 카드가 동시에 인증 대기로 전이해도 소리가 겹치지 않게
 * - 전이 감지는 호출측 책임(비대기→대기 순간에만 호출) — 같은 대기 상태 폴링마다 울리지 않는다
 */
let ctx: AudioContext | null = null
let lastAt = 0

/** waiting_login 전이 판정 헬퍼 — 폴링 루프에서 (이전상태, 현재상태)로 호출 여부를 정한다. */
export function isAuthWaitTransition(prev: string | undefined, next: string | undefined): boolean {
  return next === 'waiting_login' && prev !== 'waiting_login'
}

export function playAuthCue(): void {
  const now = Date.now()
  if (now - lastAt < 3000) return
  lastAt = now
  try {
    const AC = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = ctx || new AC()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t0 = ctx.currentTime
    // 두 음이 살짝 겹치며 올라가는 '알림' 모양 — 크지 않게(피크 게인 0.12)
    for (const [freq, at] of [[880, 0], [1174.66, 0.18]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.22)
    }
  } catch { /* 미지원·정책 차단 — 부가 기능이라 조용히 무시 */ }
}
