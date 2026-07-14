import { describe, it, expect } from 'vitest'
import { generateApplyLetter, generateProxyLetter } from './applyLetter'
import type { UserProfile } from './welfare-engine'
import type { Policy } from '@/data/policies'

const P = (o: Partial<UserProfile>): UserProfile => ({
  name: '', age: 40, gender: 'female', region: '서울', household_type: '1인가구',
  income_percentile: 50, disability: false, disability_grade: '', employment_status: '',
  has_children: false, children_ages: [], is_pregnant: false, life_events: [], ...o,
})
const pol = { id: 'X', name: '긴급복지 생계지원', category: '', benefit: '', eligibility: '', target: '', application: '', required_docs: [], department: '', renewal: '' } as Policy

describe('generateApplyLetter — 규칙 기반 신청 사유서(환각 0)', () => {
  it('정책명·입력한 상황 신호를 정중한 사유서로 옮긴다', () => {
    const letter = generateApplyLetter(P({ age: 47, employment_status: 'unemployed', life_events: ['실직'], income_percentile: 40 }), pol)
    expect(letter).toContain('긴급복지 생계지원 신청 사유서')
    expect(letter).toContain('일자리를 잃어')   // 실직 신호 반영
    expect(letter).toContain('신청인:')
  })
  it('입력하지 않은 위기를 지어내지 않는다(환각 방지)', () => {
    const letter = generateApplyLetter(P({ age: 40, income_percentile: 80 }), pol) // 특별 신호 없음
    expect(letter).not.toContain('일자리를 잃어')
    expect(letter).not.toContain('장애로')
    expect(letter).not.toContain('출산')
  })
  it('확장 상황 신호 반영: 다자녀·다문화·자립준비', () => {
    expect(generateApplyLetter(P({ has_children: true, children_ages: [3, 6, 9] }), pol)).toContain('여러 자녀')
    expect(generateApplyLetter(P({ household_type: '다문화가족' }), pol)).toContain('한국 생활에 적응')
    expect(generateApplyLetter(P({ age: 22, life_events: ['자립준비'] }), pol)).toContain('홀로 자립')
  })
  it('정책 종류에 맞춘 취지 문장(장학→학업, 의료→치료)', () => {
    const scholar = { ...pol, name: '국가장학금', category: '교육' } as Policy
    const medical = { ...pol, name: '재난적 의료비 지원', category: '의료' } as Policy
    expect(generateApplyLetter(P({ age: 20 }), scholar)).toContain('학업')
    expect(generateApplyLetter(P({ age: 50 }), medical)).toContain('치료')
  })
  it('한부모·출산·장애 신호를 각각 정확히 반영', () => {
    expect(generateApplyLetter(P({ household_type: '한부모가족', has_children: true, children_ages: [5] }), pol)).toContain('혼자 자녀를 양육')
    expect(generateApplyLetter(P({ is_pregnant: true, life_events: ['출산'] }), pol)).toContain('출산')
    expect(generateApplyLetter(P({ disability: true, disability_grade: '1급' }), pol)).toContain('장애로')
  })
})

describe('generateProxyLetter — 위임장(가족이 대신 신청)', () => {
  it('위임장에 정책명·위임인 성명 반영 + 수임인은 빈칸', () => {
    const letter = generateProxyLetter(P({ name: '김복순', age: 72 }), pol)
    expect(letter).toContain('위 임 장')
    expect(letter).toContain('긴급복지 생계지원')
    expect(letter).toContain('김복순')      // 위임인(본인)
    expect(letter).toContain('수임인(대리 신청인)')
  })
})
