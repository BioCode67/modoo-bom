import { describe, it, expect } from 'vitest'
import { mergeTracked } from './sync'
import type { TrackedItem } from '@/store/useAppStore'

const mk = (over: Partial<TrackedItem>): TrackedItem => ({
  policyId: 'POL-001', name: '기초연금', category: '노인', status: 'tracking',
  savedAt: 1000, checkedDocs: [], ...over,
})

describe('mergeTracked', () => {
  it('서로 다른 정책은 합집합', () => {
    const local = [mk({ policyId: 'A' })]
    const cloud = [mk({ policyId: 'B' })]
    const m = mergeTracked(local, cloud)
    expect(m.map((t) => t.policyId).sort()).toEqual(['A', 'B'])
  })

  it('같은 정책은 더 최근에 손댄 쪽 우선(클라우드가 최신)', () => {
    const local = [mk({ policyId: 'A', status: 'tracking', savedAt: 1000 })]
    const cloud = [mk({ policyId: 'A', status: 'applied', savedAt: 1000, appliedAt: 5000 })]
    const m = mergeTracked(local, cloud)
    expect(m).toHaveLength(1)
    expect(m[0].status).toBe('applied') // 클라우드(점검 시점 더 최근)가 이김
  })

  it('같은 정책은 더 최근에 손댄 쪽 우선(로컬이 최신)', () => {
    const local = [mk({ policyId: 'A', status: 'done', appliedAt: 9000 })]
    const cloud = [mk({ policyId: 'A', status: 'applied', appliedAt: 5000 })]
    const m = mergeTracked(local, cloud)
    expect(m[0].status).toBe('done')
  })

  it('동률이면 로컬 유지', () => {
    const local = [mk({ policyId: 'A', status: 'tracking', savedAt: 3000 })]
    const cloud = [mk({ policyId: 'A', status: 'idle', savedAt: 3000 })]
    expect(mergeTracked(local, cloud)[0].status).toBe('tracking')
  })

  it('빈 입력 안전', () => {
    expect(mergeTracked([], [])).toEqual([])
    expect(mergeTracked([mk({ policyId: 'A' })], [])).toHaveLength(1)
    expect(mergeTracked([], [mk({ policyId: 'B' })])).toHaveLength(1)
  })

  it('잘못된 항목(policyId 없음)은 무시', () => {
    const local = [mk({ policyId: '' }), mk({ policyId: 'A' })]
    expect(mergeTracked(local, [])).toHaveLength(1)
  })
})
