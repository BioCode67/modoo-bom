// 확장 자동 회귀 테스트(Node판) — Python 없는 환경용. `node selftest.mjs` 로 실행.
// playwright-core + 실제 크롬 채널에 확장을 로드해 '로그인 전/공개 구간'을 검증한다.
// (로그인 이후는 정부24 Mbuster 안티매크로가 자동화 브라우저를 차단해 재현 불가 — 실사용 크롬만 가능)
//
//  T1) 확장 로드 + 웹↔확장 PING(서류 13종/신청 지원)
//  T2) ISSUE 시작 → 잡 탭 생성 + 정부24 로그인 URL 도달(Mbuster 차단 시 skip)
//  T3) 잡 탭을 공개 안내페이지(AA020)로 강제 이동 → 자동화가 발급 폼 링크로 이탈하는지
//  T4) findEasy 후보선택 로직 단위검증(픽스처 DOM: 모바일 신분증 vs 간편인증)
//  T5) realClick 후보정렬 로직 단위검증(숨은 '신청하기' 함정 vs 보이는 버튼)
//
// 의존성: 스크래치패드의 playwright-core 를 재사용하거나, 없으면
//   npm i playwright-core 후 PW_PATH 환경변수로 지정.
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PW = process.env.PW_PATH || 'playwright-core'
const { chromium } = require(PW)

const EXT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5173 // manifest externally_connectable/content_scripts 와 일치해야 bridge.js 가 붙는다

const BRIDGE_PAGE = `<!doctype html><html><head><meta charset=utf-8></head><body><h1>modoo selftest</h1><script>
window.__st=[];window.addEventListener('message',e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='status')window.__st.push(d.payload)});
window.req=(t,p)=>new Promise(r=>{const id=Math.random().toString(36).slice(2);const h=e=>{const d=e.data;if(d&&d.source==='modoo-ext'&&d.kind==='response'&&d.reqId===id){window.removeEventListener('message',h);r(d.resp)}};window.addEventListener('message',h);window.postMessage({source:'modoo-web',type:t,payload:p,reqId:id},'*');setTimeout(()=>r(null),4000)});
</script></body></html>`

// T4/T5용 픽스처 — 정부24 로그인/발급폼의 함정 구조 재현
const FIXTURE = `<!doctype html><html><head><meta charset=utf-8></head><body>
<div style="display:none"><button id="hiddenApply">신청하기</button></div>
<ul>
  <li><button id="mip" class="login-type">모바일 신분증<br>스마트폰의 모바일 신분증으로</button></li>
  <li><button id="fin" class="login-type">금융인증서<br>은행 앱 또는 인터넷뱅킹</button></li>
  <li><button id="easy" class="login-type">간편인증<br>민간(카카오, 네이버 등) 인증서로</button></li>
</ul>
<div style="height:30px"></div>
<button id="visibleApply">신청하기</button>
</body></html>`

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(req.url.startsWith('/fixture') ? FIXTURE : BRIDGE_PAGE)
})
await new Promise((r) => server.listen(PORT, r))

const userDataDir = path.join(process.env.TEMP || '/tmp', 'modoo-selftest-profile')
// ⚠️ 브랜드 크롬(채널 chrome)은 137+에서 --load-extension 지원 제거 → 번들 chromium 사용
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})

