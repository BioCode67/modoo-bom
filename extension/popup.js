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

// 진단 복사 — 자동화가 밟은 단계 기록을 클립보드로(개발자에게 붙여넣기용, 개인정보 미포함)
document.getElementById('diag').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'TRACE_GET' }, async (resp) => {
    if (!resp || !resp.ok) return
    const lines = (resp.trace || []).map((e) => {
      const time = new Date(e.t).toTimeString().slice(0, 8)
      return `${time} [${e.tag}] ${e.url ? e.url.replace(/^https?:\/\//, '') + ' ' : ''}${JSON.stringify(e.data)}`
    })
    const text = `모두봄 확장 진단 v${resp.version} (${lines.length}건)\n` + lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      document.getElementById('diag').textContent = '✅ 복사됨! 개발자(클로드)에게 붙여넣어 주세요'
    } catch {
      document.getElementById('diag').textContent = '복사 실패 — 다시 눌러 주세요'
    }
  })
})
