import { describe, it, expect, beforeEach, vi } from 'vitest'

// node 테스트 환경에는 sessionStorage가 없다 → Map 기반 목을 전역에 스텁해
// '실제 저장 경로'(직렬화·손상 복구·TTL)를 검증한다(메모리 폴백이 아니라).
const mem = new Map<string, string>()
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
})

import { rememberLive, forgetLive, listLive, clearLive } from './liveTasks'

const KEY = 'modoobom-live-v1'

describe('liveTasks — 진행 중 태스크 세션 연속성', () => {
  beforeEach(() => { clearLive(); mem.clear() })

  it('기억 → 나열 → 종결 제거', () => {
    rememberLive('doc', '주민등록등본', { taskId: 't1', token: 'tok1' })
    rememberLive('apply', 'POL-009', { taskId: 't2', token: 'tok2' })
    expect(listLive('doc')['주민등록등본'].taskId).toBe('t1')
    expect(listLive('apply')['POL-009'].token).toBe('tok2')
    forgetLive('doc', '주민등록등본')
    expect(listLive('doc')['주민등록등본']).toBeUndefined()
    expect(listLive('apply')['POL-009']).toBeTruthy() // 다른 kind 는 영향 없음
  })

  it('journey 는 수락 서류 목록을 함께 보관(복원 시 카드 매핑용)', () => {
    rememberLive('journey', 'current', { taskId: 'j1', token: 'jt', docs: ['주민등록등본', '가족관계증명서'] })
    expect(listLive('journey')['current'].docs).toEqual(['주민등록등본', '가족관계증명서'])
  })

  it('TTL(45분) 지난 항목은 복원 대상에서 제외', () => {
    rememberLive('doc', '오래된서류', { taskId: 'old', token: '' })
    const raw = JSON.parse(mem.get(KEY)!)
    raw.doc['오래된서류'].at = Date.now() - 46 * 60 * 1000 // 저장 시각을 과거로(만료 시뮬레이션)
    mem.set(KEY, JSON.stringify(raw))
    expect(listLive('doc')['오래된서류']).toBeUndefined()
  })

  it('깨진 저장값에도 크래시 없이 빈 상태로 복구', () => {
    mem.set(KEY, '{broken json')
    expect(listLive('doc')).toEqual({})
    mem.set(KEY, JSON.stringify({ doc: { x: { bogus: true } } }))
    expect(listLive('doc')).toEqual({}) // 형식 불일치 항목은 걸러짐
  })
})
