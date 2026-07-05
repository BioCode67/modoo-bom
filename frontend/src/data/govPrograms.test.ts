import { describe, it, expect } from 'vitest'
import { GOV_PROGRAMS } from './govPrograms'
import { getCatalog, getPolicyMap } from './catalog'
import { applyLink } from '@/lib/officialLinks'
import { runAnalysis, type UserProfile } from '@/lib/welfare-engine'

const base: UserProfile = {
  name: '', age: 30, gender: 'other', region: '서울', household_type: '',
  income_percentile: 60, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}
const supIds = (p: UserProfile) =>
  new Set(runAnalysis(p).eligible_policies.filter((x) => x.id.startsWith('SUP-')).map((x) => x.id))

describe('GOV_PROGRAMS — 정부 지원사업 큐레이션 데이터 무결성', () => {
  it('SUP- 고유 id, 필수 필드 채움', () => {
    const ids = new Set<string>()
    for (const p of GOV_PROGRAMS) {
      expect(p.id).toMatch(/^SUP-\d{3}$/)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.name).toBeTruthy()
      expect(p.category).toBeTruthy()
      expect(p.benefit).toBeTruthy()
      expect(p.eligibility).toBeTruthy()
      expect(p.department).toBeTruthy()
    }
  })

  it('application에 공식 URL 포함, 정제 후 깨끗한 도메인', () => {
    const allow = /(enhuf\.molit\.go\.kr|myhome\.go\.kr|apply\.lh\.or\.kr|khug\.or\.kr|bokjiro\.go\.kr|nhis\.or\.kr|gov\.kr|hira\.or\.kr|mohw\.go\.kr|ncc\.re\.kr|korea-pass\.kr|youthculturepass\.or\.kr|kosaf\.go\.kr|q-net\.or\.kr|yw\.work24\.go\.kr|4insure\.or\.kr|8899\.or\.kr|sbiz24\.kr|foodvoucher\.go\.kr)/
    for (const p of GOV_PROGRAMS) {
      const url = applyLink(p.application).url
      expect(url).toMatch(/^https:\/\//)
      expect(url).toMatch(allow)
      expect(url).not.toMatch(/[가-힣)]/) // 뒤 한글·괄호 정제됨
    }
  })

  it('카탈로그·맵에 병합됨(25건)', () => {
    expect(GOV_PROGRAMS.length).toBe(25)
    const map = getPolicyMap()
    const cat = new Set(getCatalog().map((p) => p.id))
    for (const p of GOV_PROGRAMS) {
      expect(map[p.id]).toBeTruthy()
      expect(cat.has(p.id)).toBe(true)
    }
  })
})

describe('GOV_PROGRAMS — 대상별 노출/누수', () => {
  it('신생아 특례대출·미숙아 의료비는 임신·영아 가구에만', () => {
    const newborn = supIds({ ...base, age: 33, has_children: true, children_ages: [0], income_percentile: 90 })
    expect(newborn.has('SUP-001')).toBe(true) // 신생아 특례 디딤돌
    expect(newborn.has('SUP-011')).toBe(true) // 미숙아·선천성이상아
    const childless = supIds({ ...base, age: 45, income_percentile: 90 })
    expect(childless.has('SUP-001')).toBe(false)
    expect(childless.has('SUP-011')).toBe(false)
  })

  it('청년 문화예술패스는 19~20세만(21세+ 제외)', () => {
    expect(supIds({ ...base, age: 20 }).has('SUP-017')).toBe(true)
    expect(supIds({ ...base, age: 25 }).has('SUP-017')).toBe(false)
  })

  it('다자녀 통합혜택은 미성년 자녀 2명 이상만', () => {
    expect(supIds({ ...base, age: 38, has_children: true, children_ages: [2, 5] }).has('SUP-025')).toBe(true)
    expect(supIds({ ...base, age: 38, has_children: true, children_ages: [5] }).has('SUP-025')).toBe(false)
  })

  it('농식품바우처는 생계급여(중위 32% 이하) 가구에 노출', () => {
    expect(supIds({ ...base, age: 40, income_percentile: 30 }).has('SUP-024')).toBe(true)
    expect(supIds({ ...base, age: 40, income_percentile: 60 }).has('SUP-024')).toBe(false)
  })

  it('본인부담상한제·정신건강은 소득무관 보편 노출(고소득에도)', () => {
    const rich = supIds({ ...base, age: 45, income_percentile: 200 })
    expect(rich.has('SUP-010')).toBe(true) // 본인부담상한제
    expect(rich.has('SUP-013')).toBe(true) // 정신건강 위기상담
  })

  it('미취업 전용(일경험)은 재직자에게 안 뜨고, ICL(재학)은 학생에게만 — 취업/재학 상태 반영', () => {
    // 재직 중이면 미취업 대상 '일경험'·재학 대상 'ICL' 모두 제외(연령만 맞아 강력추천되던 오류 차단)
    const employed = supIds({ ...base, age: 31, employment_status: 'employed' })
    expect(employed.has('SUP-020')).toBe(false) // 일경험(미취업)
    expect(employed.has('SUP-018')).toBe(false) // ICL(재학)
    // 무직 청년엔 일경험 노출, 학생 아님이라 ICL은 제외
    const jobless = supIds({ ...base, age: 26, employment_status: 'unemployed' })
    expect(jobless.has('SUP-020')).toBe(true)
    expect(jobless.has('SUP-018')).toBe(false)
    // 학생엔 ICL 노출
    expect(supIds({ ...base, age: 22, employment_status: 'student' }).has('SUP-018')).toBe(true)
  })
})
