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
// 발급은 '공개 안내페이지(AA020)'로 이동 후 그 안의 발급하기(applyConfirm)를 누른다.
// (AA020은 로그인 없이도 열려 크로스도메인 튕김이 없고, 발급은 사이트 자체 함수로 세션 유지)
const issueUrl = (capp) =>
  `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${capp}&HighCtgCD=A01010001&tp_seq=01&Mcode=10200`

// 복지로 신청 — Clipsoft eForm SPA. 로그인 후 서비스별 딥링크(wlfareInfoId)로 이동해 신청.
const BOKJIRO_LOGIN_URL = 'https://www.bokjiro.go.kr/ssis-tbu/loginView.do'
// wlfareInfoId는 라이브 복지로 실측 검증(페이지 wlfareInfoNm 대조, 2026-07). 구 ID들은 타 서비스로 재배정됨.
const SERVICE_URLS = {
  '기초연금': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001164',
  '아동수당': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001171',
  '부모급여': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004657',
  '청년 내일저축계좌': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000060',
  '첫만남이용권': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004656',
  '기초생활 생계급여': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001132',
}

// 현재 진행 중인 잡(단일). { id, docName, userInfo, tabId, webTabId, phase, status, step }
let job = null

// MV3 서비스워커는 유휴 시 종료→재시작되어 메모리의 job이 사라진다(로그인 중 흔함).
// job을 storage에 저장하고, 핸들러 진입 시 복원해 '대기 중'으로 멈추는 문제를 막는다.
function saveJob() { try { return chrome.storage.local.set({ job }) } catch { /* noop */ } }
async function ensureJob() {
  if (job) return
  try { const s = await chrome.storage.local.get('job'); if (s && s.job) job = s.job } catch { /* noop */ }
}
function clearJob() { job = null; try { chrome.storage.local.remove('job') } catch { /* noop */ } try { chrome.alarms.clear('advanceQueue') } catch { /* noop */ } }

// ── 진단 추적(trace): 자동화의 매 단계를 기록 → 팝업 '진단 복사'로 개발자에게 전달 ──
// (개인정보는 기록하지 않음 — 단계명/URL 경로/버튼 후보 요약만)
async function addTrace(entry) {
  try {
    const s = await chrome.storage.local.get('trace')
    const arr = (s && s.trace) || []
    arr.push(entry)
    while (arr.length > 300) arr.shift()
    await chrome.storage.local.set({ trace: arr })
  } catch { /* noop */ }
}

function pushStatus(status, step, noAdvance) {
  if (!job) return
  job.status = status
  job.step = step
  addTrace({ t: Date.now(), tag: 'status', data: { status, step } })
  saveJob()
  chrome.storage.local.set({ lastStatus: { status, step, docName: job.docName, at: Date.now() } })
  if (job.webTabId != null) {
    chrome.tabs.sendMessage(job.webTabId, { type: 'STATUS', payload: { jobId: job.id, status, step, docName: job.docName } }).catch(() => {})
  }
  // 연쇄 발급 큐: 이 서류가 끝나면(로그인 세션 유지 상태) 다음 서류로 같은 탭 이동.
  // noAdvance=true(PDF 저장 완료 등 후행 이벤트)는 큐를 넘기지 않음 — 이중 advance 경합 방지.
  // done이 여러 번 올 수 있어 advancing 플래그로 1회만 예약.
  // 빠른 경로는 setTimeout(4s) — SW는 방금 활동으로 ~30s 살아있어 대부분 여기서 진행.
  // 안전망으로 chrome.alarms(50s) — 그 사이 SW가 죽어도 알람이 살아남아 큐를 복구(30s 최소 클램프 회피).
  if (!noAdvance && status === 'done' && job.kind === 'doc' && job.queue && job.queue.length && !job.advancing) {
    job.advancing = true
    saveJob()
    setTimeout(() => { advanceQueue().catch(() => {}) }, 4000)
    try { chrome.alarms.create('advanceQueue', { when: Date.now() + 50000 }) } catch { /* noop */ }
  }
}

