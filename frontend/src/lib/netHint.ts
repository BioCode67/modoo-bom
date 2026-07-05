/**
 * 네트워크/기기 힌트 — 데이터 절약·저사양 환경을 감지해 무거운 다운로드(임베딩·모델)를 건너뛴다.
 * 모바일 데이터·2G·저메모리 기기에서 3.9MB 임베딩을 자동으로 받지 않게 해 체감속도·데이터를 아낀다.
 * (규칙기반 결과는 이미 계산돼 있으므로 스킵해도 기능은 정상 — 정직 폴백.)
 */
export function prefersDataSaving(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
    deviceMemory?: number
  }
  const c = nav.connection
  if (c?.saveData) return true
  if (c?.effectiveType && /(slow-2g|2g)/.test(c.effectiveType)) return true
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 1) return true
  return false
}
