/**
 * 복귀 확인 대기 기록 — 공식 사이트(새 탭)로 신청/발급하러 간 사용자가 돌아온 순간을 잡아
 * '완료하셨나요?' 1탭 확인을 띄우기 위한 저장 계층.
 * ⚠️ 자동 완료 처리는 절대 하지 않는다(클릭=완료 날조 금지) — 사용자가 '네'를 눌러야만 기록된다.
 * sessionStorage 사용: 새로고침엔 유지, 브라우저 종료 시 소멸. '아직이에요'는 dismissed로 남겨
 * 같은 세션에서 재프롬프트하지 않는다(피로 방지).
 */
export type PendingReturn =
  | { kind: 'apply'; policyId: string; name: string; at: number; dismissed?: boolean }
  | { kind: 'doc'; doc: string; at: number; dismissed?: boolean }

const KEY = 'modoo:pendingReturn'

export function setPendingReturn(p: { kind: 'apply'; policyId: string; name: string } | { kind: 'doc'; doc: string }): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() }))
  } catch { /* 시크릿 모드 등 저장 불가 환경은 조용히 무시 */ }
}

export function getPendingReturn(): PendingReturn | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingReturn
    if (!p || typeof p.at !== 'number' || (p.kind !== 'apply' && p.kind !== 'doc')) return null
    return p
  } catch {
    return null
  }
}

export function clearPendingReturn(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* noop */ }
}

/** '아직이에요' — 기록은 남기되 이 세션에선 다시 묻지 않는다 */
export function dismissPendingReturn(): void {
  const p = getPendingReturn()
  if (!p) return
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...p, dismissed: true })) } catch { /* noop */ }
}
