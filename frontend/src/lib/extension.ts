/** 모두봄 크롬 확장(복지 에이전트) 감지 + 호출 브릿지.
 *
 * 확장이 설치돼 있으면, 배포된 웹(백엔드 없이)에서도 정부24 서류 자동발급을
 * '사용자 브라우저 안에서' 실행할 수 있다. 개인정보(userInfo)는 확장으로만 전달되고
 * 서버로는 가지 않는다. 통신은 확장이 주입한 bridge.js 와 window.postMessage 로 한다
 * (확장 ID 를 몰라도 됨).
 */

export interface ExtStatus { jobId?: string; status: string; step: string; docName?: string }
export interface ExtStartResult { ok: boolean; error?: string }

interface ExtResponse { ok?: boolean; jobId?: string; error?: string; capabilities?: { rpa?: boolean }; docs?: string[]; services?: string[] }

/** 서류/서비스명 퍼지 비교 — 확장이 이름을 정규화(resolveDoc)해 status를 보내므로
 *  '주민등록 등본' vs '주민등록등본' 같은 표기 차이로 진행상태가 유실되지 않게 한다. */
export function sameDocName(a?: string, b?: string): boolean {
  const na = (a || '').replace(/\s/g, '')
  const nb = (b || '').replace(/\s/g, '')
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

let cachedPresent: boolean | null = null

function request(type: string, payload?: unknown, timeout = 1500): Promise<ExtResponse | null> {
  return new Promise((resolve) => {
    const reqId = Math.random().toString(36).slice(2)
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (d && d.source === 'modoo-ext' && d.kind === 'response' && d.reqId === reqId) {
        window.removeEventListener('message', onMsg)
        resolve(d.resp)
      }
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ source: 'modoo-web', type, payload, reqId }, '*')
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null) }, timeout)
  })
}

/** 확장 설치 여부(캐시). PING 응답으로 확인. */
export async function detectExtension(): Promise<boolean> {
  if (cachedPresent !== null) return cachedPresent
  const resp = await request('PING', null, 1200)
  cachedPresent = !!(resp && resp.ok && resp.capabilities && resp.capabilities.rpa)
  return cachedPresent
}

/** 확장이 지원하는 서류 목록(미설치면 빈 배열). */
export async function extensionDocs(): Promise<string[]> {
  const resp = await request('PING', null, 1200)
  return resp && resp.ok && Array.isArray(resp.docs) ? resp.docs : []
}

/** 진행상태 구독. 해제 함수 반환. */
export function onExtensionStatus(cb: (s: ExtStatus) => void): () => void {
  const handler = (e: MessageEvent) => {
    const d = e.data
    if (d && d.source === 'modoo-ext' && d.kind === 'status') cb(d.payload as ExtStatus)
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}

/** 확장으로 서류 발급 시작(진행상태는 onExtensionStatus 로 수신).
 *  탭 생성이 느릴 수 있어 타임아웃을 넉넉히 두고, 실패 시 확장의 실제 오류 메시지를 전달한다. */
export async function issueViaExtension(docName: string, userInfo: Record<string, unknown>): Promise<ExtStartResult> {
  const resp = await request('ISSUE', { docName, userInfo }, 10000)
  if (!resp) return { ok: false, error: '확장 응답이 늦어요 — 새 탭이 열렸다면 그 탭에서 계속 진행돼요.' }
  return { ok: !!resp.ok, error: resp.error }
}

/** 확장이 자동신청 지원하는 복지 서비스 목록(미설치면 빈 배열). */
export async function extensionServices(): Promise<string[]> {
  const resp = await request('PING', null, 1200)
  return resp && resp.ok && Array.isArray(resp.services) ? resp.services : []
}

/** 확장으로 복지 서비스 자동신청 시작. applyUrl(실제 복지로 딥링크)이 있으면 그 서비스로 이동. */
export async function applyViaExtension(serviceName: string, userInfo: Record<string, unknown>, applyUrl?: string): Promise<ExtStartResult> {
  const resp = await request('APPLY', { serviceName, userInfo, applyUrl }, 10000)
  if (!resp) return { ok: false, error: '확장 응답이 늦어요 — 새 탭이 열렸다면 그 탭에서 계속 진행돼요.' }
  return { ok: !!resp.ok, error: resp.error }
}
