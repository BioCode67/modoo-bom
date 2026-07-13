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

/**
 * 전자증명서 발급 시작 공용 처리 — 새 탭은 호출부의 <a>/제스처가 직접 열고, 여기선
 * ① 복귀 시 '발급하셨나요?' 확인 대기 기록 ② 정부 폼 첫 칸에 붙여넣을 이름을 클립보드에 준비.
 * DocumentCenter·PolicyDetailDrawer가 같은 헬퍼를 써 무설치 '한 탭 + 내 정보' 경험을 일치시킨다
 * (감사 확정: 드로어 발급 링크가 이름복사·복귀확인을 건너뛰어 절반만 동작하던 불일치 해소).
 * ⚠️ 클립보드 쓰기는 새 탭이 열리기 '전에'(문서 포커스 유지) onClick에서 개시해야 성공한다.
 */
export function beginDocIssue(doc: string, name?: string): void {
  setPendingReturn({ kind: 'doc', doc })
  const nm = (name || '').trim()
  if (nm) navigator.clipboard?.writeText(nm).catch(() => { /* 클립보드 미지원/비허용 환경 무시 */ })
}

/** '아직이에요' — 기록은 남기되 이 세션에선 다시 묻지 않는다 */
export function dismissPendingReturn(): void {
  const p = getPendingReturn()
  if (!p) return
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...p, dismissed: true })) } catch { /* noop */ }
}
