import { describe, it, expect } from 'vitest'
import { buildEvents, toICS, futureEvents, formatEventDate, foldICS } from './calendar'
import type { Policy } from '@/data/policies'
import type { TrackedItem } from '@/store/useAppStore'

const DAY = 86400000
const policy: Policy = {
  id: 'POL-001', name: '기초연금', category: '노인', target: '만 65세', benefit: '월 34만원',
  eligibility: '만 65세', required_docs: ['신분증'], application: '복지로', department: '보건복지부', renewal: '매년 재확인',
}
const map = { 'POL-001': policy }
const mk = (over: Partial<TrackedItem>): TrackedItem => ({
  policyId: 'POL-001', name: '기초연금', category: '노인', status: 'idle', savedAt: Date.now(), checkedDocs: [], ...over,
})

describe('buildEvents', () => {
  it('tracking → 신청 준비 일정', () => {
    const ev = buildEvents([mk({ status: 'tracking' })], map)
    expect(ev.some((e) => e.kind === 'prepare')).toBe(true)
  })
  it('applied → 진행 점검 일정(신청+14일)', () => {
    const ev = buildEvents([mk({ status: 'applied', appliedAt: Date.now() })], map)
    expect(ev.some((e) => e.kind === 'check')).toBe(true)
  })
  it('done + 매년 → 갱신 일정', () => {
    const ev = buildEvents([mk({ status: 'done', appliedAt: Date.now() - 100 * DAY })], map)
    expect(ev.some((e) => e.kind === 'renew')).toBe(true)
  })
  it('done + 1회성 바우처(1년 이내 사용)는 갱신 일정 없음 — "1년" 부분매칭 회귀', () => {
    const once = { ...policy, id: 'POL-007', name: '첫만남이용권', renewal: '1회 (출생 후 1년 이내 사용)' }
    const ev = buildEvents([mk({ policyId: 'POL-007', status: 'done', appliedAt: Date.now() - 100 * DAY })], { 'POL-007': once })
    expect(ev.some((e) => e.kind === 'renew')).toBe(false)
  })
  it('done + "연간 재선정" → 갱신 일정(monitoring과 동일 규칙 — .ics 누락 회귀 방지)', () => {
    const annual = { ...policy, id: 'POL-050', name: '연간재선정정책', renewal: '연간 재선정' }
    const ev = buildEvents([mk({ policyId: 'POL-050', status: 'done', appliedAt: Date.now() - 100 * DAY })], { 'POL-050': annual })
    expect(ev.some((e) => e.kind === 'renew')).toBe(true)
  })
  it('날짜 오름차순 정렬', () => {
    const ev = buildEvents([mk({ status: 'applied', appliedAt: Date.now() }), mk({ policyId: 'POL-001', status: 'tracking' })], map)
    for (let i = 1; i < ev.length; i++) expect(ev[i].date).toBeGreaterThanOrEqual(ev[i - 1].date)
  })
})

describe('buildEvents — 준비 일정 savedAt 앵커 (D-3 고정 버그 회귀 방지)', () => {
  // savedAt+준비일이 미래여야 앵커 그대로 유지된다(과거면 '내일'로 클램프돼 죽은 알림 방지 — 아래 별도 테스트).
  it('준비 이벤트 = savedAt + 3일 (Date.now()가 아닌 저장 시점 기준 → 실제 카운트다운)', () => {
    const saved = Date.now() + 30 * DAY
    const prep = buildEvents([mk({ status: 'tracking', savedAt: saved })], map).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBe(saved + 3 * DAY)
  })
  it('긴급 기한(일 단위) 정책은 준비를 하루 앞당기고(savedAt+1일) 기한 텍스트를 노트에 노출', () => {
    const saved = Date.now() + 30 * DAY
    const urgent: Policy = { ...policy, benefit: '출생 후 60일 이내 신청' }
    const prep = buildEvents([mk({ status: 'tracking', savedAt: saved })], { 'POL-001': urgent }).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBe(saved + 1 * DAY)
    expect(prep.note).toContain('기한:')
  })
  it('서로 다른 시점에 담은 항목은 준비 날짜가 서로 다름(더 이상 전부 D-3 아님)', () => {
    const a = mk({ status: 'tracking', savedAt: Date.now() + 30 * DAY })
    const b = mk({ status: 'tracking', savedAt: Date.now() + 35 * DAY })
    const dates = buildEvents([a, b], map).filter((e) => e.kind === 'prepare').map((e) => e.date)
    expect(new Set(dates).size).toBe(2)
  })
  it('buildEvents는 라이브 UI용이라 실제 앵커 유지(과거일 클램프 안 함 — 영원히 D-1 버그 방지)', () => {
    const old = mk({ status: 'tracking', savedAt: Date.now() - 100 * DAY })
    const prep = buildEvents([old], map).find((e) => e.kind === 'prepare')!
    expect(prep.date).toBeLessThan(Date.now()) // 지난 날짜 그대로(화면에선 '지남'으로 표시)
  })
})

