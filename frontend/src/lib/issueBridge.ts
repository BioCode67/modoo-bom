/**
 * 💬→🖨 발급 브리지 — 챗("등본 발급해줘")이 지목한 서류를 '나의 복지'의 서류 도우미가 이어받아
 * 실제 자동발급을 시작하게 하는 전달 통로(ProbeCoverage의 pending 패턴과 동일 설계).
 *
 * 뷰 전환 직후엔 DocumentCenter가 아직 마운트 전이라 이벤트가 유실될 수 있다 — 보류 이름을
 * 남겨 마운트 시 이어받는다. 실행 자체(인증정보 가드·상태 표시)는 기존 발급 경로를 그대로 탄다.
 */
export const ISSUE_DOC_EVENT = 'modoobom:issue-doc'

let _pending = ''

export function requestIssueDoc(doc: string): void {
  _pending = doc
  try { window.dispatchEvent(new CustomEvent(ISSUE_DOC_EVENT, { detail: doc })) } catch { /* SSR 등 무시 */ }
}

export function takePendingIssue(): string {
  const p = _pending
  _pending = ''
  return p
}

// "서류 전부 발급해줘" — 원클릭 연쇄(부족분만·한 번 인증) 전체 시작 채널(단건과 동일한 보류+이벤트 설계)
export const ISSUE_ALL_EVENT = 'modoobom:issue-all'

let _pendingAll = false

export function requestIssueAll(): void {
  _pendingAll = true
  try { window.dispatchEvent(new Event(ISSUE_ALL_EVENT)) } catch { /* SSR 등 무시 */ }
}

export function takePendingIssueAll(): boolean {
  const p = _pendingAll
  _pendingAll = false
  return p
}
