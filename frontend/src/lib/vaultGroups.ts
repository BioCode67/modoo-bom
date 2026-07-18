/**
 * 서류함 종류별 그룹핑 — '발급물이 저절로 정리되는' 서류함의 표시 계층.
 *
 * 같은 서류를 여러 번 발급하면(리허설·재발급) 평면 목록에선 등본이 3~4줄씩 쌓여
 * 정작 최신본이 뭔지 한눈에 안 보인다. 묶음 ZIP·자동첨부는 이미 '종류별 최신 1건'
 * 기준으로 돌므로, 화면도 같은 기준으로: 종류당 최신본 1줄 + 이전 버전은 접힘.
 *
 * 규칙:
 *  · doc_type 이 같은 파일끼리 한 그룹. 그룹 안은 mtime 내림차순(최신이 latest).
 *  · 그룹 순서는 '그룹 최신본의 mtime' 내림차순 — 방금 발급한 종류가 맨 위.
 *  · 입력 정렬에 의존하지 않는다(서버가 최신순을 주지만 방어적으로 재정렬).
 */

export interface VaultGroupable {
  doc_type: string
  mtime: number
  filename: string
}

export interface VaultGroup<T extends VaultGroupable> {
  type: string
  latest: T
  older: T[]
}

export function groupVaultDocs<T extends VaultGroupable>(docs: T[]): VaultGroup<T>[] {
  const byType = new Map<string, T[]>()
  for (const d of docs || []) {
    const key = d.doc_type || d.filename // doc_type이 빈 파일은 자기 자신이 한 그룹(합쳐서 오분류 금지)
    const arr = byType.get(key)
    if (arr) arr.push(d)
    else byType.set(key, [d])
  }
  const groups: VaultGroup<T>[] = []
  for (const [type, arr] of byType) {
    const sorted = [...arr].sort((a, b) => b.mtime - a.mtime)
    groups.push({ type, latest: sorted[0], older: sorted.slice(1) })
  }
  groups.sort((a, b) => b.latest.mtime - a.latest.mtime)
  return groups
}