// 큐의 다음 서류로 진행 — 정부24는 로그인 유지라 안내페이지(AA020)로 바로,
// 타 사이트(건보 등)는 해당 로그인 페이지로(재인증 필요하지만 이동·입력은 자동).
// ⚠️ job.advancing은 네비게이션이 실제로 시작될 때까지 true로 유지 — 이전 페이지에서
//    'done'이 한 번 더 날아와도(접수→PDF저장) 큐를 두 번 건너뛰지 않게 한다.
async function advanceQueue() {
  await ensureJob()
  if (!job || !job.queue || !job.queue.length) { if (job) { job.advancing = false; saveJob() } return }
  // 유효한 다음 서류를 찾을 때까지 큐에서 꺼냄(미지원 서류는 건너뜀)
  let next = null, info = null
  while (job.queue.length) { next = job.queue.shift(); info = DOCS[next]; if (info) break; next = null }
  if (!next || !info) { job.advancing = false; saveJob(); return }
  job.docName = next
  job.site = info.site
  job.phase = 'issue'
  saveJob()
  const target = info.site === 'gov24'
    ? (info.issue || issueUrl(info.capp))
    : LOGIN_URLS[info.site]
  pushStatus('running', `이어서 '${next}' 발급을 진행해요… (남은 서류 ${job.queue.length}개)`)
  try {
    await chrome.tabs.update(job.tabId, { url: target, active: true })
    job.advancing = false; saveJob()
    try { await chrome.alarms.clear('advanceQueue') } catch { /* noop */ } // 안전망 알람 해제(이중 advance 방지)
  } catch { clearJob() }
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

// ── 발급 문서 자동 저장(문서출력 팝업 → PDF) ─────────────────────────────────
// 문서출력이 새 창/탭으로 열리면 그 탭을 debugger로 printToPDF 해서 다운로드한다.
let pendingSave = null // { filename, until }

async function savePdf(tabId, filename) {
  const target = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    const res = await chrome.debugger.sendCommand(target, 'Page.printToPDF', { printBackground: true })
    try { await chrome.debugger.detach(target) } catch { /* noop */ }
    await chrome.downloads.download({ url: 'data:application/pdf;base64,' + res.data, filename, saveAs: false })
    // ⚠️ noAdvance: PDF 저장 완료의 'done'이 큐를 또 넘기지 않게(이전 문서 저장이 늦게 끝나
    //    다음 문서를 건너뛰는 경합 방지). 실제 큐 진행은 자동화의 'done'만 담당.
    pushStatus('done', '📄 발급 문서를 PDF로 저장했어요! (다운로드 폴더 확인)', true)
    return true
  } catch (e) {
    try { await chrome.debugger.detach(target) } catch { /* noop */ }
    pushStatus('done', "문서가 열렸어요. Ctrl+P → 'PDF로 저장'으로 저장하세요.", true)
    return false
  }
}

// 정부 사이트 버튼 다수는 프로그램적 .click()(isTrusted=false)을 무시한다.
// chrome.debugger의 Input.dispatchMouseEvent로 '진짜 사람 클릭'과 동일한 이벤트를 만든다.
// 좌표는 최상위 프레임 뷰포트 기준(CSS 픽셀). content script가 버튼 중심 좌표를 넘겨준다.
// ⚠️ attach하면 상단 '디버깅 중' 안내바가 생겨 페이지가 아래로 밀림 → 좌표는 attach 후 재계산해야 함.
// 그래서 2단계: TRUSTED_PREP(attach만) → content가 좌표 재계산 → TRUSTED_CLICK(dispatch+detach).
// ⚠️ '이미 attach됨' 오류는 '내가 붙임'과 'DevTools가 붙음' 둘 다에서 같은 문자열이 나온다.
//    → 문자열 파싱 대신 '내가 붙인 탭' 집합(selfAttached)으로 구분해야 F12 감지가 동작.
const selfAttached = new Set()
try { chrome.debugger.onDetach.addListener((src) => { if (src && src.tabId != null) selfAttached.delete(src.tabId) }) } catch { /* noop */ }
async function trustedAttach(tabId) {
  if (selfAttached.has(tabId)) return { ok: true } // 내가 이미 붙여둠
  try { await chrome.debugger.attach({ tabId }, '1.3'); selfAttached.add(tabId); return { ok: true } }
  catch (e) {
    const err = String((e && e.message) || e)
    // 내가 붙인 게 아닌데 '이미 붙어있음' → DevTools(F12)가 점유 중 → 진짜 클릭 불가
    return { ok: false, err }
  }
}
async function trustedDetach(tabId) {
  try { await chrome.debugger.detach({ tabId }) } catch { /* noop */ }
  selfAttached.delete(tabId)
}
async function trustedClick(tabId, x, y) {
  const target = { tabId }
  try {
    const at = await trustedAttach(tabId)
    if (!at.ok) return false
    const base = { x, y, button: 'left', clickCount: 1 }
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base))
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base))
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base))
    await trustedDetach(tabId)
    return true
  } catch (e) {
    await trustedDetach(tabId)
    return false
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  if (!pendingSave || Date.now() > pendingSave.until) { pendingSave = null; return }
  const filename = pendingSave.filename
  pendingSave = null
  const onUpd = (tid, info) => {
    if (tid === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(onUpd)
      setTimeout(() => savePdf(tab.id, filename), 1500)
    }
  }
  chrome.tabs.onUpdated.addListener(onUpd)
})

// 연쇄 발급 진행 알람 — setTimeout과 달리 서비스워커가 재시작돼도 살아남아 큐가 멈추지 않는다.
try {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'advanceQueue') return
    await ensureJob()
    // 안전망: advancing이 아직 true면 빠른 경로(setTimeout)가 못 돈 것(SW 사망) → 복구.
    // 이미 진행됐으면 advancing=false라 아무것도 안 함(이중 advance 방지).
    if (job && job.advancing) advanceQueue().catch(() => {})
  })
} catch { /* alarms 권한 없으면 setTimeout 폴백 사용 */ }

async function closePrevJobTab() {
  // 이전 잡 탭이 남아 있으면 닫아 오래된(멈춘) 탭 혼란 방지
  if (job && job.tabId != null) { try { await chrome.tabs.remove(job.tabId) } catch { /* noop */ } }
}

