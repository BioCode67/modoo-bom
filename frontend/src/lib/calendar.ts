import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'
import { deadlineHint } from '@/lib/deadline'

const DAY = 86400000

export interface WelfareEvent {
  id: string
  date: number // epoch ms (해당 날짜 0시 기준)
  title: string
  note: string
  kind: 'prepare' | 'check' | 'renew'
}

function isAnnual(renewal: string): boolean {
  // monitoring.ts isAnnualRenewal과 동일 규칙 — '1년'을 무조건 매칭하면 1회성 바우처('1년 이내 사용')를 매년 갱신으로 오판(거짓 .ics 갱신 일정)
  const r = renewal || ''
  if (/1회|사용|유효|만기|소진|이내|일시/.test(r)) return false
  return /매년|연\s*1회|1년\s*(?:마다|단위|주기)|재확인|재산정|재판정/.test(r)
}

/** 추적 항목에서 다가오는 복지 일정(준비/점검/갱신)을 날짜로 생성 */
export function buildEvents(tracked: TrackedItem[], map: Record<string, Policy>): WelfareEvent[] {
  const events: WelfareEvent[] = []
  for (const t of tracked) {
    const p = map[t.policyId]
    if (!p) continue
    if (t.status === 'idle' || t.status === 'tracking') {
      // '준비' 알림은 담아둔 시점(savedAt)에 앵커해 실제로 카운트다운되게 한다.
      // (과거엔 Date.now()+3일로 계산해 매 렌더마다 '지금 기준 3일' → 영원히 D-3으로 고정되던 버그)
      // 기한 신호가 급한(일 단위) 정책은 준비를 더 앞당기고, 정책의 실제 기한 텍스트를 노트에 함께 노출.
      const hint = deadlineHint(p)
      const prepDays = hint?.urgent ? 1 : 3
      // ⚠️ 여기서 Date.now()로 클램프하면 안 된다 — buildEvents는 '복지 일정' 화면(WelfareCalendar)이
      //    매 렌더 호출하는 공용 함수라, 지난 준비일을 '내일'로 밀면 영원히 D-1로 고정되는 가짜 카운트다운이 된다.
      //    실제 앵커(savedAt+준비일)를 그대로 두고, 과거 날짜 제외는 .ics 내보내기 시점(futureEvents)에서 처리한다.
      events.push({
        id: `${t.policyId}-prepare`, date: t.savedAt + prepDays * DAY, kind: 'prepare',
        title: `${p.name} 신청 준비`,
        note: `${hint ? `기한: ${hint.label} · ` : ''}필요 서류: ${(p.required_docs || []).join(', ') || '주민센터 확인'}`,
      })
    }
    if (t.status === 'applied' && t.appliedAt) {
      events.push({
        id: `${t.policyId}-check`, date: t.appliedAt + 14 * DAY, kind: 'check',
        title: `${p.name} 진행상황 점검`, note: '복지로 신청내역 또는 ☎129에서 심사 진행을 확인하세요.',
      })
    }
    if (t.status === 'done' && isAnnual(p.renewal)) {
      const base = t.appliedAt || t.savedAt
      events.push({
        id: `${t.policyId}-renew`, date: base + 365 * DAY, kind: 'renew',
        title: `${p.name} 자격 재확인(갱신)`, note: `${p.renewal} — 자격 재확인이 필요할 수 있어요.`,
      })
    }
  }
  return events.sort((a, b) => a.date - b.date)
}

/** .ics 내보내기용 — 지난 날짜 이벤트는 캘린더에 무의미하므로 제외(오늘 이후만). 라이브 UI는 이걸 쓰지 않는다. */
export function futureEvents(events: WelfareEvent[]): WelfareEvent[] {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  return events.filter((e) => e.date >= todayStart.getTime())
}

function icsDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// DTSTAMP는 RFC 5545상 반드시 UTC(끝에 'Z') — 로컬 floating은 위반이라 UTC로 생성
function icsStampUTC(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

// RFC 5545: 콘텐츠 라인이 75 옥텟(UTF-8 바이트) 초과 시 CRLF+공백으로 접는다.
// 한글은 3바이트/자라 '필요 서류: …' 같은 긴 note가 한도를 쉽게 넘어 엄격한 파서가 거부/절단할 수 있다.
// 멀티바이트 문자 경계를 넘어 자르지 않도록 후퇴한다.
export function foldICS(line: string): string {
  const enc = new TextEncoder()
  const bytes = enc.encode(line)
  if (bytes.length <= 75) return line
  const dec = new TextDecoder()
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end-- // UTF-8 연속바이트 경계 보존
    parts.push(dec.decode(bytes.slice(start, end)))
    start = end
    limit = 74 // 접힌 줄은 선두 공백 1칸 포함 → 콘텐츠는 74옥텟까지
  }
  return parts.join('\r\n ')
}

/** 이벤트 목록을 .ics(아이캘린더) 문자열로 변환 */
export function toICS(events: WelfareEvent[]): string {
  const stamp = icsStampUTC(Date.now())
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ModooBom//Welfare//KO', 'CALSCALE:GREGORIAN',
  ]
  for (const e of events) {
    const esc = (s: string) => s.replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@modoobom`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `SUMMARY:[모두봄] ${esc(e.title)}`,
      `DESCRIPTION:${esc(e.note)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldICS).join('\r\n')
}

/** .ics 파일 다운로드 트리거 */
export function downloadICS(events: WelfareEvent[]) {
  const blob = new Blob([toICS(events)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '모두봄_복지일정.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function formatEventDate(ms: number): string {
  const d = new Date(ms)
  // 자정 기준으로 '일수 차'를 계산 — 오늘 늦은 시각 이벤트가 '내일'로 오표기되던 문제 방지(밀리초 차 반올림 금지)
  const startOfDay = (t: number) => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime() }
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY)
  const rel = days <= 0 ? '오늘/지남' : days === 1 ? '내일' : `D-${days}`
  return `${d.getMonth() + 1}월 ${d.getDate()}일 · ${rel}`
}
