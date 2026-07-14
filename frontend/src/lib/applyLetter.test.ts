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
  it('본인 장애(장애진단)를 자녀 장애로 날조하지 않는다(환각 0)', () => {
    // guidedChat/parseQuery는 본인 장애를 life_events ['장애진단']으로 저장 — /장애/ 넓은 매칭이 이를 자녀로 오포착하면 안 됨
    const letter = generateApplyLetter(P({ disability: true, has_children: true, children_ages: [10], life_events: ['장애진단'] }), pol)
    expect(letter).toContain('장애로')              // 본인 장애 문장은 있음
    expect(letter).not.toContain('장애가 있는 자녀') // 자녀 장애는 지어내지 않음
    // 실제 자녀 장애 신호가 있으면 그때만 노출
    expect(generateApplyLetter(P({ has_children: true, children_ages: [10], life_events: ['장애아동'] }), pol)).toContain('장애가 있는 자녀')
  })
  it('인사말에 가구형태 코드를 인물 수식어로 끼워 넣지 않는다(어색한 문장 방지)', () => {
    // '72세 다문화가족 홍길동' 같은 표현 금지 — 가구형태는 본문 상황 문장으로만 다룬다
    const letter = generateApplyLetter(P({ name: '홍길동', age: 72, household_type: '다문화가족' }), pol)
    expect(letter).toContain('72세 홍길동입니다')
    expect(letter).not.toContain('다문화가족 홍길동')
    expect(letter).toContain('한국 생활에 적응') // 가구형태는 본문에 문장으로 반영됨
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

describe('generatePhoneScript — 전화 대본(환각 0)', () => {
  it('정책명·프로필 신호를 통화 문장으로 + 질문 체크리스트·메모칸 포함', async () => {
    const { generatePhoneScript } = await import('./applyLetter')
    const s = generatePhoneScript(P({ age: 72, region: '서울', employment_status: 'unemployed', life_events: ['실직'] }), pol)
    expect(s).toContain('긴급복지 생계지원')
    expect(s).toContain('72세')
    expect(s).toContain('일자리를 잃어')     // 입력 신호만
    expect(s).toContain('자격이 되나요')     // 질문 체크리스트
    expect(s).toContain('들은 내용 메모')    // 메모칸
  })
  it('입력하지 않은 상황은 지어내지 않는다', async () => {
    const { generatePhoneScript } = await import('./applyLetter')
    const s = generatePhoneScript(P({ age: 40, income_percentile: 80 }), pol)
    expect(s).not.toContain('장애로')
    expect(s).not.toContain('일자리를 잃어')
  })
})
