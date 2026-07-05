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
export async function oneTapApply(application: string, profile: UserProfile | null, rpaInfo?: RpaInfo): Promise<boolean> {
  // ⚠️ 새 탭은 사용자 제스처 안에서 '먼저' 열어야 한다. clipboard await 뒤에 open하면 제스처 체인이
  //    끊겨 모바일 Safari 등에서 팝업이 차단된다 → 반드시 window.open을 동기적으로 먼저 호출.
  try {
    window.open(applyLink(application).url, '_blank', 'noopener,noreferrer')
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
