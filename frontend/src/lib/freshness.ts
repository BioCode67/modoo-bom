// 데이터 신선도·완결성 감사(freshness).
// 약 5,300건 카탈로그 중 요약형(LOC-/GOV-) 레코드는 요건이 불완전하거나 오래됐을 수 있다.
// 레코드 '텍스트를 파싱'해 신선도(연도 신호·잠정 표현)·완결성(검증금액·연락처·요건 상세도·서류·채널)·
// 출처 등급을 종합한 '정직한' 신뢰 지표를 만든다.
//
// 정직성 원칙:
//  - 없는 날짜/금액을 날조하지 않는다. yearSeen은 '파싱된 연도 토큰'만, 금액은 parseMonthly로 '유무만' 판단.
//  - 자격을 재판정/게이트하지 않는다(엔진 결과 존중). completeness는 '휴리스틱 점수'이며 권위적 단정이 아니다
//    → advisories에 '휴리스틱 추정' / '공식 확인 권장' 프레이밍을 항상 포함한다.
import type { Policy } from '@/data/policies'
import { parseMonthly } from '@/lib/format'
import { trustInfo } from '@/lib/trust'

export type CompletenessLevel = 'detailed' | 'summary' | 'sparse'
export type FreshnessLevel = 'current' | 'provisional' | 'possibly_stale' | 'unknown'

export interface FreshnessFlag {
  kind: string
  text: string
}

export interface FreshnessReport {
  /** 완결성 휴리스틱 점수(0~100) — 필드 유무·상세도 가중합. 권위적 판정이 아님. */
  completeness: number
  level: CompletenessLevel
  freshness: FreshnessLevel
  /** 파싱된 연도 토큰(2020~2030)의 최댓값. 없으면 null(날조 금지). */
  yearSeen: number | null
  /** 출처 신뢰 등급(trustInfo 기반). */
  source: string
  flags: FreshnessFlag[]
  advisories: string[]
}

export interface FreshnessSummary {
  total: number
  /** 공식 확인을 권장하는 레코드 수(요약형 · 신선도 주의 · 미검증 출처). */
  verifyCount: number
  /** 완결성이 detailed가 아닌(요약/희소) 레코드 수. */
  summaryCount: number
  /** 신선도가 possibly_stale 또는 provisional인 레코드 수. */
  staleCount: number
  note: string
}

// ── 완결성 점수 배점(합계 최대 100) ────────────────────────────────────────
const SCORE = {
  benefitPresent: 10, // 혜택 설명이 있음(설명형이라도 정보)
  amountVerified: 15, // parseMonthly로 월 지급액이 잡힘(검증된 금액 신호)
  docs: 20, // 필요 서류 목록 존재
  application: 15, // 신청 채널/URL 존재
  contact: 15, // 대표 문의처 존재
  eligDup: 8, // 요건이 있으나 target/benefit 복제(요약형 특징)
  eligShort: 12, // 요건이 짧게라도 별도 기술
  eligMid: 18,
  eligLong: 25, // 요건이 충분히 상세(별도·장문)
} as const

// 완결성 레벨 경계
const LEVEL_DETAILED = 65
const LEVEL_SUMMARY = 35

// 신선도 판정: 표기 연도가 (현재연도 - STALE_GAP)보다 오래되면 possibly_stale
const STALE_GAP = 2

const norm = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

// 적용범위 문구 필터 — '2022년 1월 1일 이후 출생(아)'·'2022년 이후 출생' 같은 연도는
// 제도의 '영구 대상 범위'이지 데이터 기준연도가 아니다. 이를 노후 신호로 오판하면
// 2026 검증 시드(첫만남이용권 POL-007 등)에 '오래됐을 수 있음' 거짓 경고가 붙는다(정직성 위반).
// 월·일은 생략될 수 있어 선택 매칭, '이후·이전·부터 출생' 문맥일 때만 제거(진짜 기준연도 '2021년 기준'은 유지).
const SCOPE_YEAR_RE = /20\d{2}년(?:\s*\d{1,2}월(?:\s*\d{1,2}일)?)?\s*(?:이후|이전|부터)\s*출생아?/g

