// 팝업 — 현재 발급 진행 상태 표시(1.5초 폴링)
const docEl = document.getElementById('doc')
const stepEl = document.getElementById('step')

function render(job) {
  if (job) {
    docEl.textContent = `${job.docName} · ${job.status}`
    stepEl.textContent = job.step || '진행 중…'
  } else {
    docEl.textContent = '대기 중'
  }
}

function poll() {
  chrome.runtime.sendMessage({ type: 'STATUS_GET' }, (resp) => {
    if (resp && resp.ok) render(resp.job)
  })
}
poll()
setInterval(poll, 1500)
