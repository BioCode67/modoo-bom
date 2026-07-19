/**
 * 🌱 새싹이 가이드 문구 — 화면·상태별 '지금 뭘 하면 되는지' 한 문장.
 *
 * 추천까지는 좋은데 '거기서 뭘 눌러야 하는지' 헷갈리는 문제(사용자 피드백)를
 * 화면 구석의 새싹이가 다음 행동 한 가지로 좁혀 안내한다. 홈은 히어로의 큰 새싹이가
 * 이미 안내하므로 null(가이드 미표시) — 겹치면 소음이다.
 */

export interface GuideCtx {
  /** 분석 결과가 나와 있는지 */
  hasResult: boolean
  /** 나의 복지에 담긴 혜택 수 */
  trackedCount: number
  /** 데스크탑 에이전트(자동발급) 연결 여부 */
  agentOn: boolean
}

export function guideTip(view: string, ctx: GuideCtx): string | null {
  switch (view) {
    case 'analyze':
      return ctx.hasResult
        ? '결과가 나왔어요! 마음에 드는 혜택은 ♡ 담기 — 담아두면 서류·신청까지 챙겨드려요.'
        : '몇 가지만 알려주시면 받을 수 있는 혜택을 골라드려요. 정확하지 않아도 괜찮아요!'
    case 'explore':
      return '상황으로 검색해도 돼요 — 예: "청년 월세". 마음에 드는 복지는 ♡로 담아두세요.'
    case 'my':
      if (ctx.trackedCount === 0) return '아직 담은 혜택이 없어요 — 분석·탐색에서 ♡를 누르면 여기에 모여요.'
      return ctx.agentOn
        ? '서류 도우미의 🚀 버튼 하나로 발급부터 신청까지 이어드려요 — 인증만 폰에서 눌러주세요!'
        : '서류 도우미가 필요한 서류와 발급 경로를 알려드려요. 신청 키트로 바로 신청할 수 있어요.'
    default:
      return null // 홈 등 — 미표시
  }
}
