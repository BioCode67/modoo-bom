import { describe, expect, it } from 'vitest'
import { guideTip } from './guideTips'

const ctx = (o: Partial<{ hasResult: boolean; trackedCount: number; agentOn: boolean; docsIssued: boolean; appliedCount: number }> = {}) => ({
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
  it('나의 복지: 서류 준비 후엔 다음 행동을 [자동 신청]으로 콕 집어준다(그다음 헷갈림 해소·로봇 이모지 없이)', () => {
    const ready = guideTip('my', ctx({ trackedCount: 2, agentOn: true, docsIssued: true }))
    expect(ready).toContain('자동 신청')
    expect(ready).toContain('자동 첨부')
  })
  it('나의 복지: 신청까지 시작했으면 "최종 제출만"으로 마무리 안내(다시 발급 유도 금지)', () => {
    const done = guideTip('my', ctx({ trackedCount: 2, agentOn: true, docsIssued: true, appliedCount: 1 }))
    expect(done).toContain('최종 제출')
    expect(done).not.toContain('자동 신청') // 이미 신청한 사람에게 또 신청하라 하지 않는다
  })
  it('미지의 view는 null(안전)', () => {
    expect(guideTip('unknown', ctx())).toBeNull()
  })
})
