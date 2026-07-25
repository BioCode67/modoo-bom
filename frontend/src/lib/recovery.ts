import type { Explanation } from '@/lib/explainEligibility'

/**
 * 반려·탈락 대응 가이드 — '지금은 대상이 아니에요' 다음에 무엇을 할지 구체적 경로를 준다.
 *
 * explainEligibility 가 '왜 안 되는지'(blocker)를 알려주면, 여기선 '그래서 어떻게 하나'를
 * 사유별로 안내한다. 소득만 아까우면 재신청 조건을, 대상이 다르면 대체 복지를, 접수 중단이면
 * 알림·유사 복지를 제시한다. + 실제 신청 후 반려 시의 이의신청 권리(잘 안 알려짐)를 알린다.
 *
 * 정직성: 이 판정은 신청 전 '추정'이지 공식 처분이 아니므로, 이의신청은 '실제 반려 통지를 받은
 * 경우'로 조건을 분명히 한다(오해 방지). 90일 이내 이의신청은 안정적인 법적 사실.
 */

export interface RecoveryStep {
  icon: string
  title: string
  detail: string
}

export interface RecoveryPlan {
  steps: RecoveryStep[]
  appeal: { title: string; detail: string }
}

/** 부적격 설명(Explanation)에서 대응 경로를 만든다. 적격·요약형·사유불명이면 null. */
export function recoveryPlan(ex: Explanation): RecoveryPlan | null {
  if (ex.eligible || ex.mode !== 'precise' || ex.blocker === null) return null

  const steps: RecoveryStep[] = []
  switch (ex.blocker) {
    case 'income':
      if (ex.fixableByIncome) {
        steps.push({ icon: '📉', title: '소득이 줄면 다시 대상', detail: `소득인정액이 상한(하위 ${ex.ceiling}%) 이하가 되면 신청할 수 있어요. 소득인정액은 신청할 때마다 다시 계산돼요.` })
        steps.push({ icon: '🧮', title: '정밀 계산으로 확인', detail: '소득인정액 계산기로 재산·부채를 반영해 정확한 여유를 확인하세요.' })
      } else {
        steps.push({ icon: '🏠', title: '재산 공제 확인', detail: '부채·기본재산액 공제를 빠뜨리지 않았는지 확인하세요. 재산 환산이 크면 소득이 낮아도 초과될 수 있어요.' })
      }
      steps.push({ icon: '🤝', title: '차상위·완화 기준 복지', detail: '기준이 더 완화된(차상위 등) 복지가 있는지 확인하세요.' })
      break
    case 'demographic':
      steps.push({ icon: '🔍', title: '비슷한 다른 복지 찾기', detail: '대상 요건이 다른, 내게 맞는 복지를 탐색에서 찾아보세요.' })
      steps.push({ icon: '📅', title: '조건이 바뀌면 재신청', detail: '연령 도래·상황 변화(출산·실직 등)로 대상이 될 수 있어요. 사후관리에서 챙겨드려요.' })
      break
    case 'intake':
      steps.push({ icon: '🔔', title: '재개 공고 알림', detail: '신규 접수가 다시 열릴 때를 대비해 관심 목록에 담아두세요.' })
      steps.push({ icon: '🔍', title: '대체 복지 찾기', detail: '지금 신청할 수 있는 유사 복지를 탐색에서 찾아보세요.' })
      break
    default:
      steps.push({ icon: '☎️', title: '주민센터 상담', detail: '세부 조건은 담당 주민센터·기관에서 정확히 확인하는 게 확실해요.' })
  }

  return {
    steps,
    appeal: {
      title: '반려됐다면 이의신청',
      detail: '실제로 신청했다가 반려 통지를 받았다면, 통지받은 날부터 90일 이내에 이의신청(행정심판)을 할 수 있어요.',
    },
  }
}
