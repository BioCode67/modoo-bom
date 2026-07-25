import { describe, it, expect } from 'vitest'
import {
  EMPTY_PROFILE, AGE_BRACKETS, applySituations, nextStep, isStepActive,
  progressOf, mascotReaction, STEP_ORDER, ageFromBirth, parseBirthInput, formatBirth,
} from './onboardingFlow'
import { runAnalysis } from './welfare-engine'

describe('생년월일 입력(토스/PASS 방식) 헬퍼', () => {
  const today = new Date(2026, 6, 21) // 2026-07-21 (월 0-based)
  it('ageFromBirth — 생일 지났으면 그 나이, 아직이면 -1', () => {
    expect(ageFromBirth('19550101', today)).toBe(71) // 1월생 → 지남
    expect(ageFromBirth('19551231', today)).toBe(70) // 12월생 → 아직
    expect(ageFromBirth('20000721', today)).toBe(26) // 오늘이 생일 → 만 나이 됨
    expect(ageFromBirth('20000722', today)).toBe(25) // 내일 생일 → 아직
  })
  it('ageFromBirth — 잘못된 입력은 null(미래·형식오류·불가능한 날짜)', () => {
    expect(ageFromBirth('20991231', today)).toBeNull() // 미래
    expect(ageFromBirth('1955010', today)).toBeNull()  // 7자리
    expect(ageFromBirth('19551301', today)).toBeNull() // 13월
    expect(ageFromBirth('abcdefgh', today)).toBeNull()
  })
  it('parseBirthInput — 구분자 섞인 입력에서 8자리를 뽑아 {yyyymmdd, age}', () => {
    expect(parseBirthInput('1960.01.01', today)).toEqual({ yyyymmdd: '19600101', age: 66 })
    expect(parseBirthInput('1960-01-01', today)).toEqual({ yyyymmdd: '19600101', age: 66 })
    expect(parseBirthInput('196001', today)).toBeNull() // 6자리 → 불충분(연도 모호 방지)
  })
  it('formatBirth — YYYYMMDD → YYYY.MM.DD', () => {
    expect(formatBirth('19600101')).toBe('1960.01.01')
  })
})

describe('onboardingFlow — 대화형 온보딩 로직', () => {
  it('나이 구간 대표값이 정책 임계값 안에 안전(청년 19~34, 어르신 65+)', () => {
    const youth = AGE_BRACKETS.find((a) => a.label.includes('청년'))!
    expect(youth.age).toBeGreaterThanOrEqual(19)
    expect(youth.age).toBeLessThanOrEqual(34)
    const senior = AGE_BRACKETS.find((a) => a.label.includes('어르신'))!
    expect(senior.age).toBeGreaterThanOrEqual(65)
  })

  it('applySituations — 상황을 프로필 플래그로 정확히 매핑', () => {
    const newborn = applySituations(EMPTY_PROFILE, ['newborn'])
    expect(newborn.has_children).toBe(true)
    expect(newborn.life_events).toContain('출산')
    expect(newborn.children_ages.length).toBeGreaterThan(0) // 자녀 나이 자리 확보

    const dis = applySituations(EMPTY_PROFILE, ['disability'])
    expect(dis.disability).toBe(true)
    expect(dis.disability_grade).toBeTruthy()

    const jobless = applySituations(EMPTY_PROFILE, ['jobless'])
    expect(jobless.employment_status).toBe('unemployed')
    expect(jobless.life_events).toContain('실직')

    const none = applySituations(EMPTY_PROFILE, ['none'])
    expect(none.disability).toBe(false)
    expect(none.has_children).toBe(false)
    expect(none.is_pregnant).toBe(false)
  })

  it('여러 상황 동시 선택 — 이벤트 누적, 중복 없음', () => {
    const p = applySituations(EMPTY_PROFILE, ['jobless', 'sick'])
    expect(p.employment_status).toBe('unemployed')
    expect(p.life_events).toContain('실직')
    expect(p.life_events).toContain('질병')
    expect(new Set(p.life_events).size).toBe(p.life_events.length)
  })

  it('조건부 단계 게이팅 — 자녀 없으면 childAges 스킵, 장애 없으면 disability 스킵', () => {
    const plain = { ...EMPTY_PROFILE }
    expect(isStepActive('childAges', plain)).toBe(false)
    expect(isStepActive('disability', plain)).toBe(false)
    // 상황 단계에서 household 다음은 situations, 그다음 자녀·장애 없으면 region으로 점프
    expect(nextStep('situations', plain)).toBe('region')

    const withKids = applySituations(EMPTY_PROFILE, ['children'])
    expect(isStepActive('childAges', withKids)).toBe(true)
    expect(nextStep('situations', withKids)).toBe('childAges')

    const withDis = applySituations(EMPTY_PROFILE, ['disability'])
    expect(nextStep('situations', withDis)).toBe('disability')
  })

  it('nextStep은 순서를 따르고 마지막(region)에서 null(완료)', () => {
    expect(nextStep('name', EMPTY_PROFILE)).toBe('age')
    expect(nextStep('age', EMPTY_PROFILE)).toBe('income')
    expect(nextStep('region', EMPTY_PROFILE)).toBeNull()
    // STEP_ORDER 마지막이 region
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe('region')
  })

  it('진행률 — 첫 단계<1, 마지막 단계=1', () => {
    expect(progressOf('name', EMPTY_PROFILE)).toBeLessThan(1)
    expect(progressOf('region', EMPTY_PROFILE)).toBe(1)
  })

  it('마스코트 리액션 — 어르신·저소득·장애에 맞춤 멘트', () => {
    expect(mascotReaction('age', { ...EMPTY_PROFILE, age: 70 })).toContain('어르신')
    expect(mascotReaction('income', { ...EMPTY_PROFILE, income_percentile: 25 })).toBeTruthy()
    expect(mascotReaction('situations', applySituations(EMPTY_PROFILE, ['disability']))).toBeTruthy()
  })

  it('대화로 만든 프로필이 실제 분석과 연결 — 어르신 저소득 → 기초연금 도출', () => {
    // name→age(70)→income(25)→household(1인)→situations(none)
    let p = { ...EMPTY_PROFILE, name: '김복순' }
    p = { ...p, age: 70 }
    p = { ...p, income_percentile: 25 }
    p = { ...p, household_type: '1인가구' }
    p = applySituations(p, ['none'])
    const r = runAnalysis(p)
    expect(r.eligible_policies.some((x) => x.id === 'POL-001')).toBe(true) // 기초연금
  })
})