describe('futureEvents — .ics 내보내기용 과거 이벤트 제외', () => {
  it('지난 이벤트는 빼고 오늘 이후만 남긴다', () => {
    const past = buildEvents([mk({ status: 'tracking', savedAt: Date.now() - 100 * DAY })], map)
    expect(past.length).toBeGreaterThan(0) // buildEvents엔 있지만
    expect(futureEvents(past).length).toBe(0) // 내보내기에선 제외
  })
  it('미래 이벤트는 유지', () => {
    const future = buildEvents([mk({ status: 'tracking', savedAt: Date.now() + 30 * DAY })], map)
    expect(futureEvents(future).length).toBe(future.length)
  })
})

describe('toICS', () => {
  it('유효한 VCALENDAR/VEVENT 생성', () => {
    const ics = toICS(buildEvents([mk({ status: 'tracking' })], map))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:')
    expect(ics).toContain('END:VCALENDAR')
  })
  it('노트의 CRLF/CR/LF는 \\n으로 이스케이프 — 원시 CR로 .ics 줄구조 깨지지 않음(RFC 5545)', () => {
    const ics = toICS([{ id: 'x', date: Date.now() + 86400000, title: '제목\r줄', note: '첫줄\r\n둘째줄\n셋째', kind: 'prepare' }])
    const desc = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'))
    expect(desc).toBe('DESCRIPTION:첫줄\\n둘째줄\\n셋째')
    // 값 내부에 원시 CR(폴딩용 \r\n 외)이 남지 않아야 함 — DESCRIPTION 값 부분에 raw \r 없음
    expect(desc!.slice('DESCRIPTION:'.length)).not.toMatch(/\r/)
  })
})

describe('감사 수정 회귀 — 날짜 정확성', () => {
  it('DTSTAMP는 UTC(Z)로 끝나야 함(RFC 5545)', () => {
    const ics = toICS([{ id: 'x', date: Date.now() + 86400000, title: '테스트', note: '메모', kind: 'prepare' }])
    const stamp = ics.split('\r\n').find((l) => l.startsWith('DTSTAMP:'))
    expect(stamp).toBeTruthy()
    expect(/^DTSTAMP:\d{8}T\d{6}Z$/.test(stamp!)).toBe(true)
  })
  it("오늘 늦은 시각 이벤트는 '내일'이 아니라 '오늘'로 표기", () => {
    const now = new Date()
    // 오늘 23:59(이미 지났으면 과거지만 같은 날) — 자정 정규화로 days=0 → '오늘/지남'
    const todayLate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).getTime()
    expect(formatEventDate(todayLate)).toContain('오늘')
    expect(formatEventDate(todayLate)).not.toContain('내일')
  })
  it("정확히 내일 자정은 '내일'", () => {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).getTime()
    expect(formatEventDate(tomorrow)).toContain('내일')
  })
})

describe('foldICS — RFC 5545 라인 폴딩(2026-07 감사)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length
  it('75옥텟 이하는 그대로', () => {
    expect(foldICS('SUMMARY:짧은 제목')).toBe('SUMMARY:짧은 제목')
  })
  it('긴 한글 라인은 CRLF+공백으로 접고, 각 물리라인은 75옥텟 이하', () => {
    const long = 'DESCRIPTION:' + '가나다라마바사아자차카타파하'.repeat(8) // 한글 3바이트 → 300+옥텟
    const folded = foldICS(long)
    expect(folded).toContain('\r\n ')
    for (const phys of folded.split('\r\n')) expect(bytes(phys)).toBeLessThanOrEqual(75)
  })
  it('접힌 줄을 이으면 원본과 동일(멀티바이트 손상 없음)', () => {
    const long = 'DESCRIPTION:' + '한글테스트'.repeat(20)
    const rejoined = foldICS(long).split('\r\n ').join('')
    expect(rejoined).toBe(long)
  })
  it('toICS 전체 출력의 모든 물리라인이 75옥텟 이하', () => {
    const longPolicy: Policy = { ...policy, name: '아주 긴 정책명 '.repeat(6),
      required_docs: ['주민등록등본', '가족관계증명서', '장애인증명서', '건강보험자격득실확인서'] }
    const ics = toICS(buildEvents([mk({ status: 'tracking' })], { 'POL-001': longPolicy }))
    for (const phys of ics.split('\r\n')) expect(bytes(phys)).toBeLessThanOrEqual(75)
  })
})
