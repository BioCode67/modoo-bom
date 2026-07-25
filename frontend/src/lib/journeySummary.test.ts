import { describe, it, expect } from 'vitest'
import { summarizeJourney, manualApplyCount, type JourneyStep } from './journeySummary'

const doc = (status: string, saved_path?: string): JourneyStep => ({ kind: 'doc', status, saved_path })
const apply = (status: string, success?: boolean): JourneyStep => ({ kind: 'apply', status, success })

describe('summarizeJourney — 정직성 규칙 회귀 락', () => {
  it('발급은 saved_path 있는 서류만 센다(status=done 이어도 파일 없으면 제외)', () => {
    const r = summarizeJourney([doc('done', '/d/등본.pdf'), doc('done' /* 파일 없음 */)], 'completed')
    expect(r.issued).toBe(1)
    expect(r.text).toContain('서류 1건 발급')
  })

  it("'🔑 정부24 N건 로그인 1회'는 oneLogin && govLoginDocs>1 일 때만", () => {
    const steps = [doc('done', '/d/등본.pdf'), doc('done', '/d/초본.pdf')]
    expect(summarizeJourney(steps, 'completed', { oneLogin: true, govLoginDocs: 2 }).text).toContain('🔑 정부24 2건 로그인 1회')
    // 별도 인증이 섞여 govLoginDocs=1 이면 '1회' 배지를 붙이지 않는다(오보 방지)
    expect(summarizeJourney(steps, 'completed', { oneLogin: true, govLoginDocs: 1 }).text).not.toContain('로그인 1회')
    // oneLogin=false 면 배지 없음
    expect(summarizeJourney(steps, 'completed', { oneLogin: false, govLoginDocs: 2 }).text).not.toContain('로그인 1회')
  })

  it('신청은 success===true 만 준비, 그 외 done 은 직접 진행 필요(manual)', () => {
    const prepared = summarizeJourney([apply('done', true)], 'completed')
    expect(prepared.text).toContain('신청 양식 1건 준비')
    expect(prepared.text).toContain('✅ 연쇄 자동발급 끝')

    const notReady = summarizeJourney([apply('done', false)], 'completed')
    expect(notReady.text).toContain('신청 1건 직접 진행 필요')
    expect(notReady.text).toContain('⚠️ 서류 발급 완료 · 신청 확인 필요') // manual>0 이면 head 가 확인 필요로
  })

  it('건너뜀·취소·오류 헤드', () => {
    expect(summarizeJourney([doc('cancelled')], 'cancelled').text).toContain('⏹ 연쇄 중단됨')
    expect(summarizeJourney([doc('error')], 'error').text).toContain('⚠️ 연쇄가 오류로 끝났어요')
    expect(summarizeJourney([doc('done', '/d/a.pdf'), doc('cancelled')], 'completed').text).toContain('1건 건너뜀')
  })

  it('manualApplyCount 는 요약과 같은 기준(success 아닌 done 신청)', () => {
    expect(manualApplyCount([apply('done', true), apply('done', false), apply('completed', undefined)])).toBe(2)
    expect(manualApplyCount([doc('done', '/d/a.pdf')])).toBe(0)
  })
})
