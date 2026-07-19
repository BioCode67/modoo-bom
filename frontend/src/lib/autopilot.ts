/**
 * 🚀 오토파일럿 실행 — 분석 결과의 정밀 추천(POL-)을 전부 담고 '나의 복지'로 이동해,
 * 서류 도우미가 원클릭 연쇄(발급→자동신청 준비→제출 직전 정지)를 이어받게 한다(issueBridge).
 * 결과 화면 버튼·챗·통화가 같은 흐름을 공유하는 단일 진입점. 본인인증·최종 제출은 항상 사용자 직접.
 */
import { useAppStore } from '@/store/useAppStore'
import { requestIssueAll } from './issueBridge'

/** 결과가 없으면 false — 호출부가 '분석 먼저' 안내로 폴백한다(빈 담기·빈 연쇄 방지). */
export function startAutopilot(): boolean {
  const s = useAppStore.getState()
  const primary = (s.result?.eligible_policies || []).filter((p) => p.id.startsWith('POL-'))
  if (!primary.length) return false
  for (const p of primary) if (!s.isSaved(p.id)) s.toggleSaved({ id: p.id, name: p.name, category: p.category })
  requestIssueAll()
  s.setView('my')
  return true
}
