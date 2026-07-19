/**
 * 🔎 자동신청 커버리지 β 오버레이 — 앱 내 실측([자동신청 가능 확인])으로 발굴한
 * 정책명 → 복지로 신청 딥링크(wlfareInfoId) 매핑을 **이 브라우저에만** 기억한다(localStorage).
 *
 * 정직성 원칙:
 *  · 등재되는 항목은 데스크탑 에이전트가 복지로를 실측(검색→ID 발굴→상세 일치 확인)한 것만.
 *  · 복지로는 비로그인 시 방문형에도 '신청하기'를 렌더하므로 이 매핑은 β(후보)다 —
 *    온라인 신청형인지는 첫 자동신청 실행이 판별한다(버튼 없으면 백엔드가 정직한 실패 + 공식 링크 폴백).
 *  · 내장 검증 목록(KNOWN_APPLY_URLS)이 항상 우선 — 이 오버레이는 그 다음 순위로만 조회된다.
 */

const KEY = 'modoobom-apply-extra'
export const APPLY_EXTRA_EVENT = 'modoobom:apply-extra-changed'

export interface ApplyExtraEntry {
  url: string
  wlfareInfoId: string
  title?: string
  at: number // 등록 시각(epoch ms) — 관리·표시용
}

/** 복지로 신청 상세 딥링크만 허용(백엔드 _valid_bokjiro_url과 같은 취지의 프론트 게이트) */
export function isValidBokjiroDeepLink(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)bokjiro\.go\.kr$/.test(u.hostname) && /wlfareInfoId=WLF\w+/.test(u.search)
  } catch {
    return false
  }
}

function read(): Record<string, ApplyExtraEntry> {
  try {
    const raw = localStorage.getItem(KEY)
    const j = raw ? JSON.parse(raw) : {}
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function write(map: Record<string, ApplyExtraEntry>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
    window.dispatchEvent(new Event(APPLY_EXTRA_EVENT))
  } catch { /* 저장 불가(시크릿 등) — 세션 내 미기억으로 조용히 동작 */ }
}

/** 정책명으로 β 딥링크 조회(없거나 형식이 깨졌으면 undefined — 손상 항목은 신뢰하지 않음) */
export function applyExtraUrl(policyName: string): string | undefined {
  const e = read()[policyName]
  return e && isValidBokjiroDeepLink(e.url) ? e.url : undefined
}

/** 실측 통과(candidate) 항목 등록 — 유효한 복지로 딥링크만 받는다(그 외 false 반환, 저장 안 함) */
export function addApplyExtra(policyName: string, entry: Omit<ApplyExtraEntry, 'at'>): boolean {
  const name = policyName.trim()
  if (!name || !isValidBokjiroDeepLink(entry.url)) return false
  const map = read()
  map[name] = { ...entry, at: Date.now() }
  write(map)
  return true
}

/** 등재 해제(첫 자동신청이 방문형으로 판명되는 등) */
export function removeApplyExtra(policyName: string): void {
  const map = read()
  if (policyName in map) {
    delete map[policyName]
    write(map)
  }
}

/** 이 정책이 β 오버레이로 신청 가능해진 것인가 — UI가 'β(첫 자동신청이 최종 검증)' 안내를 붙일 기준 */
export function isApplyExtra(policyName: string): boolean {
  return applyExtraUrl(policyName) !== undefined
}
