import { describe, it, expect } from 'vitest'
import { computeJourney } from './journey'
import type { TrackedItem } from '@/store/useAppStore'

const item = (over: Partial<TrackedItem> = {}): TrackedItem => ({
  policyId: 'POL-1', name: '테스트', category: '기타', status: 'idle', savedAt: 0, checkedDocs: [], ...over,
})

describe('computeJourney', () => {
  it('아무것도 없으면 찾기 단계', () => {
    const j = computeJourney([], {})
    expect(j.current).toBe('find')
    expect(j.done.find).toBe(false)
  })
  it('분석 결과만 있어도 찾기는 완료로', () => {
    expect(computeJourney([], {}, true).current).toBe('docs')
  })
  it('담아뒀지만 서류 준비 전이면 서류 단계', () => {
    const j = computeJourney([item()], {})
    expect(j.current).toBe('docs')
    expect(j.done.find).toBe(true)
    expect(j.done.docs).toBe(false)
  })
  it('서류를 체크했으면 신청 단계', () => {
    const j = computeJourney([item({ checkedDocs: ['주민등록등본'] })], {})
    expect(j.current).toBe('apply')
    expect(j.done.docs).toBe(true)
  })
  it('서류 도우미 발급(docDone)만으로도 서류 완료', () => {
    const j = computeJourney([item()], { 주민등록등본: 123 })
    expect(j.done.docs).toBe(true)
    expect(j.current).toBe('apply')
  })
  it('신청 완료면 관리 단계', () => {
    const j = computeJourney([item({ status: 'applied', checkedDocs: ['x'] })], {})
    expect(j.current).toBe('manage')
    expect(j.done.apply).toBe(true)
  })
  it('수급 중도 관리 단계(신청 완료로 간주)', () => {
    expect(computeJourney([item({ status: 'done', checkedDocs: ['x'] })], {}).current).toBe('manage')
  })
  it('관리는 계속 지켜보는 단계라 done 아님', () => {
    expect(computeJourney([item({ status: 'applied', checkedDocs: ['x'] })], {}).done.manage).toBe(false)
  })
  it('필요 서류가 없으면(공공데이터만 담음) 서류 단계 건너뛰고 신청으로', () => {
    const j = computeJourney([item()], {}, false, /* needsDocs */ false)
    expect(j.done.docs).toBe(true) // 서류 자동 완료(건너뜀)
    expect(j.current).toBe('apply') // 막히지 않고 신청 단계로
  })
  it('필요 서류가 있으면(기본) 서류 단계에 머문다', () => {
    const j = computeJourney([item()], {}, false, /* needsDocs */ true)
    expect(j.done.docs).toBe(false)
    expect(j.current).toBe('docs')
  })
})
