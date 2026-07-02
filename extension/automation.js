// 모두봄 정부24 자동화 — 잡 탭의 모든 프레임에 주입되어 실행.
// gov24_rpa.py(Playwright)의 흐름을 content script로 포팅:
//   plus.gov.kr/login → 간편인증 → (iframe)카카오톡 선택+정보 자동입력 → 사용자 본인인증
//   → 로그인 후 발급폼(AA040) → 온라인발급/신청 → 초본·목적 선택 → 제출 → 출력
// 각 프레임 인스턴스는 자신의 URL/DOM으로 역할을 판별해 해당 단계만 수행한다.
(async () => {
  if (window.__modooAgentGuard) return
  window.__modooAgentGuard = true

  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, res) } catch { res(null) } })
  const job = await send({ type: 'GET_JOB' })
  if (!job) return

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const status = (s, step) => send({ type: 'AGENT_STATUS', payload: { status: s, step } })
  const host = location.hostname
  const url = location.href
  const isTop = window.top === window
  const norm = (t) => (t || '').replace(/\s/g, '')

  const clickText = (texts, exclude = []) => {
    const els = Array.from(document.querySelectorAll('a,button,li,span,div[role="button"],input[type="button"],input[type="submit"]'))
    for (const el of els) {
      const t = norm(el.textContent) + norm(el.value)
      if (texts.some((x) => t.includes(norm(x))) && !exclude.some((x) => t.includes(norm(x)))) {
        el.click(); return true
      }
    }
    return false
  }
  const clickSel = (sels) => {
    for (const s of sels) { const el = document.querySelector(s); if (el) { el.click(); return true } }
    return false
  }
  const fill = (sels, val) => {
    if (!val) return false
    for (const s of sels) {
      const el = document.querySelector(s)
      if (el) { el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true }
    }
    return false
  }

  const isAuthFrame = () =>
    !!document.querySelector('#oacx_name, #oacx_birth, [id^="oacx_"], [class*="oacx"]') ||
    /simpleCert|oacx|nice|mobileok|kakao|fincert|yeskey/i.test(url)

  // eForm(.cl-button 등) 컴포넌트에서 텍스트로 버튼 클릭 (복지로 Clipsoft eForm 대응)
  const clickEform = (texts) => {
    const els = Array.from(document.querySelectorAll('.cl-button, [class*="cl-button"], [role="button"], a, button, span, div'))
    for (const el of els) {
      const t = norm(el.textContent)
      if (texts.some((x) => t.includes(norm(x)))) { el.click(); return true }
    }
    return false
  }

  // ── 1) 로그인 최상위 프레임: 간편인증 클릭 ──
  if (host === 'plus.gov.kr' && /login/i.test(location.pathname) && isTop) {
    await sleep(1200)
    const clicked = clickSel([
      "button.login-type", "[data-tab='easy']", "[data-type='easy']",
    ]) || clickText(['간편인증', '간편 인증', '간편로그인'])
    status('running', clicked
      ? '간편인증을 선택했어요. 카카오톡을 고르고 본인인증을 진행해 주세요. 📱'
      : "화면에서 '간편인증' 탭을 눌러 주세요.")
    // 뒤늦게 뜨는 인증 iframe에도 자동화 주입 요청
    await sleep(2500); await send({ type: 'REINJECT' })
    return
  }

  // ── 2) 간편인증 iframe: 카카오톡 선택 + 정보 자동입력 ──
  if (isAuthFrame()) {
    await sleep(800)
    clickText(['카카오톡', 'TALK', '카카오'], ['카카오뱅크', 'BANK'])
    await sleep(600)
    const u = job.userInfo || {}
    const name = (u.user_name || u.name || '').trim()
    const birth = String(u.birth_date || '').replace(/[^0-9]/g, '')
    const phone = String(u.phone || '').replace(/[^0-9]/g, '')
    let filled = false
    filled = fill(['#oacx_name', 'input[name*="name"]'], name) || filled
    filled = fill(['#oacx_birth', 'input[name*="birth"]'], birth) || filled
    if (phone) {
      const tail = phone.startsWith('010') && phone.length >= 10 ? phone.slice(3) : phone
      filled = fill(['#oacx_phone2', '#oku_phone2', 'input.phone', 'input[name*="phone"]'], tail) || filled
    }
    // 전체동의
    const agree = document.querySelector('#totalAgree, input#totalAgree')
    if (agree && !agree.checked) { agree.click() }
    status(filled ? 'waiting' : 'waiting',
      filled
        ? "✅ 이름·생년월일·휴대폰을 자동 입력했어요. '인증 요청'을 누르고 📱 카카오톡 알림에서 [인증 허용]만 하세요."
        : "카카오톡 선택 후 본인인증 정보를 입력하고 '인증 요청'을 눌러 주세요. 📱")
    return
  }

  // ── 복지로(자동신청) 흐름 ──
  if (host === 'www.bokjiro.go.kr' && isTop && job.kind === 'apply') {
    await sleep(1500)
    if (/loginView/i.test(url)) {
      // 로그인 페이지: eForm 간편인증 클릭 → 인증 iframe에도 주입 요청
      const clicked = clickEform(['간편인증', '간편 인증', '간편로그인'])
      status('running', clicked
        ? '복지로 간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱'
        : "화면에서 '간편인증'을 눌러 주세요.")
      await sleep(2800); await send({ type: 'REINJECT' })
      return
    }
    if (/moveTWAT52011M/i.test(url)) {
      // 서비스 신청 페이지: 신청하기 클릭 + 기본 정보 자동 입력
      clickEform(['신청하기', '온라인신청', '모바일신청']) || clickText(['신청하기', '온라인신청'])
      await sleep(1500)
      const u = job.userInfo || {}
      const name = (u.user_name || u.name || '').trim()
      const birth = String(u.birth_date || '').replace(/[^0-9]/g, '')
      const phone = String(u.phone || '').replace(/[^0-9]/g, '')
      fill(["input[name*='Nm']", "input[placeholder*='이름']", "input[name*='name']"], name)
      fill(["input[placeholder*='생년월일']", "input[name*='brthdy']", "input[name*='birth']"], birth)
      fill(["input[placeholder*='휴대']", "input[placeholder*='연락처']", "input[name*='telno']", "input[name*='phone']"], phone)
      status('running',
        `✅ '${job.serviceName}' 신청 화면이 열렸어요. 내용을 확인하고 필요한 항목을 채운 뒤,\n` +
        '⚠️ 최종 제출은 본인이 직접 눌러 주세요(비가역 신청이라 안전을 위해).')
      return
    }
    // 로그인 후 착지 → 서비스 신청 페이지로 이동
    status('running', '복지로 로그인 완료 — 신청 페이지로 이동합니다.')
    await sleep(500); await send({ type: 'GOTO', payload: { url: job.serviceUrl } })
    return
  }

  // ── 건강보험공단(자격득실확인서) — 인증 위젯이 메인 DOM에 열림 ──
  if (host === 'www.nhis.or.kr' && isTop && job.site === 'nhis') {
    await sleep(1500)
    if (/personalLoginPage/i.test(url)) {
      clickText(['간편인증 로그인', '간편인증', '간편 인증'])
      await sleep(2500)
      clickText(['카카오톡', 'TALK'], ['카카오뱅크', 'BANK'])
      await sleep(800)
      const u = job.userInfo || {}
      const name = (u.user_name || u.name || '').trim()
      const birth = String(u.birth_date || '').replace(/[^0-9]/g, '')
      const phone = String(u.phone || '').replace(/[^0-9]/g, '')
      let filled = false
      filled = fill(['#oacx_name'], name) || filled
      filled = fill(['#oacx_birth'], birth) || filled
      if (phone) { const tail = phone.startsWith('010') && phone.length >= 10 ? phone.slice(3) : phone; filled = fill(['#oacx_phone2', '#oku_phone2'], tail) || filled }
      const agree = document.querySelector('#totalAgree'); if (agree && !agree.checked) agree.click()
      status('waiting', filled
        ? "✅ 정보를 자동 입력했어요. '인증 요청' 후 📱 카카오톡 [인증 허용]만 하세요."
        : "카카오톡 선택 후 정보를 입력하고 '인증 요청'을 눌러 주세요. 📱")
      return
    }
    if (/jpAea00401/i.test(url)) {
      clickText(['확인서 발급', '발급하기', '발급', '출력', '인쇄'])
      status('done', '✅ 건강보험 자격득실확인서 발급 화면까지 진행했어요. 인쇄창에서 저장(PDF)하세요.')
      return
    }
    status('running', '로그인 완료 — 자격득실확인서 페이지로 이동합니다.')
    await sleep(500); await send({ type: 'GOTO', payload: { url: job.issueUrl } })
    return
  }

  // ── 고용24(피보험자격 이력내역서) — 로그인 후 메뉴→조회→발급 ──
  if (host === 'www.work24.go.kr' && isTop && job.site === 'work24') {
    await sleep(1500)
    if (/openLginPage|AnyId|login/i.test(url)) {
      clickSel(['a.link-easy-anyId', 'a[class*="easy-anyId"]', 'a[onclick*="anyidAdaptor"]', '.btn_quick_login']) || clickText(['간편인증'])
      status('running', '간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱')
      await sleep(2800); await send({ type: 'REINJECT' })
      return
    }
    clickText(['피보험자격이력', '피보험 자격이력', '이력내역서', '피보험자격 이력'])
    await sleep(1500)
    clickText(['조회', '확인'])
    await sleep(1500)
    const issued = clickText(['발급', '출력', '인쇄'])
    status(issued ? 'done' : 'running', issued
      ? '✅ 고용보험 피보험자격 이력내역서 발급 화면까지 진행했어요. 인쇄창에서 저장하세요.'
      : "화면에서 '피보험자격이력' 메뉴 → 조회 → 발급을 진행해 주세요.")
    return
  }

  // ── 3) 로그인 후 다른 페이지에 착지: 발급폼으로 이동 ──
  if (host === 'plus.gov.kr' && isTop && !/login/i.test(location.pathname)) {
    status('running', '로그인 완료 — 발급 페이지로 이동합니다.')
    await sleep(500); await send({ type: 'GOTO', payload: { url: job.issueUrl } })
    return
  }

  // ── 4) 정부24 발급/신청 폼 처리 ──
  if (host === 'www.gov.kr' && /AA040|AA020/i.test(url) && isTop) {
    await sleep(1500)
    // 로그인으로 튕겼으면 로그인 페이지로
    if (/login|nlogin/i.test(url)) { status('running', '재로그인이 필요해요. 간편인증을 다시 진행해 주세요.'); return }

    // 회원 신청 모달
    clickText(['회원 신청하기', '회원신청'])
    await sleep(800)
    // 온라인발급 탭
    clickText(['온라인발급', '온라인 발급', '인터넷발급', '전자문서'])
    await sleep(800)
    // 신청/발급하기
    const applied = clickText(['발급하기', '신청하기', '발급신청', '온라인신청', '인터넷발급', '온라인발급'])
    await sleep(1500)
    clickText(['회원 신청하기', '회원신청'])
    await sleep(1000)

    // 문서 유형별 선택
    if (job.docName === '주민등록초본') {
      const lab = Array.from(document.querySelectorAll('label,span,td')).find((e) => e.textContent.trim() === '초본')
      if (lab) { const f = lab.getAttribute('for'); (f && document.getElementById(f) || lab).click() }
    }
    if (job.docName === '가족관계증명서') {
      const lab = Array.from(document.querySelectorAll('label,span,td')).find((e) => e.textContent.includes('일반'))
      if (lab) lab.click()
    }
    // 발급 목적 기본값
    const sel = document.querySelector("select[name*='purpose'], select[name*='issuPurps'], #issuPurps, select")
    if (sel && sel.options && sel.options.length) sel.selectedIndex = Math.min(1, sel.options.length - 1)

    status('running', applied ? '발급 양식을 처리 중이에요…' : "화면에서 '신청하기/온라인발급' 버튼을 눌러 주세요.")
    await sleep(1500)

    // 제출
    clickText(['발급', '확인']) || clickSel(["input[type='submit']", "button[type='submit']"])
    await sleep(2000)

    // 출력 버튼 대기(최대 90초)
    for (let i = 0; i < 90; i++) {
      if (clickText(['출력', '인쇄', '저장', '다운로드'])) {
        status('done', '✅ 발급 화면까지 진행했어요. 브라우저 인쇄창에서 저장(PDF)하시면 됩니다. 개인정보는 서버로 전송되지 않았어요.')
        return
      }
      await sleep(1000)
    }
    status('done', '발급 화면까지 진행했어요. 남은 발급/출력 단계를 화면에서 직접 마무리해 주세요.')
    return
  }
})()