async function startJob(rawName, userInfo, webTabId) {
  const docName = resolveDoc(rawName)
  if (!docName) return { ok: false, error: `지원하지 않는 서류: ${rawName}` }
  await closePrevJobTab()
  try { await chrome.alarms.clear('advanceQueue') } catch { /* noop */ } // 이전 체인의 알람 제거
  try { await chrome.storage.local.remove('trace') } catch { /* noop */ } // 새 발급마다 진단 새로 시작
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
  await closePrevJobTab()
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
    await ensureJob() // 서비스워커 재시작으로 사라진 job 복원
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
    if (msg.type === 'ISSUE_MANY') {
      // 연쇄 발급: 여러 서류를 한 번의 흐름으로. 정부24 서류를 앞으로 정렬(한 번 로그인으로 연쇄).
      const { docNames, userInfo } = msg.payload || {}
      const resolved = [...new Set((docNames || []).map(resolveDoc).filter(Boolean))]
      if (!resolved.length) return sendResponse({ ok: false, error: '자동발급을 지원하는 서류가 없어요' })
      resolved.sort((a, b) => (DOCS[a].site === 'gov24' ? 0 : 1) - (DOCS[b].site === 'gov24' ? 0 : 1))
      const [first, ...rest] = resolved
      const res = await startJob(first, userInfo, sender.tab ? sender.tab.id : null)
      if (res.ok && rest.length) { job.queue = rest; job.total = resolved.length; saveJob() }
      return sendResponse({ ...res, count: resolved.length, docs: resolved })
    }
    if (msg.type === 'APPLY') {
      const { serviceName, userInfo, applyUrl } = msg.payload || {}
      const webTabId = sender.tab ? sender.tab.id : null
      return sendResponse(await startApply(serviceName, userInfo, webTabId, applyUrl))
    }
    if (msg.type === 'STATUS_GET') {
      return sendResponse({ ok: true, job: job && { id: job.id, docName: job.docName, status: job.status, step: job.step } })
    }
    if (msg.type === 'TRACE') {
      await addTrace({ t: Date.now(), tag: msg.payload.tag, url: msg.payload.url, data: msg.payload.data })
      return sendResponse({ ok: true })
    }
    if (msg.type === 'TRACE_GET') {
      const s = await chrome.storage.local.get('trace')
      return sendResponse({ ok: true, trace: (s && s.trace) || [], version: chrome.runtime.getManifest().version })
    }
    if (msg.type === 'TRACE_CLEAR') {
      await chrome.storage.local.remove('trace')
      return sendResponse({ ok: true })
    }
    if (msg.type === 'CANCEL') {
      // ⚠️ clearJob()으로 storage까지 지워야 함 — job=null만 하면 SW 재시작 시 좀비 잡 부활
      if (job) { try { await chrome.tabs.remove(job.tabId) } catch { /* noop */ } clearJob() }
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
    if (msg.type === 'SAVE_ON_POPUP') {
      // 다음에 열리는 문서출력 팝업을 PDF로 저장 예약(15초 유효)
      const fn = (msg.payload && msg.payload.filename) || 'gov-document.pdf'
      pendingSave = { filename: fn, until: Date.now() + 15000 }
      return sendResponse({ ok: true })
    }
    if (msg.type === 'TRUSTED_PREP') {
      // 1단계: debugger만 먼저 attach(안내바로 뷰포트가 밀린 뒤 content가 좌표 재계산)
      if (job && sender.tab && sender.tab.id === job.tabId && (sender.frameId === 0 || sender.frameId == null)) {
        return sendResponse(await trustedAttach(job.tabId))
      }
      return sendResponse({ ok: false })
    }
    if (msg.type === 'TRUSTED_CLICK') {
      // 2단계: content script가 attach 후 재계산한 버튼 중심 좌표에 '진짜 클릭'을 쏜다(최상위 프레임만).
      if (job && sender.tab && sender.tab.id === job.tabId && (sender.frameId === 0 || sender.frameId == null)) {
        const ok = await trustedClick(job.tabId, msg.payload.x, msg.payload.y)
        return sendResponse({ ok })
      }
      return sendResponse({ ok: false })
    }
    if (msg.type === 'TRUSTED_ABORT') {
      // PREP는 했으나 클릭을 못 쏜 경우(버튼 rect 0 등) → attach 해제해 '디버깅 중' 바 제거
      if (job && sender.tab && sender.tab.id === job.tabId) await trustedDetach(job.tabId)
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
// ⚠️ 서비스워커 재시작으로 job이 비어있을 수 있으니 먼저 복원한 뒤 판단
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return
  await ensureJob()
  if (!job || tabId !== job.tabId) return
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['automation.js'] }).catch(() => {})
  // ('인증 완료' 등 정보성 alert 자동 통과는 manifest의 alert-suppress.js(MAIN, document_start)가 담당)
})

chrome.tabs.onRemoved.addListener(async (tabId) => { await ensureJob(); if (job && tabId === job.tabId) clearJob() })
