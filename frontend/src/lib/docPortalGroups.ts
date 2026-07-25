import { docGuide } from '@/lib/docGuide'

/**
 * 발급처별 묶음 — 필요한 서류를 '같은 사이트에서 뗄 수 있는 것끼리' 묶어, 한 번 로그인으로
 * 여러 장을 연속 발급하도록 안내한다(데스크탑 RPA의 '한 번 인증 연쇄'를 웹에서 손으로 재현).
 *
 * 각 서류의 대표 온라인 발급처(docGuide의 첫 online/app/work 채널)로 그룹핑한다. 방문·은행창구·
 * 본인보관처럼 온라인 배치가 안 되는 서류는 제외한다. 서류가 많은 포털을 먼저 보여줘(로그인 1회
 * 효과가 큰 순) 발급 동선을 최소화한다. 순수 함수 — 온디바이스 계산.
 */

export interface PortalGroup {
  portal: string     // 발급처 이름(예: '정부24')
  url?: string
  docs: string[]     // 이 발급처에서 뗄 수 있는 서류(정식명)
}

/** 서류명 목록을 대표 온라인 발급처로 묶는다(서류 많은 순 정렬) */
export function docPortalGroups(docNames: string[]): PortalGroup[] {
  const map = new Map<string, PortalGroup>()
  for (const name of docNames || []) {
    const g = docGuide(name)
    if (!g) continue
    // 온라인으로 발급 가능한 대표 채널(온라인·앱·고용24 등)만 배치 대상
    const online = g.channels.find((c) => c.method === 'online' || c.method === 'app' || c.method === 'work')
    if (!online) continue
    let grp = map.get(online.label)
    if (!grp) { grp = { portal: online.label, url: online.url, docs: [] }; map.set(online.label, grp) }
    if (!grp.docs.includes(g.name)) grp.docs.push(g.name)
  }
  return [...map.values()].sort((a, b) => b.docs.length - a.docs.length || a.portal.localeCompare(b.portal))
}

/** '한 번 로그인으로 여러 장' 효과가 있는 묶음(2종 이상)만 */
export function batchableGroups(docNames: string[]): PortalGroup[] {
  return docPortalGroups(docNames).filter((g) => g.docs.length >= 2)
}