/**
 * 연도 토큰(2020~2030)의 최댓값을 파싱한다.
 * 흐름:
 *  1) name/target/benefit/eligibility/renewal 만 이어붙인다(application은 bokjiro URL의
 *     숫자 id가 연도처럼 잡히는 오탐이 있어 제외 — 'moveTWAT52011M' 등).
 *  2) 적용범위 문구('20XX년 (M월 D일) 이후 출생' 등)를 먼저 제거 — 대상 범위 연도는
 *     데이터 기준연도가 아니므로 신선도 신호에서 배제(SCOPE_YEAR_RE).
 *  3) 앞뒤가 숫자가 아닌 경계에서만 202x·2030을 매칭(긴 숫자열 속 부분매칭 방지).
 *  4) 매칭 중 최댓값(가장 최근 개정 신호)을 채택. 없으면 null(날조 금지).
 */
function maxYear(policy: Policy): number | null {
  const text = [policy.name, policy.target, policy.benefit, policy.eligibility, policy.renewal]
    .map((x) => (typeof x === 'string' ? x : ''))
    .join(' ')
    .replace(SCOPE_YEAR_RE, '')
  const re = /(?<![0-9])(202[0-9]|2030)(?![0-9])/g
  let m: RegExpExecArray | null
  let best: number | null = null
  while ((m = re.exec(text)) !== null) {
    const y = parseInt(m[1], 10)
    if (best === null || y > best) best = y
  }
  return best
}

/** 잠정·예정 표현 탐지 — 시행 미확정 신호. 결과는 '확인 권장'(보수적 안내)일 뿐 단정이 아니다. */
function hasProvisionalWording(policy: Policy): boolean {
  const text = [policy.name, policy.target, policy.benefit, policy.eligibility, policy.renewal]
    .map((x) => (typeof x === 'string' ? x : ''))
    .join(' ')
  return /잠정|예정|추진|미정/.test(text)
}

/** 요건(eligibility) 상세도 점수 — 비었으면 0, target/benefit 복제면 낮게, 별도·장문이면 높게. */
function eligibilityScore(policy: Policy): number {
  const e = norm(policy.eligibility)
  if (!e) return 0
  const dup = e === norm(policy.benefit) || e === norm(policy.target)
  if (dup) return SCORE.eligDup
  if (e.length >= 40) return SCORE.eligLong
  if (e.length >= 15) return SCORE.eligMid
  return SCORE.eligShort
}

/**
 * 단일 레코드의 신선도·완결성 리포트를 만든다.
 * 흐름:
 *  1) 완결성: benefit(설명/검증금액)·required_docs·eligibility 상세도·application·contact 유무를
 *     가중합해 0~100 점수화 → detailed/summary/sparse 레벨 매핑.
 *  2) 신선도: 연도 토큰 최댓값(yearSeen)과 잠정 표현으로 current/provisional/possibly_stale/unknown 판정.
 *     (now를 주입받아 테스트에서 고정 — 기본은 실행 시각)
 *  3) 출처: trustInfo(id)로 등급/검증여부.
 *  4) flags/advisories: 부족 신호를 나열하고, '휴리스틱 추정 · 공식 확인 권장' 정직 라벨을 항상 포함.
 */
