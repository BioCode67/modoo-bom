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

  const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length)
  const clickText = (texts, exclude = []) => {
    // 텍스트 라벨(제목 span/strong 포함)을 찾아 실제 클릭가능 상위(카드/링크/버튼)를 클릭.
    // (검증된 단순 버전 — visible 체크는 간편인증을 걸러내는 오판이 있어 제외)
    const els = Array.from(document.querySelectorAll('a,button,li,span,strong,em,p,div[role="button"],input[type="button"],input[type="submit"]'))
    for (const el of els) {
      const t = norm(el.textContent) + norm(el.value || '')
      if (texts.some((x) => t.includes(norm(x))) && !exclude.some((x) => t.includes(norm(x)))) {
        const target = el.closest('a,button,[role="button"],li,[onclick]') || el
        target.click(); return true
      }
    }
    return false
  }
  const clickSel = (sels) => {
    for (const s of sels) { const el = document.querySelector(s); if (el) { el.click(); return true } }
    return false
  }
  // 정부 버튼은 isTrusted=false(.click())를 무시 → background의 debugger로 '진짜 클릭'을 쏜다.
  // 최상위 프레임에서만 유효(좌표=뷰포트 CSS픽셀). el을 화면에 보이게 스크롤 후 중심 좌표 전송.
  // ⚠️ 순서 중요: debugger attach 시 상단 '디버깅 중' 안내바가 생기며 페이지가 아래로 밀림.
  //   → 먼저 attach(TRUSTED_PREP)하고, 밀린 뒤의 좌표를 다시 계산해서 클릭(TRUSTED_CLICK)한다.
  const trustedClickEl = async (el) => {
    if (!el || !isTop) return false
    const prep = await send({ type: 'TRUSTED_PREP' })
    if (!prep || !prep.ok) {
      // 개발자도구(F12)가 열려 있으면 debugger를 못 붙임 → 사용자에게 알림
      status('waiting', '⚠️ 자동 클릭을 하려면 개발자도구(F12) 창을 닫아 주세요. 닫으면 자동으로 다시 시도해요.')
      return false
    }
    await sleep(700) // 안내바 렌더로 뷰포트가 안정될 때까지 대기
    try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch { /* noop */ }
    await sleep(250)
    const r = el.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) return false
    const x = Math.round(r.left + r.width / 2)
    const y = Math.round(r.top + r.height / 2)
    const res = await send({ type: 'TRUSTED_CLICK', payload: { x, y } })
    return !!(res && res.ok)
  }
  // 텍스트/셀렉터로 버튼을 찾아 '진짜 클릭'. trustedOnly=true면 debugger 클릭 성공만 성공으로 침
  // (.click() 폴백은 정부 버튼에선 무시되는 경우가 많아, 재시도 루프에선 성공으로 오판하면 안 됨)
  const realClick = async (texts, sels = [], trustedOnly = false) => {
    let el = null
    const cand = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"],span,li,div[onclick]'))
    for (const c of cand) {
      const t = norm(c.textContent) + norm(c.value || '')
      if (texts.some((x) => t.includes(norm(x)))) { el = c.closest('a,button,[role="button"],input,li,[onclick]') || c; break }
    }
    if (!el) { for (const s of sels) { const q = document.querySelector(s); if (q) { el = q; break } } }
    if (!el) return false
    if (await trustedClickEl(el)) return true
    if (trustedOnly) return false
    try { el.click(); return true } catch { return false }
  }
  // React/Vue 등 프레임워크 폼도 인식하도록 네이티브 setter로 값 설정 후 input/change 발생
  const setVal = (el, val) => {
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')
      el.focus()
      if (setter && setter.set) setter.set.call(el, val); else el.value = val
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('keyup', { bubbles: true }))
      el.blur()
    } catch (e) { el.value = val }
  }
  const fill = (sels, val) => {
    if (!val) return false
    for (const s of sels) {
      const el = document.querySelector(s)
      if (el) { setVal(el, val); return true }
    }
    return false
  }
  // 라벨/placeholder 텍스트로 입력칸을 찾아 채움(내부 id/name을 몰라도 됨 — 공격적)
  const fillByLabel = (labels, val) => {
    if (!val) return false
    const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])')]
    for (const el of inputs) {
      if (!el.offsetParent && !(el.getClientRects && el.getClientRects().length)) continue // 보이는 것만
      let ctx = norm(el.placeholder || '') + norm(el.name || '') + norm(el.id || '') + norm(el.getAttribute('aria-label') || '')
      // 연결된 label
      if (el.id) { const lab = document.querySelector(`label[for="${el.id}"]`); if (lab) ctx += norm(lab.textContent) }
      // 부모/앞쪽 텍스트(td/th, 형제)
      const cell = el.closest('td,li,div,dd,p'); if (cell) ctx += norm(cell.previousElementSibling ? cell.previousElementSibling.textContent : '')
      if (labels.some((l) => ctx.includes(norm(l)))) { setVal(el, val); return true }
    }
    return false
  }

  // 버튼이 늦게 렌더되거나(보안 인터스티셜 후) 하는 경우를 위해 폴링 클릭
  const pollClick = async (fn, secs = 12) => {
    for (let i = 0; i < secs * 2; i++) { if (fn()) return true; await sleep(500) }
    return false
  }
  const loggedIn = () =>
    /로그아웃|logout/i.test((document.body && document.body.innerText) || '') ||
    !!document.querySelector('a[href*="logout" i], a[href*="Logout"]')

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

  // ── 1) 정부24(plus.gov.kr) 로그인 — 보안 인터스티셜(Mbuster) 대기 + 간편인증 폴링 ──
  if (host === 'plus.gov.kr' && isTop) {
    // 보안 확인 페이지면 리다이렉트 대기(다음 로드에서 재주입됨)
    if (/mbuster|securif|security|shield/i.test(location.href)) {
      status('running', '정부24 보안 확인 중이에요… 잠시만 기다려 주세요. (자동 진행)')
      return
    }
    // 로그인 후 '회원정보 재확인' 안내창 — '현재 정보 유지'로 건너뛰고 발급으로 진행
    if (/infoConfirmation/i.test(location.href) ||
        (document.body && /회원정보\s*재확인|회원정보를?\s*최신화/.test(document.body.innerText))) {
      status('running', '정부24 회원정보 확인 화면 — 건너뛰는 중…')
      const skipped = await pollClick(() => clickText(['현재 정보 유지', '다음에 변경', '나중에', '유지']), 6)
      if (!skipped) status('running', "화면에서 '현재 정보 유지'를 눌러 주세요. (그러면 발급으로 넘어가요)")
      return  // 클릭 후 네비게이션되면 재주입되어 발급으로 이어짐
    }
    // 발급 완료 목록(서비스 신청 내역) — 문서출력 클릭 + PDF 자동 저장
    // ⚠️ URL로만 매칭(메인 페이지에도 '서비스 신청 내역' 링크 텍스트가 있어 오인 방지)
    if (/mbrAplySrvcList/i.test(location.href)) {
      const hasOutput = /문서출력/.test((document.body && document.body.innerText) || '')
      if (hasOutput) {
        const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const fn = `모두봄_${(job.docName || '문서').replace(/\s/g, '')}_${ymd}.pdf`
        await send({ type: 'SAVE_ON_POPUP', payload: { filename: fn } })
        const clicked = await pollClick(() => clickText(['문서출력']), 5)
        status('done', clicked
          ? '✅ 발급 완료! 문서를 PDF로 저장하는 중이에요… (다운로드 폴더 확인)'
          : '✅ 발급 완료! 목록의 [문서출력]을 누르면 저장돼요.')
      } else {
        status('done', '✅ 발급 신청 접수됨. 처리완료되면 [문서출력]으로 저장하세요.')
      }
      return
    }
    // 실제 발급 신청 폼(plus.gov.kr/minwon/apply/applyMinwonForm) — 이걸 인식해야 '헛도는' 루프가 멈춤
    if (/applyMinwonForm|\/minwon\/apply\//i.test(location.href)) {
      await sleep(2500) // '잠시만 기다려 주세요' 로딩 대기
      const bt = () => (document.body && document.body.innerText) || ''
      // (a) 발급 결과화면(문서출력)이면 PDF 저장
      if (/문서출력/.test(bt())) {
        const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        await send({ type: 'SAVE_ON_POPUP', payload: { filename: `모두봄_${(job.docName || '문서').replace(/\s/g, '')}_${ymd}.pdf` } })
        const out = await pollClick(() => clickText(['문서출력']), 10)
        status('done', out
          ? '✅ 발급 완료! 문서를 PDF로 저장하는 중이에요… (다운로드 폴더 확인)'
          : '✅ 발급 완료! 화면의 [문서출력]을 누르면 저장돼요.')
        return
      }
      // (b) 신청 폼: 로딩(스피너) 끝나고 '신청하기'가 뜰 때까지 대기 → 사용자 검토 시간 → 자동 신청
      let ready = false
      for (let i = 0; i < 24; i++) { // 최대 ~12초
        if (/신청하기/.test(bt()) && !/잠시만\s*기다/.test(bt())) { ready = true; break }
        await sleep(500)
      }
      if (!ready) { status('running', '발급 폼 불러오는 중…'); return } // 다음 재주입에서 재시도
      // 기본값(전체발급 / 온라인발급-본인출력)은 이미 선택돼 있음. 잘못된 정보는 이 5초 동안 사용자가 직접 수정 가능.
      status('waiting', '발급 정보를 확인하세요. 잘못된 항목이 있으면 지금 수정하세요 — 5초 후 자동으로 신청합니다.')
      await sleep(5000)
      const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      await send({ type: 'SAVE_ON_POPUP', payload: { filename: `모두봄_${(job.docName || '문서').replace(/\s/g, '')}_${ymd}.pdf` } })
      // 정부 버튼은 진짜 클릭만 먹으므로 debugger 기반 realClick 사용(실패 시 .click 폴백).
      // 개발자도구가 열려 있는 등 일시 실패면 3초 간격으로 최대 60초 재시도.
      let submitted = false
      const SUBMIT_TEXTS = ['민원신청하기', '신청하기']
      const SUBMIT_SELS = ['#btnMinwonApply', '#btnApply', "input[value*='신청']", "a[onclick*='apply' i]", "button[onclick*='apply' i]"]
      for (let i = 0; i < 20 && !submitted; i++) { // 진짜 클릭만 성공으로 인정, 3초 간격 재시도
        submitted = await realClick(SUBMIT_TEXTS, SUBMIT_SELS, true)
        if (!submitted) await sleep(3000)
      }
      if (!submitted) submitted = await realClick(SUBMIT_TEXTS, SUBMIT_SELS) // 마지막 시도: .click() 폴백 허용
      status(submitted ? 'running' : 'waiting', submitted
        ? '발급 신청을 제출하는 중이에요… (전자서명 창이 뜨면 본인 확인해 주세요)'
        : "화면 하단의 '신청하기' 버튼을 눌러 주세요. (누르면 이후는 자동)")
      return
    }
    // 로그인 상태를 잠깐 기다렸다 확인(로그아웃 링크가 늦게 렌더될 수 있음)
    let isLoggedIn = loggedIn()
    if (!isLoggedIn) { for (let i = 0; i < 6 && !isLoggedIn; i++) { await sleep(500); isLoggedIn = loggedIn() } }
    if (isLoggedIn) {
      // 로그인 후: 공개 안내페이지(AA020)로 바로 이동 → 거기서 발급하기(applyConfirm)를 누른다.
      // (메인 '자주 찾는 서비스'는 캐러셀이라 숨은 복제 타일 헛클릭 위험 → 아예 회피)
      status('running', '로그인 완료 — 발급 안내 페이지로 이동합니다.')
      await sleep(300); await send({ type: 'GOTO', payload: { url: job.issueUrl } })
      return
    }
    // 로그인 화면: 간편인증 버튼을 최대 12초 폴링(보안페이지 후 늦게 렌더 대비)
    status('running', '정부24 로그인 화면 준비 중…')
    const clicked = await pollClick(() =>
      clickSel(["button.login-type", "[data-tab='easy']", "[data-type='easy']"]) ||
      clickText(['간편인증', '간편 인증', '간편로그인']), 12)
    status('running', clicked
      ? '간편인증을 선택했어요. 카카오톡을 고르고 본인인증을 진행해 주세요. 📱'
      : "화면에서 '간편인증'을 눌러 주세요. (보안 확인이 끝나면 자동으로 다시 시도해요)")
    if (clicked) {
      await sleep(2500); await send({ type: 'REINJECT' })
      // 안전망: 페이지 전환 없이(AJAX) 로그인되는 경우 대비 — 로그인 완료를 폴링해 발급 진행
      // (전환이 일어나면 이 인스턴스는 사라지고 onUpdated 재주입이 이어받음)
      for (let i = 0; i < 300; i++) {
        await sleep(1000)
        if (loggedIn()) {
          status('running', '로그인 완료 — 발급 안내 페이지로 이동합니다.')
          await send({ type: 'GOTO', payload: { url: job.issueUrl } })
          return
        }
      }
    }
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
    // 이름 — id/name/placeholder 우선, 안 잡히면 라벨 텍스트로(공격적)
    filled = (fill(['#oacx_name', 'input[name*="name" i]', 'input[placeholder*="이름"]', 'input[placeholder*="홍길동"]'], name)
      || fillByLabel(['이름', '성명', '한글이름'], name)) || filled
    filled = (fill(['#oacx_birth', 'input[name*="birth" i]', 'input[placeholder*="생년월일"]'], birth)
      || fillByLabel(['생년월일', '생일'], birth)) || filled
    if (phone) {
      // 전체 번호 필드(모바일 신분증: placeholder 01012341234) 우선, 없으면 뒷자리(oacx 분할)
      let full = fill(['input[placeholder*="01012341234"]', 'input[placeholder*="휴대폰"]', 'input[placeholder*="휴대전화"]',
        'input[name*="hpNo" i]', 'input[name*="mbl" i]', 'input[name*="phone" i]'], phone)
      if (!full) full = fillByLabel(['휴대폰', '휴대전화', '핸드폰', '전화번호'], phone)
      if (!full) {
        const tail = phone.startsWith('010') && phone.length >= 10 ? phone.slice(3) : phone
        fill(['#oacx_phone2', '#oku_phone2', 'input.phone'], tail)
      }
      filled = filled || full
    }
    // 통신사(앱에서 입력) — select면 텍스트 매칭으로 선택
    const carrier = (u.carrier || '').trim()
    if (carrier) {
      const cs = document.querySelector("select[name*='telecom' i], select[name*='carrier' i], select[name*='mbl' i], #oacx_telecom")
      if (cs && cs.options) {
        for (const o of cs.options) {
          if ((o.text || '').includes(carrier)) { cs.value = o.value; cs.dispatchEvent(new Event('change', { bubbles: true })); filled = true; break }
        }
      }
    }
    // 전체동의 — id/name 또는 '전체동의' 라벨의 체크박스
    let agreeEl = document.querySelector('#totalAgree, input#totalAgree, input[id*="allAgree" i], input[name*="allAgree" i], input[id*="agreeAll" i]')
    if (!agreeEl) {
      const lab = [...document.querySelectorAll('label,span,div')].find((e) => /전체\s*동의/.test(e.textContent || ''))
      if (lab) { const f = lab.getAttribute && lab.getAttribute('for'); agreeEl = (f && document.getElementById(f)) || lab.querySelector('input[type="checkbox"]') || lab }
    }
    if (agreeEl) { if (agreeEl.tagName === 'INPUT') { if (!agreeEl.checked) agreeEl.click() } else agreeEl.click() }
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
      // 로그인 페이지: eForm 간편인증 버튼 폴링 클릭 → 인증 iframe에도 주입 요청
      status('running', '복지로 로그인 화면 준비 중…')
      const clicked = await pollClick(() =>
        clickEform(['간편인증', '간편 인증', '간편로그인']) || clickText(['간편인증', '간편 인증']), 12)
      status('running', clicked
        ? '복지로 간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱'
        : "화면에서 '간편인증'을 눌러 주세요.")
      if (clicked) { await sleep(2800); await send({ type: 'REINJECT' }) }
      return
    }
    if (/moveTWAT|wlfareInfoId/i.test(url)) {
      // 서비스 신청 페이지(임의 wlfareInfoId): 신청하기 클릭 + 기본 정보 자동 입력
      await pollClick(() => clickEform(['신청하기', '온라인신청', '모바일신청']) || clickText(['신청하기', '온라인신청']), 8)
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
      status('running', '건강보험공단 로그인 화면 준비 중…')
      await pollClick(() => clickText(['간편인증 로그인', '간편인증', '간편 인증']), 12)
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

  // ── 한국장학재단(국가장학금 등 신청) ──
  if (host === 'www.kosaf.go.kr' && isTop && job.kind === 'apply' && job.applySite === 'kosaf') {
    await sleep(1500)
    if (/login/i.test(url)) {
      status('running', '한국장학재단 로그인 화면 준비 중…')
      const clicked = await pollClick(() => clickText(['간편인증', '간편 인증', '간편로그인']), 12)
      status('running', clicked
        ? '간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱'
        : "화면에서 '간편인증'을 눌러 주세요.")
      if (clicked) { await sleep(2800); await send({ type: 'REINJECT' }) }
      return
    }
    // 로그인 후: 신청 페이지로 이동 → 안내
    if (job.serviceUrl && !url.startsWith(job.serviceUrl.split('?')[0])) {
      status('running', '로그인 완료 — 장학금 신청 페이지로 이동합니다.')
      await sleep(400); await send({ type: 'GOTO', payload: { url: job.serviceUrl } })
      return
    }
    await pollClick(() => clickText(['신청하기', '신청', '온라인신청']), 8)
    status('running',
      `✅ '${job.serviceName}' 신청 화면이 열렸어요. 내용을 확인하고 채운 뒤,\n` +
      '⚠️ 최종 제출은 본인이 직접 눌러 주세요.')
    return
  }

  // ── 국민연금공단(전자민원 가입증명) ──
  if ((host === 'www.nps.or.kr' || host === 'minwon.nps.or.kr') && isTop && job.site === 'nps') {
    await sleep(1500)
    if (loggedIn()) {
      // 로그인 상태: 발급/조회 버튼
      const issued = await pollClick(() => clickText(['발급', '출력', '인쇄', '조회']), 8)
      status(issued ? 'done' : 'running', issued
        ? '✅ 국민연금 가입내역확인서 발급 화면까지 진행했어요. 인쇄창에서 저장하세요.'
        : '화면에서 발급/조회 버튼을 눌러 주세요.')
      return
    }
    // 로그인/간편인증 유도
    status('running', '국민연금 전자민원 로그인 화면 준비 중…')
    const clicked = await pollClick(() =>
      clickText(['간편인증', '간편 인증', '간편인증 로그인']) ||
      clickSel(["a[href*='simple' i]", "button[onclick*='simple' i]", ".btn-easy"]), 12)
    status('running', clicked
      ? '간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱'
      : "화면에서 '간편인증' 후 로그인해 주세요. 로그인되면 자동으로 발급을 이어가요.")
    if (clicked) { await sleep(2800); await send({ type: 'REINJECT' }) }
    return
  }

  // ── 고용24(피보험자격 이력내역서) — 로그인 후 메뉴→조회→발급 ──
  if (host === 'www.work24.go.kr' && isTop && job.site === 'work24') {
    await sleep(1500)
    if (/openLginPage|AnyId|login/i.test(url)) {
      status('running', '고용24 로그인 화면 준비 중…')
      const clicked = await pollClick(() =>
        clickSel(['a.link-easy-anyId', 'a[class*="easy-anyId"]', 'a[onclick*="anyidAdaptor"]', '.btn_quick_login']) || clickText(['간편인증']), 12)
      status('running', clicked
        ? '간편인증을 선택했어요. 카카오톡으로 본인인증을 진행해 주세요. 📱'
        : "화면에서 '간편인증'을 눌러 주세요.")
      if (clicked) { await sleep(2800); await send({ type: 'REINJECT' }) }
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

  // ── 정부24 발급/신청 폼 처리 ──
  if (host === 'www.gov.kr' && /AA040|AA020/i.test(url) && isTop) {
    await sleep(1500)
    if (/login|nlogin/i.test(url)) { status('running', '재로그인이 필요해요. 간편인증을 다시 진행해 주세요.'); return }

    // 각 단계는 '한 동작 → 페이지 전환 → 재주입이 이어받기' 방식(전환마다 return).
    // ⚠️ 안내페이지의 인쇄 아이콘을 '출력'으로 오인하지 않도록, 출력 처리는 발급 폼/결과에서만.

    // 1) 안내페이지(AA020) → '발급하기' 클릭 → 같은 페이지에 뜨는 회원/비회원 모달의 '회원 신청하기'까지 처리
    //    (⚠️ 발급하기 후 모달이 '페이지 전환 없이' 뜨므로 재주입이 안 됨 → 여기서 이어서 클릭해야 함)
    //    (⚠️ '비회원 신청하기'가 '회원 신청하기'를 문자열로 포함하므로 exclude로 배제)
    if (/AA020InfoCappView/i.test(url)) {
      // 발급 폼 직접 링크(a[href*=AA040OfferMainFrm])로 바로 이동 → 회원/비회원 모달과
      // '신뢰된 클릭만 먹는' 회원 신청하기 버튼을 우회(로그인 상태면 폼이 바로 뜸).
      const a = document.querySelector('a[href*="AA040OfferMainFrm"]')
      if (a && a.href) { status('running', '발급 폼으로 이동 중…'); location.href = a.href; return }
      // 폴백: 직접 링크가 없으면 발급하기 클릭(모달의 회원 신청하기는 사용자가 눌러야 함)
      const clicked = await pollClick(() => clickText(['발급하기']), 8)
      status(clicked ? 'waiting' : 'waiting', clicked
        ? "모달이 뜨면 '회원 신청하기'를 눌러 주세요. (버튼 보안상 자동클릭 불가)"
        : "화면에서 '발급하기'를 눌러 주세요.")
      return
    }
    // 2) (다른 진입에서) 회원/비회원 모달이 있으면 회원 신청하기
    if (clickText(['회원 신청하기'], ['비회원'])) {
      status('running', '회원 신청으로 진행 중…'); return
    }

    const bodyTxt = () => (document.body && document.body.innerText) || ''

    // 5) 발급 완료 결과화면(문서출력 버튼) → PDF 저장. (신청내역 페이지는 별도 분기가 처리)
    if (/문서출력/.test(bodyTxt())) {
      const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      await send({ type: 'SAVE_ON_POPUP', payload: { filename: `모두봄_${(job.docName || '문서').replace(/\s/g, '')}_${ymd}.pdf` } })
      const out = await pollClick(() => clickText(['문서출력']), 8)
      status('done', out
        ? '✅ 발급 완료! 문서를 PDF로 저장하는 중이에요… (다운로드 폴더 확인)'
        : '✅ 발급 완료! 화면의 [문서출력]을 누르면 저장돼요.')
      return
    }

    // 3) 발급 폼(AA040): 문서 유형/목적 선택
    if (job.docName === '주민등록초본') {
      const lab = Array.from(document.querySelectorAll('label,span,td')).find((e) => e.textContent.trim() === '초본')
      if (lab) { const f = lab.getAttribute('for'); (f && document.getElementById(f) || lab).click() }
    }
    const sel = document.querySelector("select[name*='purpose'], select[name*='issuPurps'], #issuPurps, select")
    if (sel && sel.options && sel.options.length) sel.selectedIndex = Math.min(1, sel.options.length - 1)

    // 4) 발급/신청 제출 — 폼이 늦게 렌더될 수 있어 폴링
    const submitted = await pollClick(() =>
      clickSel(['#btnIssue', '#btnApply', "input[value*='발급']", "input[value*='신청']"]) ||
      clickText(['민원신청하기', '신청하기', '발급하기', '발급', '제출']), 8)
    status(submitted ? 'running' : 'running', submitted
      ? '발급 신청을 제출하는 중이에요…'
      : '발급 폼 처리 중… (화면을 잠시 지켜봐 주세요)')
    return
  }
})()
