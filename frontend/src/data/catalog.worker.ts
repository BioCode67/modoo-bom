/// <reference lib="webworker" />
/**
 * 외부 카탈로그(policies.json, ~3.3MB) fetch + JSON.parse 를 워커 스레드에서 수행.
 * 메인 스레드의 수백 ms 파싱 블록(TBT)을 제거한다. SW 런타임 캐시는 워커 fetch에도 적용된다.
 */
self.onmessage = async (e: MessageEvent<{ url: string }>) => {
  try {
    const res = await fetch(e.data.url, { cache: 'no-cache' })
    if (!res.ok) { self.postMessage({ ok: false }); return }
    const data = await res.json() // 파싱이 여기(워커)에서 일어난다
    self.postMessage({ ok: true, data })
  } catch {
    self.postMessage({ ok: false })
  }
}
