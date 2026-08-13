// 데모 잠시 비공개(2026-08-13) — 기존 PWA 캐시·등록을 정리하는 킬스위치 서비스워커.
// 이전 방문자의 브라우저가 업데이트 확인으로 이 파일을 받으면, 캐시를 비우고 스스로 등록 해제한 뒤
// 열려 있는 탭을 새로고침해 안내 페이지가 보이게 한다. 재공개 배포가 다시 정상 sw.js 로 덮어쓴다.
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys()
      await Promise.all(keys.map(function (k) { return caches.delete(k) }))
    } catch (e) { /* 캐시 정리 실패는 치명적 아님 */ }
    try { await self.registration.unregister() } catch (e) { /* noop */ }
    try {
      var cs = await self.clients.matchAll({ type: 'window' })
      cs.forEach(function (c) { try { c.navigate(c.url) } catch (e) { /* noop */ } })
    } catch (e) { /* noop */ }
  })())
})
