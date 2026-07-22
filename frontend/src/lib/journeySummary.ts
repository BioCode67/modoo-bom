/** 여정(연쇄발급) 종결 요약 — '어떻게 끝났는지'를 정직하게 한 줄로 조립한다.
 *
 * 이 로직은 정직성 규칙을 다수 인코딩하고 있어 조용히 깨지기 쉽다 → 순수 함수로 추출해 회귀 락한다:
 * · 발급 집계는 실제 저장(saved_path)이 확인된 서류 단계만 — status=done 이어도 파일이 없으면 세지 않는다.
 * · 신청은 result.success===true 인 것만 '양식 준비', 그 외 done/completed 는 '직접 진행 필요'(manual)로.
 * · '🔑 정부24 N건 로그인 1회'는 백엔드가 정직하게 센 one_login && gov_login_docs>1 일 때만 표기.
 */
export interface JourneyStep {
  kind?: string
  status: string
  saved_path?: string
  success?: boolean
}

export interface JourneySummary {
  text: string
  issued: number
}

const DONE = ['done', 'completed']

/** 종결 상태 + 단계들로 요약 문구와 실발급 건수를 만든다. */
export function summarizeJourney(
  steps: JourneyStep[],
  status: string,
  opts: { oneLogin?: boolean; govLoginDocs?: number } = {},
): JourneySummary {
  const s = steps || []
  const oneLogin = !!opts.oneLogin
  const govLoginDocs = Number(opts.govLoginDocs || 0)
  const issued = s.filter((sp) => sp.kind !== 'apply' && sp.saved_path).length
  const skipped = s.filter((sp) => sp.status === 'cancelled').length
  const prepared = s.filter((sp) => sp.kind === 'apply' && DONE.includes(sp.status) && sp.success === true).length
  const manual = s.filter((sp) => sp.kind === 'apply' && DONE.includes(sp.status) && sp.success !== true).length
  const parts = [
    issued > 0 ? `서류 ${issued}건 발급${oneLogin && govLoginDocs > 1 ? ` (🔑 정부24 ${govLoginDocs}건 로그인 1회)` : ''}` : '',
    skipped > 0 ? `${skipped}건 건너뜀` : '',
    prepared > 0 ? `신청 양식 ${prepared}건 준비(제출은 본인 확인 후)` : '',
    manual > 0 ? `신청 ${manual}건 직접 진행 필요` : '',
  ].filter(Boolean)
  const head = status === 'completed'
    ? (manual > 0 ? '⚠️ 서류 발급 완료 · 신청 확인 필요' : '✅ 연쇄 자동발급 끝')
    : status === 'cancelled' ? '⏹ 연쇄 중단됨' : '⚠️ 연쇄가 오류로 끝났어요'
  return { text: parts.length ? `${head} — ${parts.join(' · ')}` : head, issued }
}

/** 신청 단계 중 '직접 진행 필요'(success 아님) 건수 — 탭 제목 배지 판정용(요약과 동일 기준). */
export function manualApplyCount(steps: JourneyStep[]): number {
  return (steps || []).filter((sp) => sp.kind === 'apply' && DONE.includes(sp.status) && sp.success !== true).length
}

/** 탭 제목 배지 문구 — 완료(직접 진행 신청 0)면 완료, 아니면 확인 필요. */
export function journeyTitleBadge(status: string, manualApplications: number): string {
  return status === 'completed' && manualApplications === 0
    ? '✅ 연쇄 발급 완료 — 모두봄'
    : '⚠️ 연쇄 발급 확인 필요 — 모두봄'
}
