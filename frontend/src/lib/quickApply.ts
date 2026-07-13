import { buildPrefill, type RpaInfo } from '@/lib/prefill'
import { applyLink } from '@/lib/officialLinks'
import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 원터치 신청 이동(무설치·전 브라우저·모바일) — 가장 매끄럽고 안전한 신청 경로.
 *  ① 내 정보(이름)를 클립보드에 자동 복사(공식 신청서 첫 칸에 바로 붙여넣기)
 *  ② 공식 신청 페이지를 새 탭으로 즉시 열기(딥링크) → 사용자는 정부 공식 사이트에서 간편인증만.
 * 개인정보·본인인증은 정부 공식 사이트에만 머문다(우리 서버 전송 없음 — 안전).
 */

/**
 * 수요 최다 복지의 복지로 신청 상세 딥링크 — 라이브 실측 검증(2026-07, wlfareInfoNm 대조).
 * ⚠️ wlfareInfoId는 시간이 지나면 타 서비스로 재배정될 수 있어(실증 전례) 주기 재검증 필요 — `npm run check:links`.
 * 오매칭 방지를 위해 **정확 일치 키만** 사용한다(포함 매칭 금지 — '기초연금'이 유사명을 가로채지 않게).
 */
const BOKJIRO = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId='
export const KNOWN_APPLY_URLS: Record<string, string> = {
  기초연금: `${BOKJIRO}WLF00001164`,
  아동수당: `${BOKJIRO}WLF00001171`,
  부모급여: `${BOKJIRO}WLF00004657`,
  '청년 내일저축계좌': `${BOKJIRO}WLF00000060`,
  첫만남이용권: `${BOKJIRO}WLF00004656`,
  '국민기초생활보장 생계급여': `${BOKJIRO}WLF00001132`,
  '기초생활 생계급여': `${BOKJIRO}WLF00001132`,
}

/**
 * '일반 홈' 착지 판정 — 정확 문자열 비교 대신 패턴 판정으로 트레일링 슬래시·index.do 등 변형까지 커버.
 * 딥링크 파라미터(wlfareInfoId·CappBizCD·검색어)가 있으면 홈이 아니다.
 */
export function isGenericHome(url: string): boolean {
  try {
    const u = new URL(url)
    if (!/(^|\.)bokjiro\.go\.kr$|(^|\.)gov\.kr$|(^|\.)work24\.go\.kr$/.test(u.hostname)) return false
    if (/wlfareInfoId|CappBizCD|srhQuery|searchTerm/i.test(u.search)) return false
    return u.pathname === '/' || u.pathname === '' || /^\/(portal\/main|index\.do|main\.do)\/?$/.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * 신청 시 열 최적 URL 우선순위:
 *  ① 정책 데이터의 자체 딥링크(applyLink가 추출 — 실데이터가 항상 우선)
 *  ② 일반 홈 착지라면: 실측 검증된 복지로 신청 딥링크(KNOWN_APPLY_URLS, 정책명 정확 일치)
 *  ③ 그래도 일반 홈이면 정책명으로 정부24 통합검색 결과로(사용자가 홈에서 헤매는 것 방지)
 *  단, '주민센터 방문' 채널은 온라인 신청처럼 오도하지 않도록 검색 폴백을 걸지 않는다.
 */
export function bestApplyUrl(application: string, policyName?: string): string {
  const link = applyLink(application)
  if (policyName && KNOWN_APPLY_URLS[policyName] && isGenericHome(link.url)) return KNOWN_APPLY_URLS[policyName]
  if (policyName && isGenericHome(link.url) && !link.label.includes('주민센터')) {
    return `https://www.gov.kr/search?srhQuery=${encodeURIComponent(policyName)}`
  }
  return link.url
}

/**
 * bestApplyUrl이 실제 착지하는 곳과 일치하는 버튼 라벨 — 라벨-URL 불일치 방지(감사 확정).
 * bestApplyUrl과 동일 분기: 복지로 딥링크(②)면 원 라벨 유지, 정부24 검색 폴백(③)이면 '정부24에서 검색해 신청'.
 * (기존엔 검색으로 착지하면서도 라벨은 '복지로에서 신청'으로 남아 사용자가 헤매던 문제.)
 */
export function bestApplyLabel(application: string, policyName?: string): string {
  const link = applyLink(application)
  if (policyName && KNOWN_APPLY_URLS[policyName] && isGenericHome(link.url)) return link.label
  if (policyName && isGenericHome(link.url) && !link.label.includes('주민센터')) return '정부24에서 검색해 신청'
  return link.label
}

export interface OneTapResult {
  /** 클립보드 복사 성공 여부(안내 문구 분기용) */
  copied: boolean
  /** 새 탭이 실제로 열렸는지 — 팝업 차단이면 false(허위 '이동했어요' 안내 방지) */
  opened: boolean
  /** 연 (또는 열려던) 공식 신청 URL — 차단 시 직접 이동 링크로 재사용 */
  url: string
}

export async function oneTapApply(application: string, policyName: string | undefined, profile: UserProfile | null, rpaInfo?: RpaInfo): Promise<OneTapResult> {
  const url = bestApplyUrl(application, policyName)
  // ⚠️ 순서가 핵심(적대 감사 확정 결함): clipboard.writeText는 '문서가 포커스된 동안' 개시해야 한다.
  //    window.open('_blank')은 새 탭으로 포커스를 옮기므로, open 뒤에 writeText하면 크롬이
  //    'Document is not focused'로 거부해 이름 복사가 조용히 실패했다. 그래서 ① 복사를 '개시'(await 금지)
  //    → ② window.open을 동기 호출(팝업 제스처 체인 유지) → ③ 마지막에 복사 프라미스 정리 순으로 한다.
  // 정부 신청서는 필드별 input이라 '이름' 값만 복사하고 나머지는 신청 키트에서 항목별 복사(정직한 한 번-붙여넣기).
  // 이름이 비어 있으면(새로고침 후 기본 상태) 복사하지 않는다 — 다른 값을 이름이라 안내하는 오류 방지.
  let copyPromise: Promise<void> | null = null
  try {
    const name = buildPrefill(profile, rpaInfo).find((f) => f.label === '이름')
    if (name) copyPromise = navigator.clipboard?.writeText(name.value) ?? null
  } catch { /* 클립보드 미지원/비허용 환경은 무시 */ }
  // ⚠️ features에 'noopener'를 넣으면 스펙상 성공해도 null을 반환해 팝업 차단을 감지할 수 없다 —
  //    핸들을 받아 opener를 수동 절단(동등한 보안)하고, null일 때만 진짜 차단으로 판정한다.
  let opened = false
  try {
    const w = window.open(url, '_blank')
    if (w) {
      try { w.opener = null } catch { /* 크로스오리진 등 — 절단 실패해도 진행 */ }
      opened = true
    }
  } catch { /* 팝업 차단 등 */ }
  let copied = false
  try { if (copyPromise) { await copyPromise; copied = true } } catch { /* 클립보드 미지원/비허용 환경은 무시 */ }
  return { copied, opened, url }
}
