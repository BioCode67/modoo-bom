import type { TrackedItem } from '@/store/useAppStore'

/**
 * 복지 여정(journey) — 찾기 → 서류 발급 → 신청 → 상태확인·관리의 4단계.
 * 사용자가 지금 어디쯤인지(current)와 각 단계 완료 여부(done)를 실제 상태에서 도출한다.
 * '나의 복지'가 요소가 많아 길을 잃기 쉬워, 이 지도로 다음 한 걸음만 또렷하게 안내한다.
 */
export type JourneyStage = 'find' | 'docs' | 'apply' | 'manage'
export const JOURNEY_STAGES: JourneyStage[] = ['find', 'docs', 'apply', 'manage']

export interface JourneyState {
  current: JourneyStage
  done: Record<JourneyStage, boolean>
}

/**
 * @param tracked 담아둔 복지(관심·준비·신청·수급)
 * @param docDone 서류 도우미에서 발급 완료로 기억된 서류(정규화명→시각)
 * @param hasResult 분석 결과가 있는지(결과 화면 등에서 '찾기'를 이미 완료로 볼지)
 * @param needsDocs 담은 복지 중 필요 서류가 하나라도 있는지. 공공데이터 정책만 담으면 서류가
 *   전무해(required_docs 빈값) 서류 단계가 진짜로 없으므로, 그 경우 서류를 건너뛰어 여정이 막히지 않게 한다.
 */
export function computeJourney(
  tracked: TrackedItem[],
  docDone: Record<string, number> = {},
  hasResult = false,
  needsDocs = true,
): JourneyState {
  const findDone = tracked.length > 0 || hasResult
  // 서류: 필요 서류가 없으면 자동 완료(건너뜀). 있으면 항목 체크 또는 서류 도우미 발급(docDone)으로 준비된 것으로 본다.
  const docsPrepared = !needsDocs || tracked.some((t) => t.checkedDocs.length > 0) || Object.keys(docDone).length > 0
  const applyDone = tracked.some((t) => t.status === 'applied' || t.status === 'done')

  let current: JourneyStage = 'manage'
  if (!findDone) current = 'find'
  else if (!docsPrepared) current = 'docs'
  else if (!applyDone) current = 'apply'
  else current = 'manage'

  return {
    current,
    // 관리(manage)는 끝나는 단계가 아니라 계속 지켜보는 단계라 done으로 표시하지 않는다.
    done: { find: findDone, docs: docsPrepared, apply: applyDone, manage: false },
  }
}
