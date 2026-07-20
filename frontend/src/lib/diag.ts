// 🔬 진단 복사 — 발급/신청이 안 될 때 개발자에게 붙여넣는 한 덩어리를 만든다.
//   기술정보(_diag: 버전·태스크 상태·최근 오류, PII 무포함) + '실패 화면 구조'(_diagnostics/latest:
//   막힌 실화면의 접근성 트리·마커·URL, 값 없음)를 합쳐, 사용자가 스크린샷 대신 이 한 번의 복사로
//   접속 못 하는 실화면을 개발자에게 정확히 전달하게 한다. (AgentStatusStrip·DocumentCenter 공용)
import { getRpaBase } from '@/lib/backend'

/** 기술정보 + 실패 화면 구조를 합친 진단 텍스트를 만든다. 실패 진단이 없으면 기술정보만. */
export async function buildAgentDiagnostic(): Promise<string> {
  let tech: unknown = null
  try {
    const r = await fetch(`${getRpaBase()}/api/_diag`)
    tech = await r.json()
  } catch { /* 로컬 에이전트 미연결 등 — 빈 진단 */ }
  let scene: unknown = null
  try {
    const rs = await fetch(`${getRpaBase()}/api/_diagnostics/latest`)
    const js = await rs.json()
    if (js && js.available) scene = js
  } catch { /* 저장된 실패 진단 없음 — 기술정보만 */ }
  const parts = [`[모두봄 에이전트 진단]\n${JSON.stringify(tech, null, 2)}`]
  if (scene) parts.push(`[실패 화면 구조 — 실화면 접근성 트리·PII 없음]\n${JSON.stringify(scene, null, 2)}`)
  return parts.join('\n\n')
}

/** 진단을 클립보드로 복사. 성공하면 true. (클립보드 미지원·미연결이면 false — 호출부가 조용히 처리) */
export async function copyAgentDiagnostic(): Promise<boolean> {
  try {
    const text = await buildAgentDiagnostic()
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
