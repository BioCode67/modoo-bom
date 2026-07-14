/**
 * 복귀 확인 대기 기록 — 공식 사이트(새 탭)로 신청/발급하러 간 사용자가 돌아온 순간을 잡아
 * '완료하셨나요?' 1탭 확인을 띄우기 위한 저장 계층.
 * ⚠️ 자동 완료 처리는 절대 하지 않는다(클릭=완료 날조 금지) — 사용자가 '네'를 눌러야만 기록된다.
 * sessionStorage 사용: 새로고침엔 유지, 브라우저 종료 시 소멸. '아직이에요'는 dismissed로 남겨
 * 같은 세션에서 재프롬프트하지 않는다(피로 방지).
 *
 * 15차 감사 반영:
 *  - '큐'로 확장 — 단일 슬롯일 땐 연속 발급(등본→가족관계) 시 앞 기록이 덮여 확인이 유실됐다.
 *  - left(실제 이탈 시각) — 클릭만 하고 떠나지 않았으면(팝업 차단·취소) 나중 아무 refocus에
 *    '완료하셨나요?'가 튀던 오탐 차단. 탭 전환(hidden)·같은 탭 이동(pagehide) 시 마킹.
 */
export type PendingReturn =
  | { kind: 'apply'; policyId: string; name: string; at: number; left?: number; dismissed?: boolean }
  | { kind: 'doc'; doc: string; at: number; left?: number; dismissed?: boolean }

const KEY = 'modoo:pendingReturn'
const MAX_QUEUE = 8 // 폭주 방지(한 세션에 수십 건 쌓임 방지)

function readQueue(): PendingReturn[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as PendingReturn | PendingReturn[]
    // 하위호환: 과거 단일 객체 스키마도 배열로 승격
    const arr = Array.isArray(v) ? v : [v]
    return arr.filter((p) => p && typeof p.at === 'number' && (p.kind === 'apply' || p.kind === 'doc'))
  } catch {
    return []
  }
}

function writeQueue(q: PendingReturn[]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))) } catch { /* 시크릿 모드 등 무시 */ }
}

/** 같은 대상(같은 정책/서류)의 기존 기록은 갱신, 아니면 큐에 추가 — 연속 발급의 앞 기록 유실 방지 */
export function setPendingReturn(p: { kind: 'apply'; policyId: string; name: string } | { kind: 'doc'; doc: string }): void {
  const q = readQueue()
  const sameTarget = (x: PendingReturn) =>
    x.kind === p.kind && (p.kind === 'apply' ? (x as { policyId?: string }).policyId === p.policyId : (x as { doc?: string }).doc === (p as { doc: string }).doc)
  const rest = q.filter((x) => !sameTarget(x))
  // at은 큐 내 식별자로도 쓰인다 — 같은 밀리초에 연속 기록되면 dismiss/clear(at)가 여러 항목을 지우므로 고유화
  const now = Date.now()
  const at = rest.length ? Math.max(now, ...rest.map((x) => x.at + 1)) : now
  writeQueue([...rest, { ...p, at }])
}

/** 사용자가 실제로 페이지를 떠났음을 큐 전체에 마킹(탭 전환·페이지 이탈 시 호출) */
export function markPendingLeft(): void {
  const q = readQueue()
  if (!q.length) return
  const now = Date.now()
  writeQueue(q.map((p) => (p.left ? p : { ...p, left: now })))
}

/** 물어볼 첫 활성 항목(미응답·실제 이탈 있음) — 없으면 null */
export function getPendingReturn(): PendingReturn | null {
  return readQueue().find((p) => !p.dismissed) ?? null
}

/** 특정 기록만 제거(at 식별) — 인자 없으면 전체 비움(상담 초기화 등) */
export function clearPendingReturn(at?: number): void {
  if (at === undefined) {
    try { sessionStorage.removeItem(KEY) } catch { /* noop */ }
    return
  }
  writeQueue(readQueue().filter((p) => p.at !== at))
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

/** '아직이에요' — 해당 기록만 dismissed(이 세션에선 다시 묻지 않음), 다음 항목은 이어서 물을 수 있게 */
export function dismissPendingReturn(at?: number): void {
  const q = readQueue()
  if (!q.length) return
  writeQueue(q.map((p) => (at === undefined || p.at === at ? { ...p, dismissed: true } : p)))
}
