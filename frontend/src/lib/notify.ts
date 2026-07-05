/**
 * 선제 로컬 알림 — 서버(푸시 서버) 없이, PWA 서비스워커의 로컬 알림으로 '챙길 복지'를 알려준다.
 * 경쟁 서비스(웰로·복지멤버십)의 핵심 기능인 '마감·갱신 선제 알림'을 백엔드 없이 구현.
 *
 * 정직한 한계: 웹은 서버 없이 '앱이 닫힌 동안'의 푸시가 불가능하다. 그래서 이 모듈은
 *  - 사용자가 옵트인하면, **재방문 시 하루 1회** 마감·신청·갱신 등 '할 일'이 있으면 요약 알림을 띄운다.
 *  - 정보는 전부 기기 내에서 계산(모니터링 엔진) — 서버 전송 없음(프라이버시 원칙 유지).
 */
const LAST_KEY = 'modoobom-notify-last'
const MIN_GAP = 20 * 60 * 60 * 1000 // 재알림 최소 간격(20시간 ≈ 하루 1회)

export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export function notifyPermission(): NotificationPermission {
  return notifySupported() ? Notification.permission : 'denied'
}

export async function enableNotify(): Promise<boolean> {
  if (!notifySupported()) return false
  try {
    const p = await Notification.requestPermission()
    return p === 'granted'
  } catch {
    return false
  }
}

async function fireLocal(title: string, body: string, tag: string) {
  if (notifyPermission() !== 'granted') return
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const opts: NotificationOptions = {
    body,
    tag,
    icon: `${base}/pwa-192x192.png`,
    badge: `${base}/pwa-192x192.png`,
    // @ts-expect-error - renotify/lang은 표준이나 lib.dom 타입에 없을 수 있음
    renotify: true,
    lang: 'ko',
    data: { url: base + '/' },
  }
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, opts)
  } catch {
    try { new Notification(title, opts) } catch { /* 무시 */ }
  }
}

/**
 * '할 일'(마감 임박·서류 준비·신청·갱신)이 있으면 하루 1회 요약 알림을 띄운다.
 * @param dueCount high/medium 알림 개수, @param sample 대표 문구, @param signature 내용 서명(바뀌면 재알림)
 */
export async function maybeNotifyDue(dueCount: number, sample: string, signature: string): Promise<boolean> {
  if (dueCount <= 0 || notifyPermission() !== 'granted') return false
  let last: { at: number; sig: string } | null = null
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') } catch { last = null }
  const now = Date.now()
  // 같은 내용은 하루 1회만. 내용(서명)이 바뀌면 간격 무시하고 알림.
  if (last && last.sig === signature && now - last.at < MIN_GAP) return false
  await fireLocal(
    `모두봄 · 챙길 복지 ${dueCount}건 🌱`,
    sample || '마감·서류·갱신 등 지금 챙기면 좋은 복지가 있어요. 탭해서 확인하세요.',
    'modoobom-due',
  )
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: now, sig: signature })) } catch { /* 무시 */ }
  return true
}
