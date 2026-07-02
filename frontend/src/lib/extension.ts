/** 모두봄 크롬 확장(복지 에이전트) 감지 + 호출 브릿지.
 *
 * 확장이 설치돼 있으면, 배포된 웹(백엔드 없이)에서도 정부24 서류 자동발급을
 * '사용자 브라우저 안에서' 실행할 수 있다. 개인정보(userInfo)는 확장으로만 전달되고
 * 서버로는 가지 않는다. 통신은 확장이 주입한 bridge.js 와 window.postMessage 로 한다
 * (확장 ID 를 몰라도 됨).
 */

export interface ExtStatus { jobId?: string; status: string; step: string; docName?: string }

interface ExtResponse { ok?: boolean; jobId?: string; capabilities?: { rpa?: boolean }; docs?: string[] }

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

/** 확장으로 서류 발급 시작. 성공 시 true(진행상태는 onExtensionStatus 로 수신). */
export async function issueViaExtension(docName: string, userInfo: Record<string, unknown>): Promise<boolean> {
  const resp = await request('ISSUE', { docName, userInfo }, 3000)
  return !!(resp && resp.ok)
}
