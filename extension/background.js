// 모두봄 복지 에이전트 — 백그라운드 서비스워커.
// 웹앱(브릿지) 요청을 받아 정부24 서류 발급을 사용자 브라우저 탭에서 자동화한다.
// 개인정보(userInfo)는 메모리/탭 안에서만 쓰고 서버로 보내지 않는다.

const DOCS = {
  '주민등록등본': { capp: '13100000015' },
  '주민등록초본': { capp: '13100000015' },
  '가족관계증명서': { capp: '14100000017' },
  '장애인증명서': { capp: '11100000006' },
}
const LOGIN_URL = 'https://plus.gov.kr/login'
const issueUrl = (capp) =>
  `https://www.gov.kr/mw/AA040OfferMainFrm.do?capp_biz_cd=${capp}&HighCtgCD=A01010001&FAX_TYPE=N&img=02&selectedSeq=01`

// 현재 진행 중인 잡(단일). { id, docName, userInfo, tabId, webTabId, phase, status, step }
let job = null

function pushStatus(status, step) {
  if (!job) return
  job.status = status
  job.step = step
  chrome.storage.local.set({ lastStatus: { status, step, docName: job.docName, at: Date.now() } })
  if (job.webTabId != null) {
    chrome.tabs.sendMessage(job.webTabId, { type: 'STATUS', payload: { jobId: job.id, status, step, docName: job.docName } }).catch(() => {})
  }
}

async function startJob(docName, userInfo, webTabId) {
  if (!DOCS[docName]) return { ok: false, error: `지원하지 않는 서류: ${docName}` }
  const tab = await chrome.tabs.create({ url: LOGIN_URL, active: true })
  job = {
    id: 'job_' + Math.random().toString(36).slice(2, 9),
    docName, userInfo: userInfo || {}, tabId: tab.id, webTabId,
    phase: 'login', status: 'running', step: '정부24 로그인 페이지 여는 중…',
  }
  pushStatus('running', '정부24 로그인 페이지 여는 중… 화면에서 간편인증을 진행해 주세요.')
  return { ok: true, jobId: job.id }
}

// 웹앱 브릿지(및 팝업)에서 오는 메시지
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    if (!msg || !msg.type) return sendResponse({ ok: false })
    if (msg.type === 'PING') {
      return sendResponse({ ok: true, name: '모두봄 복지 에이전트', version: '0.1.0',
        capabilities: { rpa: true, kind: 'extension' }, docs: Object.keys(DOCS) })
    }
    if (msg.type === 'ISSUE') {
      const { docName, userInfo } = msg.payload || {}
      const webTabId = sender.tab ? sender.tab.id : null
      return sendResponse(await startJob(docName, userInfo, webTabId))
    }
    if (msg.type === 'STATUS_GET') {
      return sendResponse({ ok: true, job: job && { id: job.id, docName: job.docName, status: job.status, step: job.step } })
    }
    if (msg.type === 'CANCEL') {
      if (job) { try { await chrome.tabs.remove(job.tabId) } catch {} job = null }
      return sendResponse({ ok: true })
    }
    // 주입된 자동화 스크립트에서 오는 메시지
    if (msg.type === 'GET_JOB') {
      const inJobTab = sender.tab && job && sender.tab.id === job.tabId
      return sendResponse(inJobTab ? { docName: job.docName, userInfo: job.userInfo, capp: DOCS[job.docName].capp, issueUrl: issueUrl(DOCS[job.docName].capp) } : null)
    }
    if (msg.type === 'AGENT_STATUS') {
      if (job && sender.tab && sender.tab.id === job.tabId) pushStatus(msg.payload.status, msg.payload.step)
      return sendResponse({ ok: true })
    }
    if (msg.type === 'GOTO') {
      if (job && sender.tab && sender.tab.id === job.tabId) { chrome.tabs.update(job.tabId, { url: msg.payload.url }) }
      return sendResponse({ ok: true })
    }
    if (msg.type === 'REINJECT') {
      // 간편인증 클릭 뒤 늦게 뜨는 인증 iframe에도 자동화를 주입
      if (job && sender.tab && sender.tab.id === job.tabId) {
        chrome.scripting.executeScript({ target: { tabId: job.tabId, allFrames: true }, files: ['automation.js'] }).catch(() => {})
      }
      return sendResponse({ ok: true })
    }
    sendResponse({ ok: false })
  })()
  return true // async
})

// 잡 탭이 로드 완료될 때마다 자동화 주입(로그인→발급 페이지 전환 자동 대응)
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!job || tabId !== job.tabId || info.status !== 'complete') return
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['automation.js'] }).catch(() => {})
})

chrome.tabs.onRemoved.addListener((tabId) => { if (job && tabId === job.tabId) job = null })
