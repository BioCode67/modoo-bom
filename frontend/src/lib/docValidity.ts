import { issuableCanonical } from '@/lib/docAliases'

/**
 * 발급 서류 유효기간 계산 — '발급일'만으로 서류의 만료 여부를 판정한다.
 *
 * 왜 필요한가(실사용): 정부 발급 증명서(등본·소득금액증명 등)는 대개
 * '발급일로부터 3개월(통상)' 안에만 신청서에 첨부할 수 있다. 서류를 미리 떼어두고
 * 신청을 미루면 만료돼 다시 발급해야 한다. store.docDone 은 '정규화된 서류명 → 발급 시각'을
 * 이미 저장하므로(발급일 = 그 값), 별도 저장 없이 만료 임박/만료를 계산해 재발급을 유도한다.
 *
 * DocVault(데스크탑앱·서버 파일 기준 validity)와의 관계: 저기는 로컬 백엔드가 붙은 PC에서
 * 발급 폴더의 '파일'을 서버가 판정한다. 여기는 백엔드 없이(정적 웹 배포 포함) 브라우저의
 * 발급 기록(docDone)만으로 판정한다 → 웹에서도 동작하는 보완재. 임계·문구는 DocVault와 정렬.
 *
 * 정직성: 유효기간은 '통상 기준'이며 실제 인정 여부는 접수 기관 요구가 우선이다. 발급 증명서가
 * 아닌 서류(신분증·임대차계약서·통장사본 등)에는 3개월 만료를 씌우지 않는다(거짓 경보 금지).
 * 개인정보는 브라우저 안에서만 계산되고 서버로 가지 않는다.
 */

const DAY = 86400000

/** 관공서 제출용 증명서 통상 유효기간 — 발급일로부터 3개월(90일). 접수 기관 요구가 최종. */
export const DEFAULT_VALIDITY_DAYS = 90
/** 만료 임박(재발급 권장) 임계 — 남은 유효기간이 이 일수 이하면 경고(DocVault aging 과 정렬) */
export const EXPIRING_SOON_DAYS = 14

export type DocFreshness = 'fresh' | 'expiring' | 'expired' | 'permanent'

export interface ValidityRule {
  /** 유효기간(일). 0 이면 상태기반/기간제한 없음 → 만료 경고를 내지 않는다. */
  days: number
  note?: string
}

const norm = (s: string): string => (s || '').replace(/\s/g, '')

/**
 * 정식명(공백 제거) → 유효기간 규칙.
 * 대부분의 자동발급 증명서는 발급일로부터 3개월(표준)이라 기본값으로 두고, 예외만 명시한다:
 *  · 장애인증명서: 등록 상태 증명 → 별도 만료 없음(장애 재판정 주기는 별개 문제)
 *  · 납세증명서(국세·지방세): 서류에 인쇄된 유효기간이 우선
 *  · 소득금액증명: 과세연도 기준(접수처가 최신 연도분을 요구할 수 있음)
 */
const RULES: Record<string, ValidityRule> = {
  [norm('장애인증명서')]: { days: 0, note: '등록 상태 증명이라 별도 만료가 없어요(장애 재판정 주기는 별개).' },
  [norm('지방세 납세증명서')]: { days: DEFAULT_VALIDITY_DAYS, note: '서류에 인쇄된 유효기간이 있으면 그 기간이 우선이에요.' },
  [norm('국세 납세증명서')]: { days: DEFAULT_VALIDITY_DAYS, note: '서류에 인쇄된 유효기간이 있으면 그 기간이 우선이에요.' },
  [norm('소득금액증명')]: { days: DEFAULT_VALIDITY_DAYS, note: '과세연도 기준 서류라, 접수처가 최신 연도분을 요구할 수 있어요.' },
}

/**
 * 서류명 → 유효기간 규칙.
 * 자동발급 증명서(issuableCanonical 로 정식명이 해석되는 것)만 3개월 만료 개념을 적용한다.
 * 신분증·임대차계약서·통장사본처럼 발급 증명서가 아닌 서류는 표준 만료가 없어 경보를 내지 않는다.
 */
export function validityRule(docName: string): ValidityRule {
  const canon = issuableCanonical(docName)
  if (!canon) return { days: 0 } // 발급 증명서 아님 → 만료 경고 없음(거짓 경보 방지)
  return RULES[norm(canon)] || { days: DEFAULT_VALIDITY_DAYS }
}

export interface DocValidity {
  name: string              // 표시명(정식명 우선)
  issuedAt: number          // 발급 시각(ms)
  validityDays: number      // 0 이면 만료 없음
  expiresAt: number | null  // 만료 시각(ms), 만료 없음이면 null
  daysLeft: number | null   // 남은 일수(음수면 만료 경과), 만료 없음이면 null
  freshness: DocFreshness
  note?: string
}

/**
 * 발급일(issuedAt)을 기준으로 유효 상태를 계산한다. now 를 주입받아 순수·테스트 가능.
 *  - fresh    : 여유 있음
 *  - expiring : 남은 유효기간 ≤ EXPIRING_SOON_DAYS (재발급 권장)
 *  - expired  : 이미 만료(재발급 필요)
 *  - permanent: 만료 개념 없음(상태증명·비발급 서류)
 */
export function evaluateDoc(name: string, issuedAt: number, now: number): DocValidity {
  const canon = issuableCanonical(name) || name
  const rule = validityRule(name)
  if (rule.days <= 0) {
    return { name: canon, issuedAt, validityDays: 0, expiresAt: null, daysLeft: null, freshness: 'permanent', note: rule.note }
  }
  const expiresAt = issuedAt + rule.days * DAY
  const msLeft = expiresAt - now
  const expired = msLeft <= 0
  // 남은 일수: 아직 유효하면 올림(반나절 남아도 '1일 남음'), 만료됐으면 내림(음수 = 지난 일수)
  const daysLeft = expired ? Math.floor(msLeft / DAY) : Math.ceil(msLeft / DAY)
  const freshness: DocFreshness = expired ? 'expired' : daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'fresh'
  return { name: canon, issuedAt, validityDays: rule.days, expiresAt, daysLeft, freshness, note: rule.note }
}

/** 표시용 한 줄 상태 문구 — DocVault 뱃지 문구와 어울리게 */
export function freshnessLabel(v: DocValidity): string {
  const d = v.daysLeft ?? 0
  switch (v.freshness) {
    case 'permanent': return '기간 제한 없음'
    case 'fresh': return `유효 · ${d}일 남음`
    case 'expiring': return `만료 임박 · ${d}일 남음`
    case 'expired': return `만료됨 · ${Math.abs(d)}일 지남`
  }
}

/** 상태별 색조(뱃지 클래스) — Tailwind 팔레트와 정렬 */
export function freshnessTone(f: DocFreshness): { badge: string; text: string } {
  switch (f) {
    case 'expired': return { badge: 'bg-rose-100 text-rose-700', text: 'text-rose-700' }
    case 'expiring': return { badge: 'bg-amber-100 text-amber-800', text: 'text-amber-800' }
    case 'fresh': return { badge: 'bg-sprout-100 text-sprout-700', text: 'text-sprout-700' }
    case 'permanent': return { badge: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' }
  }
}
