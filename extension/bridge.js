// 모두봄 웹앱 ↔ 확장 브릿지 (웹앱 오리진에서만 실행).
// 웹 페이지는 확장 ID를 몰라도 window.postMessage 로 확장과 통신할 수 있다.
//   페이지 → 확장: postMessage({ source: 'modoo-web', ... })
//   확장 → 페이지: postMessage({ source: 'modoo-ext', ... })
// 개인정보(userInfo)는 이 메시지로 확장에 전달되지만 서버로는 가지 않는다(브라우저 내부에서만).

(() => {
  // 페이지가 확장 존재를 감지할 수 있도록 표식 주입
  const mark = document.createElement('meta')
  mark.name = 'modoo-agent'
  mark.content = '0.1.0'
  document.documentElement.appendChild(mark)

  // 페이지 → 확장
  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    const msg = e.data
    if (!msg || msg.source !== 'modoo-web') return
    try {
      chrome.runtime.sendMessage({ type: msg.type, payload: msg.payload, reqId: msg.reqId }, (resp) => {
        // 응답을 페이지로 되돌림
        window.postMessage({ source: 'modoo-ext', kind: 'response', reqId: msg.reqId, resp }, '*')
      })
    } catch (err) {
      window.postMessage({ source: 'modoo-ext', kind: 'response', reqId: msg.reqId, resp: { ok: false, error: String(err) } }, '*')
    }
  })

  // 확장(백그라운드) → 페이지 (진행상태 푸시)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'STATUS') {
      window.postMessage({ source: 'modoo-ext', kind: 'status', payload: msg.payload }, '*')
    }
  })
})()
