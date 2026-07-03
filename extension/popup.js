// 팝업 — 현재 발급 진행 상태 표시(1.5초 폴링)
const docEl = document.getElementById('doc')
const stepEl = document.getElementById('step')

function render(job) {
  const cancelEl = document.getElementById('cancel')
  if (job) {
    docEl.textContent = `${job.docName} · ${job.status}`
    stepEl.textContent = job.step || '진행 중…'
    cancelEl.style.display = job.status === 'done' ? 'none' : 'block'
  } else {
    docEl.textContent = '대기 중'
    cancelEl.style.display = 'none'
  }
}

function poll() {
  chrome.runtime.sendMessage({ type: 'STATUS_GET' }, (resp) => {
    if (resp && resp.ok) render(resp.job)
  })
}
poll()
setInterval(poll, 1500)

// 작업 취소 — 멈춘 잡을 정리하고 탭 닫기(재시작은 사이트에서 다시 발급 클릭)
document.getElementById('cancel').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CANCEL' }, () => {
    document.getElementById('cancel').style.display = 'none'
    docEl.textContent = '대기 중'
    stepEl.textContent = '작업을 취소했어요. 사이트에서 다시 시작할 수 있어요.'
  })
})

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
