import { buildPrefill, prefillText, type RpaInfo } from '@/lib/prefill'
import { applyLink } from '@/lib/officialLinks'
import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 원터치 신청 이동(무설치·전 브라우저·모바일) — 가장 매끄럽고 안전한 신청 경로.
 *  ① 내 정보(이름·생년월일·연락처)를 클립보드에 자동 복사(공식 신청서에 바로 붙여넣기)
 *  ② 공식 신청 페이지를 새 탭으로 즉시 열기(딥링크) → 사용자는 정부 공식 사이트에서 간편인증만.
 * 개인정보·본인인증은 정부 공식 사이트에만 머문다(우리 서버 전송 없음 — 안전).
 * @returns 클립보드 복사 성공 여부(안내 문구 분기용)
 */
// 일반 홈으로만 연결되는 URL(딥링크 없음) — 이 경우 정책명으로 공식 검색 결과로 보낸다.
const GENERIC_HOME = new Set([
  'https://www.bokjiro.go.kr', 'https://www.gov.kr/portal/main', 'https://www.work24.go.kr',
])

/**
 * 신청 시 열 최적 URL — 딥링크가 있으면 그대로, 없으면(일반 홈) 정책명으로 정부24 통합검색 결과로.
 * (홈에서 사용자가 서비스를 못 찾고 헤매는 것을 방지 — 66%의 큐레이션 정책이 일반 홈 착지였음)
 */
export function bestApplyUrl(application: string, policyName?: string): string {
  const url = applyLink(application).url
  if (policyName && GENERIC_HOME.has(url)) {
    return `https://www.gov.kr/search?srhQuery=${encodeURIComponent(policyName)}`
  }
  return url
}

export async function oneTapApply(application: string, policyName: string | undefined, profile: UserProfile | null, rpaInfo?: RpaInfo): Promise<boolean> {
  // ⚠️ 새 탭은 사용자 제스처 안에서 '먼저' 열어야 한다. clipboard await 뒤에 open하면 제스처 체인이
  //    끊겨 모바일 Safari 등에서 팝업이 차단된다 → 반드시 window.open을 동기적으로 먼저 호출.
  try {
    window.open(bestApplyUrl(application, policyName), '_blank', 'noopener,noreferrer')
  } catch { /* 팝업 차단 등 */ }
  let copied = false
  try {
    const fields = buildPrefill(profile, rpaInfo)
    if (fields.length) {
      await navigator.clipboard.writeText(prefillText(fields))
      copied = true
    }
  } catch { /* 클립보드 미지원/비허용 환경은 무시 */ }
  return copied
}
