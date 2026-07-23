import { describe, expect, it } from 'vitest'
import { buildResultBriefing } from './voiceBriefing'
import { runAnalysis } from './welfare-engine'
import type { UserProfile } from './welfare-engine'

const SENIOR: UserProfile = {
  name: '김복순', age: 72, gender: 'other', household_type: '단독가구',
  income_percentile: 25, disability: false, disability_grade: '', has_children: false,
  children_ages: [], is_pregnant: false, employment_status: 'unemployed',
  region: '서울', life_events: [],
}

describe('buildResultBriefing — 📞 결과 음성 브리핑', () => {
  it('72세 저소득 결과: 개수·번호별 top3·보수 합산·서류·후속 안내를 담는다', () => {
    const res = runAnalysis(SENIOR)
    const b = buildResultBriefing(res)!
    expect(b).not.toBeNull()
    expect(b.text).toContain('전화로 짚어드릴게요')
    expect(b.text).toMatch(/맞춤 복지가 \d+개/)
    expect(b.text).toContain('1번, ')
    expect(b.text).toContain('기초연금') // 어르신 대표 제도가 상위에
    // 금액은 화면 헤더와 같은 '보수 합산' 문구 계열(이론최대 금지 — #142 기준)
    expect(b.text).toContain('적게 잡아 더하면')
    expect(b.text).toContain('담아줘')
    // 이어지는 담기 맥락용 top3 정책 동반
    expect(b.policies.length).toBeGreaterThan(0)
    expect(b.policies.length).toBeLessThanOrEqual(3)
    expect(b.policies[0].id).toMatch(/^POL-/)
  })

  it('적격 0건이면 null(브리핑 없음)', () => {
    expect(buildResultBriefing({ eligible_policies: [], required_docs: [] } as never)).toBeNull()
  })
})

describe('buildResultBriefing — 프로필 인사이트 덧붙임', () => {
  it('프로필을 주면 스마트 인사이트(타이밍·오해)를 음성에도 덧붙인다', () => {
    const p64: UserProfile = { ...SENIOR, age: 64, income_percentile: 40 }
    const res = runAnalysis(p64)
    const b = buildResultBriefing(res, p64)
    // 만 64세 → 기초연금 사전신청(preapply, timing) 인사이트가 항상 들어간다
    if (b) expect(b.text).toMatch(/시기가 중요|참고로/)
  })
  it('프로필 없이 호출해도(하위호환) 그대로 동작', () => {
    const res = runAnalysis(SENIOR)
    const b = buildResultBriefing(res)!
    expect(b.text).toContain('전화로 짚어드릴게요')
  })
})
