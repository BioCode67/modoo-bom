// 백그라운드 완료 배지 — 사용자가 정부 사이트 탭·다른 창에 가 있는 동안 발급/신청이 종결되면
// '탭 제목'에 표시해 알린다(OS 알림 권한 불필요·무설치). 탭으로 돌아오면 자동 원복.
// ⚠️ 보이는 중(visible)엔 아무것도 하지 않는다 — 화면의 카드가 이미 상태를 보여주므로 소음 금지.

let prevTitle: string | null = null
let listening = false

function restoreOnVisible() {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  if (prevTitle !== null) { document.title = prevTitle; prevTitle = null }
  document.removeEventListener('visibilitychange', restoreOnVisible)
  listening = false
}

/** 탭이 백그라운드일 때만 제목에 배지 — 돌아오면 자동 원복. visible이면 no-op. */
export function titleBadge(text: string) {
  try {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') return
    if (prevTitle === null) prevTitle = document.title
    document.title = text
    if (!listening) { document.addEventListener('visibilitychange', restoreOnVisible); listening = true }
  } catch { /* 알림 실패가 기능을 깨지 않게 */ }
}
