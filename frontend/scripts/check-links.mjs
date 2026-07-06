#!/usr/bin/env node
/**
 * 공식 딥링크 생존·정확성 점검 — 배포 전 `npm run check:links`.
 *
 * 왜: 정부24 CappBizCD·복지로 wlfareInfoId는 영구 식별자가 아니다. 실측에서 복지로 ID 6종이
 * 전부 타 서비스로 재배정된 전례가 있어(2026-07), 딥링크를 늘린 만큼 주기 검증이 필수다.
 *
 * 검증 방식(라이브 HTTP):
 *  - 정부24 AA020InfoCappView(EUC-KR): <title>에 기대 민원명이 있는지
 *  - 복지로 moveTWAT52011M: 본문 wlfareInfoNm에 기대 서비스명이 있는지 (len≈147이면 죽은 ID)
 * 실패가 하나라도 있으면 exit 1.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

// officialLinks.ts docLink의 CappBizCD 딥링크 — 코드와 동기 유지할 것
const GOV24 = [
  ['13100000015', '주민등록표 등본'],
  ['97400000004', '가족관계등록부'],
  ['14600000273', '장애인증명서'],
  ['12100000021', '소득금액증명'],
  ['13100000056', '납세증명서'],
  ['14600000280', '수급자'],
  ['10601000001', '한부모가족'],
  ['12100000016', '사업자등록증명'],
  // 기대 문자열은 정부24 <title> 실측 표기(2026-07) — '재학증명서'가 아니라 '재학증명' 등
  ['13410000019', '생활기록부'],
  ['13410000017', '재학증명'],     // 유치원 및 초중등학교 재학증명
  ['13404000010', '대학교 재학'],  // 대학교 재학 증명
  ['13404000009', '졸업'],         // 대학(교) 졸업(예정)증명서 발급
  ['13410000020', '졸업'],         // 유치원 및 초중등학교 졸업(예정)증명
]

// quickApply.ts KNOWN_APPLY_URLS의 복지로 wlfareInfoId — 코드와 동기 유지할 것
const BOKJIRO = [
  ['WLF00001164', '기초연금'],
  ['WLF00001171', '아동수당'],
  ['WLF00004657', '부모급여'],
  ['WLF00000060', '청년내일저축계좌'],
  ['WLF00004656', '첫만남이용권'],
  ['WLF00001132', '생계급여'],
]

async function fetchText(url, encoding) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  const buf = await res.arrayBuffer()
  return { status: res.status, text: new TextDecoder(encoding).decode(buf), bytes: buf.byteLength }
}

let fail = 0
const report = (ok, what, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${what}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

for (const [code, expectName] of GOV24) {
  const url = `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${code}`
  try {
    const { status, text } = await fetchText(url, 'euc-kr')
    const title = (text.match(/<title>([^<]*)/) || [])[1] || ''
    report(status === 200 && title.includes(expectName), `정부24 ${code} (${expectName})`, title.trim().slice(0, 60))
  } catch (e) {
    report(false, `정부24 ${code} (${expectName})`, String(e))
  }
}

for (const [id, expectName] of BOKJIRO) {
  const url = `https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=${id}`
  try {
    const { status, text, bytes } = await fetchText(url, 'utf-8')
    const dead = bytes < 1000 // 죽은 ID는 ~147바이트 빈 페이지
    report(status === 200 && !dead && text.includes(expectName), `복지로 ${id} (${expectName})`, dead ? `빈 페이지(${bytes}B) — ID 재배정 의심` : `${Math.round(bytes / 1024)}KB`)
  } catch (e) {
    report(false, `복지로 ${id} (${expectName})`, String(e))
  }
}

console.log(fail ? `\n${fail}건 실패 — officialLinks.ts/quickApply.ts의 해당 딥링크를 라이브 재실측해 교정하세요.` : '\n모든 딥링크 정상 ✨')
process.exit(fail ? 1 : 0)