try {
  const page = await context.newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForTimeout(1200)

  // ── T1: PING + 지원 목록 ──
  const ping = await page.evaluate(() => window.req('PING'))
  const docs = (ping && ping.docs) || []
  check('T1 PING/확장 감지', !!(ping && ping.ok), `docs=${docs.length}`)
  check('T1 서류 13종', docs.length >= 13, docs.slice(0, 3).join(','))

  // ── T2: ISSUE 시작 → 잡 탭이 정부24 로그인으로 ──
  const issue = await page.evaluate(() => window.req('ISSUE', { docName: '주민등록등본', userInfo: { user_name: '테스트' } }))
  check('T2 ISSUE 수락', !!(issue && issue.ok), JSON.stringify(issue))
  let jobPage = null
  for (let i = 0; i < 20 && !jobPage; i++) {
    await page.waitForTimeout(500)
    jobPage = context.pages().find((p) => /gov\.kr/.test(p.url()))
  }
  check('T2 잡 탭 생성(gov.kr)', !!jobPage, jobPage ? jobPage.url().slice(0, 60) : '')
  if (jobPage) {
    await jobPage.waitForTimeout(5000)
    const u = jobPage.url()
    if (/mbuster/i.test(u)) console.log('⏭️  T2b 간편인증 도달 — Mbuster 보안페이지가 자동화 브라우저 차단(알려진 한계), skip')
    else check('T2b 로그인 페이지 도달', /login/i.test(u), u.slice(0, 80))

    // ── T3: 잡 탭을 공개 AA020으로 강제 이동 → 자동화가 발급폼 링크로 이동하는지 ──
    const AA020 = 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000015&HighCtgCD=A01010001&tp_seq=01&Mcode=10200'
    await jobPage.goto(AA020, { waitUntil: 'domcontentloaded' }).catch(() => {})
    let moved = false
    for (let i = 0; i < 24; i++) {
      await jobPage.waitForTimeout(500)
      const cur = jobPage.url()
      if (!/AA020InfoCappView/i.test(cur)) { moved = true; check('T3 AA020→발급폼 자동 이동', true, cur.slice(0, 80)); break }
    }
    if (!moved) check('T3 AA020→발급폼 자동 이동', false, jobPage.url().slice(0, 80))
  }

  // ── T4: findEasy 후보선택 로직(automation.js와 동일 코드) ──
  const fx = await context.newPage()
  await fx.goto(`http://localhost:${PORT}/fixture`)
  const easyPick = await fx.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s/g, '')
    const EASY_EXCL = ['모바일', '신분증', '금융인증', 'QR', '비회원', '아이디']
    const els = Array.from(document.querySelectorAll('a,button,[role="button"],span,strong,em,p,li,div'))
    let best = null, bestLen = 1e9, bestVis = false
    for (const el of els) {
      const t = norm(el.textContent)
      if (!t || t.length > 60) continue
      if (!['간편인증', '간편로그인'].some((x) => t.includes(x))) continue
      if (EASY_EXCL.some((x) => t.includes(norm(x)))) continue
      const vis = !!(el.getClientRects && el.getClientRects().length)
      if ((vis && !bestVis) || (vis === bestVis && t.length < bestLen)) { best = el; bestLen = t.length; bestVis = vis }
    }
    if (!best) return null
    const target = best.closest('a,button,[role="button"],[onclick]') ||
      (best.querySelector && best.querySelector('button,a,[role="button"]')) ||
      best.closest('li') || best
    return target ? target.id || target.tagName : null
  })
  check('T4 findEasy가 간편인증 카드 선택(모바일신분증 아님)', easyPick === 'easy', `picked=${easyPick}`)

  // ── T5: realClick 후보정렬(보이는 신청하기 > 숨은 신청하기) ──
  const applyPick = await fx.evaluate(() => {
    const norm = (t) => (t || '').replace(/\s/g, '')
    const texts = ['민원신청하기', '신청하기']
    const cands = []
    const seen = new Set()
    for (const c of document.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"],span,li,div[onclick]')) {
      const t = norm(c.textContent) + norm(c.value || '')
      if (!t || t.length > 80) continue
      if (!texts.some((x) => t.includes(norm(x)))) continue
      const el = c.closest('a,button,[role="button"],input,li,[onclick]') || c
      if (seen.has(el)) continue
      seen.add(el)
      cands.push({ el, len: t.length, vis: (el.getClientRects && el.getClientRects().length) ? 1 : 0 })
    }
    cands.sort((a, b) => (b.vis - a.vis) || (a.len - b.len))
    return cands.length ? cands[0].el.id : null
  })
  check('T5 realClick이 보이는 신청하기 우선(숨은 함정 회피)', applyPick === 'visibleApply', `picked=${applyPick}`)
} finally {
  await context.close().catch(() => {})
  server.close()
}

const pass = results.filter(Boolean).length
console.log(`\n결과: ${pass}/${results.length} 통과`)
process.exit(results.every(Boolean) ? 0 : 1)
