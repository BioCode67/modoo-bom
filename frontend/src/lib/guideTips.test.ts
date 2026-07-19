import { describe, expect, it } from 'vitest'
import { guideTip } from './guideTips'

const ctx = (o: Partial<{ hasResult: boolean; trackedCount: number; agentOn: boolean }> = {}) => ({
  hasResult: false, trackedCount: 0, agentOn: false, ...o,
})

describe('guideTip — 화면·상태별 다음 행동 안내', () => {
  it('홈은 null(히어로 새싹이와 중복 안내 금지)', () => {
    expect(guideTip('home', ctx())).toBeNull()
  })
  it('분석: 결과 전엔 입력 격려, 결과 후엔 ♡ 담기 안내', () => {
    expect(guideTip('analyze', ctx())).toContain('알려주시면')
    expect(guideTip('analyze', ctx({ hasResult: true }))).toContain('♡ 담기')
  })
  it('탐색: 상황 검색 + 담기 안내', () => {
    expect(guideTip('explore', ctx())).toContain('검색')
  })
  it('나의 복지: 빈 상태→담기 유도, 에이전트 연결→🚀 원클릭, 웹→서류 도우미·신청 키트', () => {
    expect(guideTip('my', ctx())).toContain('아직 담은 혜택이 없어요')
    expect(guideTip('my', ctx({ trackedCount: 2, agentOn: true }))).toContain('🚀')
    const web = guideTip('my', ctx({ trackedCount: 2 }))
    expect(web).toContain('서류 도우미')
    expect(web).not.toContain('🚀') // 에이전트 없는 웹에서 자동화를 과장하지 않는다
  })
  it('미지의 view는 null(안전)', () => {
    expect(guideTip('unknown', ctx())).toBeNull()
  })
})
