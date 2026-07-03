// 모두봄 복지 에이전트 — 백그라운드 서비스워커.
// 웹앱(브릿지) 요청을 받아 정부24 서류 발급을 사용자 브라우저 탭에서 자동화한다.
// 개인정보(userInfo)는 메모리/탭 안에서만 쓰고 서버로 보내지 않는다.

const DOCS = {
  '주민등록등본': { site: 'gov24', capp: '13100000015' },
  '주민등록초본': { site: 'gov24', capp: '13100000015' },
  '가족관계증명서': { site: 'gov24', capp: '97400000004' },
  '장애인증명서': { site: 'gov24', capp: '14600000273' },
  // 소득금액증명(국세) — 소득심사형 복지에 필수. 발급이 홈택스로 연계될 수 있어 안내페이지로 연결.
  '소득금액증명': { site: 'gov24', capp: '12100000021', issue: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000021&HighCtgCD=A09002&Mcode=10200' },
  // 행안부 지방세 증명 — 정부24 직접 발급
  '지방세 납세증명서': { site: 'gov24', capp: '13100000056' },
  '지방세 세목별 과세증명서': { site: 'gov24', capp: '13100000084' },
  // 복지부 — 복지 신청 핵심 증명(정부24 발급)
  '기초생활수급자 증명서': { site: 'gov24', capp: '14600000280' },
  '한부모가족 증명서': { site: 'gov24', capp: '10601000001' },
  '국민연금 가입자 증명서': { site: 'gov24', capp: '14600000312' },
  '건강보험 자격득실확인서': { site: 'nhis' },
  '고용보험 피보험자격 이력내역서': { site: 'work24' },
  // 국민연금공단 직접(전자민원) — 연금산정용 가입내역 등 상세 증명
  '국민연금 가입내역확인서': { site: 'nps' },
}
const LOGIN_URLS = {
  gov24: 'https://plus.gov.kr/login',
  nhis: 'https://www.nhis.or.kr/nhis/etc/personalLoginPage.do',
  work24: 'https://www.work24.go.kr/cm/z/b/0210/openLginPageForAnyIdIntro.do',
  // 국민연금 전자민원 가입자 가입증명 페이지(미로그인 시 로그인 유도)
  nps: 'https://www.nps.or.kr/elctcvlcpt/comm/getOHAC0000M5.do?menuId=MN24001054',
}
const NHIS_CERT_URL = 'https://www.nhis.or.kr/nhis/minwon/jpAea00401.do'
const issueUrl = (capp) =>
  `https://www.gov.kr/mw/AA040OfferMainFrm.do?capp_biz_cd=${capp}&HighCtgCD=A01010001&FAX_TYPE=N&img=02&selectedSeq=01`

// 복지로 신청 — Clipsoft eForm SPA. 로그인 후 서비스별 딥링크(wlfareInfoId)로 이동해 신청.
const BOKJIRO_LOGIN_URL = 'https://www.bokjiro.go.kr/ssis-tbu/loginView.do'
const SERVICE_URLS = {
  '기초연금': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002501',
  '아동수당': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002948',
  '부모급여': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00010441',
  '청년 내일저축계좌': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00003748',
  '첫만남이용권': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00009878',
  '기초생활 생계급여': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000049',
}

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

// 서류명 표기 변형(예: '소득금액증명원'/'주민등록 등본') 흡수 — 공백 제거 후 부분일치
function resolveDoc(name) {
  if (DOCS[name]) return name
  const n = (name || '').replace(/\s/g, '')
  for (const k of Object.keys(DOCS)) {
    const kk = k.replace(/\s/g, '')
    if (n && (n.includes(kk) || kk.includes(n))) return k
  }
  return null
}

async function startJob(rawName, userInfo, webTabId) {
  const docName = resolveDoc(rawName)
  if (!docName) return { ok: false, error: `지원하지 않는 서류: ${rawName}` }
  const site = DOCS[docName].site
  const siteName = { gov24: '정부24', nhis: '건강보험공단', work24: '고용24', nps: '국민연금공단' }[site]
  const tab = await chrome.tabs.create({ url: LOGIN_URLS[site], active: true })
  job = {
    id: 'job_' + Math.random().toString(36).slice(2, 9),
    kind: 'doc', docName, site, userInfo: userInfo || {}, tabId: tab.id, webTabId,
    phase: 'login', status: 'running', step: `${siteName} 로그인 페이지 여는 중…`,
  }
  pushStatus('running', `${siteName} 로그인 페이지 여는 중… 화면에서 간편인증을 진행해 주세요.`)
  return { ok: true, jobId: job.id }
}

const KOSAF_LOGIN_URL = 'https://www.kosaf.go.kr/ko/login.do'
const isBokjiroUrl = (u) => typeof u === 'string' && /^https:\/\/www\.bokjiro\.go\.kr\//.test(u)
const isKosafUrl = (u) => typeof u === 'string' && /kosaf\.go\.kr/.test(u)

async function startApply(serviceName, userInfo, webTabId, applyUrl) {
  // 신청 URL로 사이트 라우팅: 복지로(wlfareInfoId 딥링크) 또는 한국장학재단(장학금).
  // 복지로는 카탈로그 전 정책 일반화, 없으면 내장 6종 폴백.
  let loginUrl, applySite, serviceUrl
  if (isKosafUrl(applyUrl)) { loginUrl = KOSAF_LOGIN_URL; applySite = 'kosaf'; serviceUrl = applyUrl }
  else if (isBokjiroUrl(applyUrl)) { loginUrl = BOKJIRO_LOGIN_URL; applySite = 'bokjiro'; serviceUrl = applyUrl }
  else if (SERVICE_URLS[serviceName]) { loginUrl = BOKJIRO_LOGIN_URL; applySite = 'bokjiro'; serviceUrl = SERVICE_URLS[serviceName] }
  else return { ok: false, error: `자동신청 미지원 서비스: ${serviceName}` }
  const label = applySite === 'kosaf' ? '한국장학재단' : '복지로'
  const tab = await chrome.tabs.create({ url: loginUrl, active: true })
  job = {
    id: 'job_' + Math.random().toString(36).slice(2, 9),
    kind: 'apply', applySite, serviceName, serviceUrl,
    docName: serviceName, userInfo: userInfo || {}, tabId: tab.id, webTabId,
    phase: 'login', status: 'running', step: `${label} 로그인 페이지 여는 중…`,
  }
  pushStatus('running', `${label} 로그인 페이지 여는 중… 화면에서 간편인증을 진행해 주세요.`)
  return { ok: true, jobId: job.id }
}

// 웹앱 브릿지(및 팝업)에서 오는 메시지
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    if (!msg || !msg.type) return sendResponse({ ok: false })
    if (msg.type === 'PING') {
      return sendResponse({ ok: true, name: '모두봄 복지 에이전트', version: '0.1.0',
        capabilities: { rpa: true, kind: 'extension' },
        docs: Object.keys(DOCS), services: Object.keys(SERVICE_URLS) })
    }
    if (msg.type === 'ISSUE') {
      const { docName, userInfo } = msg.payload || {}
      const webTabId = sender.tab ? sender.tab.id : null
      return sendResponse(await startJob(docName, userInfo, webTabId))
    }
    if (msg.type === 'APPLY') {
      const { serviceName, userInfo, applyUrl } = msg.payload || {}
      const webTabId = sender.tab ? sender.tab.id : null
      return sendResponse(await startApply(serviceName, userInfo, webTabId, applyUrl))
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
      if (!inJobTab) return sendResponse(null)
      if (job.kind === 'apply') {
        return sendResponse({ kind: 'apply', applySite: job.applySite, serviceName: job.serviceName, serviceUrl: job.serviceUrl, userInfo: job.userInfo })
      }
      const info = DOCS[job.docName]
      const iu = info.issue || (info.site === 'gov24' ? issueUrl(info.capp)
        : info.site === 'nhis' ? NHIS_CERT_URL
        : info.site === 'nps' ? LOGIN_URLS.nps : '')
      return sendResponse({ kind: 'doc', docName: job.docName, site: info.site, userInfo: job.userInfo, issueUrl: iu })
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