export function assessRecord(policy: Policy, now: Date = new Date()): FreshnessReport {
  const nowY = now.getFullYear()

  // 1) 완결성 점수
  const b = norm(policy.benefit)
  const amountVerified = parseMonthly(typeof policy.benefit === 'string' ? policy.benefit : '') > 0
  const docs = Array.isArray(policy.required_docs) ? policy.required_docs.filter(Boolean) : []
  const hasApp = norm(policy.application).length > 0
  const hasContact = norm(policy.contact || '').length > 0

  let completeness = 0
  if (b) completeness += SCORE.benefitPresent
  if (amountVerified) completeness += SCORE.amountVerified
  if (docs.length > 0) completeness += SCORE.docs
  completeness += eligibilityScore(policy)
  if (hasApp) completeness += SCORE.application
  if (hasContact) completeness += SCORE.contact
  completeness = Math.max(0, Math.min(100, Math.round(completeness)))

  const level: CompletenessLevel =
    completeness >= LEVEL_DETAILED ? 'detailed' : completeness >= LEVEL_SUMMARY ? 'summary' : 'sparse'

  // 2) 신선도
  const yearSeen = maxYear(policy)
  const provisional = hasProvisionalWording(policy)
  const isStale = yearSeen !== null && yearSeen < nowY - STALE_GAP
  let freshness: FreshnessLevel
  if (provisional) freshness = 'provisional'
  else if (isStale) freshness = 'possibly_stale'
  else if (yearSeen === null) freshness = 'unknown'
  else freshness = 'current'

  // 3) 출처
  const trust = trustInfo(policy.id)

  // 4) flags — 부족/주의 신호(각각 독립 차원, 중복 표기 허용)
  const flags: FreshnessFlag[] = []
  if (isStale) flags.push({ kind: 'stale_year', text: `표기 연도 ${yearSeen} — 최신 기준인지 공식 확인 권장` })
  if (provisional) flags.push({ kind: 'provisional', text: '‘예정·추진·잠정’ 등 잠정 표현 — 시행 여부 공식 확인 권장' })
  if (!amountVerified) flags.push({ kind: 'no_amount', text: '검증된 월 지급액 정보가 없어요(금액은 공식 확인)' })
  if (docs.length === 0) flags.push({ kind: 'no_docs', text: '필요 서류 정보가 비어 있어요' })
  if (level !== 'detailed') flags.push({ kind: 'summary_record', text: '요약형 레코드 — 상세 요건이 축약돼 있어요' })
  if (!trust.verified) flags.push({ kind: 'unverified_source', text: '공공데이터 요약 출처 — 관할 기관 확인 권장' })

  // 4) advisories — 정직 라벨('휴리스틱 추정'·'해당되시면'·'공식 확인 권장')을 데이터에 포함
  const advisories: string[] = []
  advisories.push('이 신선도·완결성 지표는 레코드 텍스트를 파싱한 휴리스틱 추정이에요(공식 판정이 아니에요).')
  if (level !== 'detailed' || !trust.verified)
    advisories.push('상세 요건·금액·서류는 해당 기관 공식 페이지에서 확인하시길 권장해요.')
  if (isStale) advisories.push('표기된 연도가 지났을 수 있어, 해당되시면 최신 기준을 공식 확인하세요.')
  if (provisional) advisories.push('‘예정·추진’ 등 잠정 표현이 있어, 실제 시행 여부를 공식 확인하시길 권장해요.')
  if (freshness === 'unknown')
    advisories.push('기준 연도 표기가 없어 최신성을 단정하기 어려워요 — 해당되시면 공식 안내를 확인하세요.')

  return { completeness, level, freshness, yearSeen, source: trust.source, flags, advisories }
}

/** 레코드 1건이 '공식 확인 권장' 대상인지 — 요약형이거나 신선도 주의거나 미검증 출처. */
function needsOfficialCheck(report: FreshnessReport, verified: boolean): boolean {
  const staleish = report.freshness === 'possibly_stale' || report.freshness === 'provisional'
  return report.level !== 'detailed' || staleish || !verified
}

/**
 * 추천 묶음의 신선도·완결성을 집계한다(정직한 요약 배너용).
 * 흐름:
 *  1) 각 정책을 assessRecord로 평가.
 *  2) 요약형(summaryCount)·신선도 주의(staleCount)·공식 확인 권장(verifyCount)을 센다.
 *  3) '추천 N개 중 X개 공식 확인 권장' 형태의 정직 note를 만든다(권위적 단정 아님).
 */
export function summarizeFreshness(policies: Policy[], now: Date = new Date()): FreshnessSummary {
  const list = Array.isArray(policies) ? policies : []
  const total = list.length
  let verifyCount = 0
  let summaryCount = 0
  let staleCount = 0
  for (const p of list) {
    const r = assessRecord(p, now)
    if (r.level !== 'detailed') summaryCount++
    if (r.freshness === 'possibly_stale' || r.freshness === 'provisional') staleCount++
    if (needsOfficialCheck(r, trustInfo(p.id).verified)) verifyCount++
  }
  const note =
    total === 0
      ? '점검할 추천이 없어요.'
      : `추천 ${total}개 중 ${verifyCount}개는 공식 확인을 권장해요(휴리스틱 추정).`
  return { total, verifyCount, summaryCount, staleCount, note }
}
