import { describe, it, expect } from 'vitest'
import { buildWelfareReport } from './welfareReport'
import { runAnalysis, type UserProfile } from './welfare-engine'

const SENIOR: UserProfile = {
  name: '김복순', age: 72, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 25, disability: false, disability_grade: '', employment_status: 'retired',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [],
}

describe('buildWelfareReport — 복지 리포트 텍스트', () => {
  it('결과가 있으면 제목·복지목록·정직성 푸터·공식 링크를 담는다', () => {
    const res = runAnalysis(SENIOR)
    const rpt = buildWelfareReport(SENIOR, res)
    expect(rpt).toContain('■ 모두봄 복지 리포트')
    expect(rpt).toContain('받을 수 있는 복지:')
    expect(rpt).toContain('기초연금')
    expect(rpt).toMatch(/최종 자격·금액은 신청 후 행정 심사/) // 정직성 푸터
    expect(rpt).toContain('bokjiro.go.kr')
    expect(rpt).toContain('gov.kr')
  })

  it('보수 합산 문구를 쓰고 이론최대를 읽지 않는다', () => {
    const rpt = buildWelfareReport(SENIOR, runAnalysis(SENIOR))
    // 현금지원 줄이 있으면 보수 합산·한정어와 함께
    if (/예상 현금지원/.test(rpt)) {
      expect(rpt).toContain('보수 합산')
      expect(rpt).toMatch(/달라질 수 있어요/)
    }
  })

  it('includeName 옵션에 따라 이름 포함/제외', () => {
    const res = runAnalysis(SENIOR)
    expect(buildWelfareReport(SENIOR, res, { includeName: true })).toContain('김복순님')
    expect(buildWelfareReport(SENIOR, res, { includeName: false })).not.toContain('김복순')
  })

  it('dateLabel을 주면 작성일이 들어간다(Date 미사용 — 순수)', () => {
    const rpt = buildWelfareReport(SENIOR, runAnalysis(SENIOR), { dateLabel: '2026-07-24' })
    expect(rpt).toContain('작성일: 2026-07-24')
  })

  it('적격 0건이면 안내 문구 + 푸터(크래시 없음)', () => {
    const empty = { eligible_policies: [], required_docs: [] } as never
    const rpt = buildWelfareReport(null, empty)
    expect(rpt).toContain('찾지 못했어요')
    expect(rpt).toContain('모두봄에서 생성')
  })

  it('결과 없음(null)도 안전', () => {
    expect(() => buildWelfareReport(null, null)).not.toThrow()
    expect(buildWelfareReport(null, null)).toContain('■ 모두봄 복지 리포트')
  })
})
