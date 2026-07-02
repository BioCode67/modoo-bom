import { useEffect, useState } from 'react'
import { checkBackend, getCapabilities, type Capabilities } from './backend'

export interface BackendStatus {
  /** 백엔드 도달 가능 여부. null=확인 중(웨이크업 포함) */
  ready: boolean | null
  /** 서버 capabilities(ai/rpa). 도달 성공 시 채워짐 */
  caps: Capabilities | null
  /** 콜드스타트 웨이크업 진행상태(클라우드 슬립 깨우는 중) */
  waking: { n: number; max: number } | null
}

/** 백엔드(FastAPI) 상태 + capabilities 게이팅용 훅. */
export function useBackend(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>({ ready: null, caps: null, waking: null })
  useEffect(() => {
    let alive = true
    checkBackend((n, max) => alive && setStatus((s) => ({ ...s, waking: { n, max } })))
      .then((ok) => alive && setStatus({ ready: ok, caps: ok ? getCapabilities() : null, waking: null }))
    return () => { alive = false }
  }, [])
  return status
}
