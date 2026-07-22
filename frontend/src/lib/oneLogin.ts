/** 정부24 '한 번 로그인' 공유 판정 — 발급 전 CTA 문구가 실제 인증 횟수와 어긋나지 않게 한다.
 *
 * 배경: 연쇄(여정) 자동발급은 **정부24 서류들만** '로그인 1회'를 공유한다
 * (backend rpa/session.py GovSession + orchestrator.gov_login_doc_count). 건보(nhis)·고용24(work24)·
 * 가족관계(대법원 efamily)·국민연금(nps)은 각자 **별도 사이트에서 따로 인증**한다. 그런데 발급 전
 * CTA 문구가 대상에 이들이 섞여 있어도 "한 번 인증으로 이어서"를 무조건 약속하던 오보를 이 헬퍼로
 * 게이팅한다(과장 금지·프로젝트 1순위 원칙). 발급 '후' 요약 배지(one_login/gov_login_docs)는 이미
 * 백엔드에서 정직하게 카운트하며, 이 파일은 그 판정을 발급 '전' 클라이언트에서 미러링한다.
 */
import { isRpaSupported } from './officialLinks'

// 정부24 로그인을 공유하지 '않는' 서류 — 각자 별도 사이트에서 인증. (백엔드 gov24 타입에서 제외되는
//   대상과 정합: efamily 가족관계·nhis 자격득실·work24 고용보험·nps 국민연금.)
//   ⚠️ '건강보험료 납부확인서'는 정부24 발급이라 여기 걸리면 안 된다 → 자격/득실이 있는 것만 nhis.
const SEPARATE_AUTH: ((d: string) => boolean)[] = [
  (d) => d.includes('건강보험') && (d.includes('자격') || d.includes('득실')), // 건보(nhis)
  (d) => d.includes('고용보험') || d.includes('피보험자격'),                    // 고용24(work24)
  (d) => d.includes('가족관계'),                                                 // 대법원 efamily(별도 인증)
  (d) => d.includes('국민연금') || (d.includes('연금') && d.includes('가입')),   // 국민연금(nps)
]

/** 별도 사이트에서 따로 인증해야 하는 서류인가(정부24 공유 로그인 대상 아님). */
export function isSeparateAuthDoc(doc: string): boolean {
  const d = (doc || '').replace(/\s/g, '')
  return SEPARATE_AUTH.some((f) => f(d))
}

/** 주어진 서류들 중 '정부24 로그인 1회'를 실제로 공유하는 서류 수.
 *  RPA 자동발급 지원(정부24 경로) + 별도 인증 서류 제외. 이 수가 2 이상일 때만 '한 번 인증' 주장이 정직하다. */
export function sharedGovLoginCount(docs: string[]): number {
  return (docs || []).filter((d) => isRpaSupported(d) && !isSeparateAuthDoc(d)).length
}

/** 발급 전 CTA 문구 — 정부24 서류가 2종 이상 공유될 때만 '한 번 인증', 아니면 '각 기관에서 차례로'. */
export function oneLoginNote(count: number): string {
  return count >= 2 ? '정부24 서류는 한 번 인증으로 이어서' : '각 기관에서 차례로 인증해요'
}
