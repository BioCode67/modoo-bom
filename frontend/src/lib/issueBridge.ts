/**
 * 💬→🖨 발급 브리지 — 챗("등본 발급해줘")이 지목한 서류를 '나의 복지'의 서류 도우미가 이어받아
 * 실제 자동발급을 시작하게 하는 전달 통로(ProbeCoverage의 pending 패턴과 동일 설계).
 *
 * 뷰 전환 직후엔 DocumentCenter가 아직 마운트 전이라 이벤트가 유실될 수 있다 — 보류 이름을
 * 남겨 마운트 시 이어받는다. 실행 자체(인증정보 가드·상태 표시)는 기존 발급 경로를 그대로 탄다.
 *
 * 보류 유효시간(PENDING_TTL_MS): 소비되지 못하고 좌초된 보류가 한참 뒤 사용자가 무관한 이유로
 * '서류 발급' 탭을 열 때 예고 없이 브라우저 기동·간편인증을 켜는 '돌발 실행'을 차단한다.
 * 정상 경로(요청→나의 복지 착지→즉시 소비)는 수백 ms라 여유가 크다.
 */
export const ISSUE_DOC_EVENT = 'modoobom:issue-doc'

const PENDING_TTL_MS = 120_000

let _pending = ''
let _pendingAt = 0

export function requestIssueDoc(doc: string): void {
  _pending = doc
  _pendingAt = Date.now()
  try { window.dispatchEvent(new CustomEvent(ISSUE_DOC_EVENT, { detail: doc })) } catch { /* SSR 등 무시 */ }
}

export function takePendingIssue(): string {
  // 유효시간이 지난 보류는 버린다(빈 값 반환) — 늦은 자동 RPA 기동 금지
  const p = Date.now() - _pendingAt <= PENDING_TTL_MS ? _pending : ''
  _pending = ''
  return p
}

// "서류 전부 발급해줘" — 원클릭 연쇄(부족분만·한 번 인증) 전체 시작 채널(단건과 동일한 보류+이벤트 설계)
export const ISSUE_ALL_EVENT = 'modoobom:issue-all'

let _pendingAll = false
let _pendingAllAt = 0

export function requestIssueAll(): void {
  _pendingAll = true
  _pendingAllAt = Date.now()
  try { window.dispatchEvent(new Event(ISSUE_ALL_EVENT)) } catch { /* SSR 등 무시 */ }
}

export function takePendingIssueAll(): boolean {
  const p = _pendingAll && Date.now() - _pendingAllAt <= PENDING_TTL_MS
  _pendingAll = false
  return p
}

/**
 * 비소비 조회 — '나의 복지'가 착지 시점에 '서류 발급' 탭을 자동으로 열지 판단하는 용도.
 * 보류를 소거하지 않으므로 실제 소비(발급 시작)는 DocumentCenter의 기존 이어받기 경로가 그대로 한다.
 * (유효시간이 지난 보류는 없는 것으로 본다 — 탭만 열리고 아무 일도 안 일어나는 헛전환 방지)
 */
export function hasPendingIssue(): boolean {
  const now = Date.now()
  return (_pending !== '' && now - _pendingAt <= PENDING_TTL_MS)
    || (_pendingAll && now - _pendingAllAt <= PENDING_TTL_MS)
}
