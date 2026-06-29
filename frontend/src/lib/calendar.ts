import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'

const DAY = 86400000

export interface WelfareEvent {
  id: string
  date: number // epoch ms (해당 날짜 0시 기준)
  title: string
  note: string
  kind: 'prepare' | 'check' | 'renew'
}

function isAnnual(renewal: string): boolean {
  return /매년|연\s*1회|1년|재확인/.test(renewal || '')
}

/** 추적 항목에서 다가오는 복지 일정(준비/점검/갱신)을 날짜로 생성 */
export function buildEvents(tracked: TrackedItem[], map: Record<string, Policy>): WelfareEvent[] {
  const events: WelfareEvent[] = []
  for (const t of tracked) {
    const p = map[t.policyId]
    if (!p) continue
    if (t.status === 'idle' || t.status === 'tracking') {
      events.push({
        id: `${t.policyId}-prepare`, date: Date.now() + 3 * DAY, kind: 'prepare',
        title: `${p.name} 신청 준비`, note: `필요 서류: ${(p.required_docs || []).join(', ') || '주민센터 확인'}`,
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

function icsDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 이벤트 목록을 .ics(아이캘린더) 문자열로 변환 */
export function toICS(events: WelfareEvent[]): string {
  const stamp = icsDate(Date.now()) + 'T090000'
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
  return lines.join('\r\n')
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
  const days = Math.ceil((ms - Date.now()) / DAY)
  const rel = days <= 0 ? '오늘/지남' : days === 1 ? '내일' : `D-${days}`
  return `${d.getMonth() + 1}월 ${d.getDate()}일 · ${rel}`
}
