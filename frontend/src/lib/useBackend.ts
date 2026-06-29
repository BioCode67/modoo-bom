import { useEffect, useState } from 'react'
import { checkBackend } from './backend'

/** 백엔드(FastAPI) 가용성 — RPA 자동화 기능 게이팅용. null=확인 중 */
export function useBackend(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    checkBackend().then((v) => alive && setOk(v))
    return () => { alive = false }
  }, [])
  return ok
}
