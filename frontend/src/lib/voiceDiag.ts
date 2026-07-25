import type { AnalysisResult } from '@/lib/welfare-engine'
import { formatWon, sumCashMonthly } from '@/lib/format'
import { matchAutopilotIntent, matchIssueAllIntent, matchIssueIntent } from '@/lib/chatAgent'
import { profileSignalCount } from '@/lib/parseQuery'

/**
 * 📞 통화 '말→즉시 진단' 판정·브리핑 순수 로직 — VoiceCall에서 분리(테스트 가능).
 *
 * 원칙:
 * - 실행 명령("등본 떼줘"·"전부 발급해줘"·"알아서 다 해줘")은 진단 분기가 삼키지 않는다 —
 *   챗위젯과 동일한 인텐트 우선순위(오토파일럿 → 전부발급 → 단건 발급 → 나머지).
 *   "65세 혼자 사는데 등본 떼줘"는 프로필 신호 2개라 진단감이지만, 사용자의 의도는 발급이다.
 * - 낭독하는 개수는 결과 화면 헤더와 '같은 기준'(정밀추천 POL-) — 저신뢰 '관련 복지'
 *   (GOV/LOC 추론·심사선발형 PRV·대출 FIN)까지 합친 전체 개수를 말하면 말과 화면이 어긋난다(정직성).
 */

/**
 * 실행 의도(오토파일럿·전부발급·서류 지목 발급) 여부 — agentReply의 게이트와 동일 구조로 판정.
 * issueDocs가 비면 발급 계열은 실제 응답(issueReply 등)이 나올 수 없으므로 실행 의도로 치지 않는다
 * (진단만 눌러놓고 정작 발급 응답이 안 나오는 어긋남 방지).
 */
export function hasVoiceExecIntent(q: string, agentOn: boolean, issueDocs: string[]): boolean {
  if (!agentOn) return false
  if (matchAutopilotIntent(q)) return true
  if (!issueDocs.length) return false
  return matchIssueAllIntent(q) || !!matchIssueIntent(q, issueDocs)
}

/**
 * 통화 진단 분기 발동 여부 — 프로필 신호가 2개 이상인 '상황 문장'이어도
 * 명시적 실행 명령이 섞여 있으면 false(발급·오토파일럿 경로로 흘려보낸다 — 챗위젯 순서 파리티).
 */
export function shouldVoiceDiagnose(q: string, agentOn: boolean, issueDocs: string[]): boolean {
  if (hasVoiceExecIntent(q, agentOn, issueDocs)) return false
  return profileSignalCount(q) >= 2
}

/**
 * 진단 결과 음성 브리핑 문구.
 * - 개수는 결과 화면 헤더(ResultsView primary.length)·voiceBriefing과 같은 정밀추천(POL-) 기준 —
 *   관련 복지는 "그 밖에 M개" 한정어 한 문장으로만(정보 손실 없이 말·화면 숫자 일치).
 * - 금액은 결과 화면 헤더와 '같은 기준'의 보수 합산(정밀추천 POL- 중 강력추천의 현금성만) —
 *   portfolio_summary.total_monthly(전체 적격 이론 최대)를 읽어주면 화면(64만)과 통화(228만)가
 *   3배 넘게 어긋나는 과장 안내가 된다(엔진 주석의 'UI 헤드라인 금지' 값).
 */
export function buildVoiceDiagText(res: AnalysisResult): string {
  const eligible = res.eligible_policies ?? []
  const primary = eligible.filter((p) => /^POL-/.test(p.id))
  const base = primary.length ? primary : eligible
  const top = base.slice(0, 3).map((p) => p.name)
  const monthly = sumCashMonthly(primary.filter((p) => p.priority === 'high'))
  const related = eligible.length - base.length
  return (
    `말씀하신 상황으로 바로 찾아봤어요. 지금 신청해볼 만한 복지가 ${base.length}개 있어요.\n` +
    `대표적으로 ${top.join(', ')} 이에요.` +
    (related > 0 ? `\n그 밖에 살펴볼 만한 관련 복지도 ${related}개 있어요.` : '') +
    (monthly > 0 ? `\n핵심 현금지원만 적게 잡아 더하면 월 ${formatWon(monthly)} 정도예요 — 실제 조건·중복수급에 따라 달라질 수 있어요.` : '') +
    `\n자세한 자격과 신청 방법은 결과 화면에서 하나씩 짚어드릴게요.`
  )
}
