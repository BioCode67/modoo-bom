/**
 * 정직 신뢰 라벨 — 각 정책의 '출처·검증 근거'를 정책 id 접두사로 판별해 투명하게 표기한다.
 * 경쟁 서비스(AI 생성 콘텐츠의 환각 리스크)와 달리, 모두봄은 공식 정보를 있는 그대로 안내하고
 * '실제 자격은 행정 심사로 확정'임을 정직하게 밝힌다(과장·추정 없음 — 프로젝트 정직성 원칙).
 */
export interface TrustInfo {
  source: string
  verified: boolean // 큐레이션 실측 검증 여부
  note: string
}

export function trustInfo(id: string): TrustInfo {
  if (/^PRV-/.test(id)) return { source: '민간재단 공식 공고 실측 검증(2026)', verified: true, note: '심사·선발형 — 신청해도 선발 여부는 재단이 결정해요.' }
  if (/^HOU-/.test(id)) return { source: '공식 모집공고 게시판 실검증(2026)', verified: true, note: '모집 시기·소득 요건은 해당 공고에서 확정돼요.' }
  if (/^SUP-/.test(id)) return { source: '정부 공식 자료 실측 검증(2026)', verified: true, note: '금액·요건은 연도별로 바뀔 수 있어 공식 안내를 함께 확인하세요.' }
  if (/^POL-/.test(id)) return { source: '보건복지부 등 공식 기준 검증(2026)', verified: true, note: '' }
  if (/^LOC-/.test(id)) return { source: '공공데이터 · 지자체 제공(요약)', verified: false, note: '자세한 요건은 관할 지자체에서 확인하세요.' }
  if (/^GOV-/.test(id)) return { source: '공공데이터 · 중앙부처(한국사회보장정보원)', verified: false, note: '' }
  return { source: '공식 자료 기준', verified: false, note: '' }
}
