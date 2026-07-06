import { describe, it, expect } from 'vitest'
import { parseProfileFromText } from './parseQuery'

describe('parseProfileFromText', () => {
  it('72세 혼자 사는 저소득 어르신', () => {
    const p = parseProfileFromText('72세 혼자 사는데 소득이 적어요')
    expect(p.age).toBe(72)
    expect(p.household_type).toBe('1인가구')
    expect(p.income_percentile).toBeLessThanOrEqual(40)
  })

  it('서울 한부모 + 5살 아이', () => {
    const p = parseProfileFromText('서울 사는 한부모인데 5살 아이를 키워요')
    expect(p.region).toBe('서울')
    expect(p.household_type).toBe('한부모가족')
    expect(p.has_children).toBe(true)
    expect(p.children_ages).toContain(5)
    expect(p.age).toBe(30) // 아이 나이(5)를 부모 나이로 오인하지 않음 → 기본값 유지
  })
  it('부모 나이와 자녀 나이를 구분', () => {
    const p = parseProfileFromText('35살인데 7살 아이를 키워요')
    expect(p.age).toBe(35) // 부모
    expect(p.children_ages).toContain(7) // 자녀
  })

  it('기초생활수급자 → 매우 낮은 소득', () => {
    expect(parseProfileFromText('기초생활수급자입니다').income_percentile).toBeLessThanOrEqual(30)
  })

  it('중증 장애인', () => {
    const p = parseProfileFromText('중증 장애가 있어요')
    expect(p.disability).toBe(true)
    expect(p.disability_grade).toBe('1급')
  })

  it('실직한 청년 구직자', () => {
    const p = parseProfileFromText('회사에서 퇴사하고 일자리를 찾는 청년이에요')
    expect(p.employment_status).toBe('unemployed')
    expect(p.life_events).toContain('실직')
    expect(p.age).toBeLessThanOrEqual(30)
  })

  it('임신 중 → 출산 이벤트·여성', () => {
    const p = parseProfileFromText('임신 중이에요')
    expect(p.is_pregnant).toBe(true)
    expect(p.life_events).toContain('출산')
    expect(p.gender).toBe('female')
  })

  it('70대 → 약 75세, 경기 거주', () => {
    const p = parseProfileFromText('경기도 사는 70대입니다')
    expect(p.age).toBeGreaterThanOrEqual(70)
    expect(p.region).toBe('경기')
  })

  it('빈 입력 → 안전한 기본값', () => {
    const p = parseProfileFromText('')
    expect(p.age).toBe(30)
    expect(p.income_percentile).toBe(80)
    expect(p.life_events).toEqual([])
  })
})


describe('실사용 문장 회귀(2026-07 품질 스윕)', () => {
  it('사별+혼자 키움 → 한부모 + 자녀 수 인식', () => {
    const p = parseProfileFromText('남편이 죽고 애 둘을 혼자 키워요')
    expect(p.household_type).toBe('한부모가족')
    expect(p.children_ages.length).toBe(2)
  })
  it('감사 회귀: 저소득 부정형("많지 않다·많이 부족")을 고소득으로 오분류하지 않음', () => {
    expect(parseProfileFromText('소득이 많지 않아요').income_percentile).toBe(40)
    expect(parseProfileFromText('소득이 많이 부족해요').income_percentile).toBe(40)
    // 진짜 고소득 표현은 그대로 고소득
    expect(parseProfileFromText('소득이 많아요 여유 있어요').income_percentile).toBe(130)
  })
  it('감사 회귀: 자녀 없는 사별(혼자 사는 어르신)은 한부모 아님', () => {
    const p = parseProfileFromText('65세 남성인데 아내와 사별하고 혼자 살아요')
    expect(p.household_type).not.toBe('한부모가족')
    expect(p.household_type).toBe('1인가구') // 혼자 → 1인가구
  })
  it('자녀 나이 나열은 부모 나이로 오인하지 않음', () => {
    const p = parseProfileFromText('아이가 셋이에요 7살 5살 2살')
    expect(p.age).toBe(30) // 기본값 유지(7살을 부모로 오인 X)
    expect(p.children_ages).toEqual([7, 5, 2])
    expect(p.household_type).toBe('다자녀가구')
  })
  it('쌍둥이 신생아 → 0세 둘', () => {
    expect(parseProfileFromText('갓 태어난 쌍둥이가 있어요').children_ages).toEqual([0, 0])
  })
  it('암 투병 → 질병 이벤트', () => {
    expect(parseProfileFromText('암 진단을 받았어요').life_events).toContain('질병')
  })
  it('회귀: 성인 나이는 그대로(65살 남편 → 65세, 자녀 오인 없음)', () => {
    const p = parseProfileFromText('65살 남편이랑 둘이 살아요')
    expect(p.age).toBe(65)
    expect(p.has_children).toBe(false)
  })
})

describe('파악 보강(2026-07 자연어 신호 확장)', () => {
  it('워킹푸어: 월급·벌이가 적으면 저소득 + 취업했으면 재직', () => {
    const p = parseProfileFromText('취업했는데 월급이 적어요')
    expect(p.income_percentile).toBe(40)
    expect(p.employment_status).toBe('employed')
    expect(parseProfileFromText('벌이가 넉넉지 않아요').income_percentile).toBe(40)
    expect(parseProfileFromText('연봉이 낮아요').income_percentile).toBe(40)
  })
  it('자영업 부진(장사 안돼·매출 줄·폐업)은 저소득으로 인식', () => {
    expect(parseProfileFromText('자영업 하는데 장사가 안돼요').income_percentile).toBe(40)
    expect(parseProfileFromText('소상공인인데 매출이 줄었어요').income_percentile).toBe(40)
    expect(parseProfileFromText('가게 문 닫았어요').income_percentile).toBe(40)
  })
  it('출생 순서(셋째 낳음)만으로 자녀·출산·다자녀 인식', () => {
    const p = parseProfileFromText('셋째 낳았어요')
    expect(p.has_children).toBe(true)
    expect(p.household_type).toBe('다자녀가구')
    expect(p.life_events).toContain('출산')
    expect(p.children_ages).toEqual([0]) // 갓 태어난 아이
  })
  it('둘째는 다자녀가 아님(순서만 인식)', () => {
    const p = parseProfileFromText('둘째 가졌어요')
    expect(p.has_children).toBe(true)
    expect(p.household_type).not.toBe('다자녀가구')
    expect(p.life_events).toContain('출산')
  })
  it('의료비·희귀질환·아픈 자녀 → 질병 이벤트', () => {
    expect(parseProfileFromText('희귀질환을 앓고 있어요').life_events).toContain('질병')
    expect(parseProfileFromText('병원비가 많이 들어요').life_events).toContain('질병')
    expect(parseProfileFromText('아이가 아파서 걱정이에요').life_events).toContain('질병')
  })
  it('복학한 사람은 학생으로 인식', () => {
    expect(parseProfileFromText('군 제대하고 복학했어요').employment_status).toBe('student')
  })
  it('회귀: 애인이 아파도 자녀 질병으로 오인하지 않음(애(?!인) 가드)', () => {
    // '애인'은 자녀 아픔 패턴에서 제외 — 다만 '아프'가 없으니 질병 미발생이 정상
    const p = parseProfileFromText('애인이랑 살아요')
    expect(p.life_events).not.toContain('질병')
  })
})

describe('취약계층 대상군(사각지대) 신호', () => {
  it('북한이탈주민·탈북·새터민 → 북한이탈 신호', () => {
    expect(parseProfileFromText('북한이탈주민입니다').life_events).toContain('북한이탈')
    expect(parseProfileFromText('탈북해서 왔어요').life_events).toContain('북한이탈')
  })
  it('국가유공자·보훈 → 보훈 신호', () => {
    expect(parseProfileFromText('국가유공자입니다').life_events).toContain('보훈')
    expect(parseProfileFromText('보훈 대상자예요').life_events).toContain('보훈')
  })
  it('자립준비청년·보호종료 → 자립준비 신호 + 나이 보정', () => {
    const p = parseProfileFromText('보호종료아동이에요')
    expect(p.life_events).toContain('자립준비')
    expect(p.age).toBeLessThanOrEqual(24) // 기본값 30 대신 자립준비 연령대로 보정
  })
  it('가정폭력·성폭력 피해 → 가정폭력 신호', () => {
    expect(parseProfileFromText('가정폭력 피해자예요').life_events).toContain('가정폭력')
  })
  it('일반 문장은 대상군 신호를 넣지 않음', () => {
    const ev = parseProfileFromText('30대 직장인이에요').life_events
    expect(ev).not.toContain('보훈')
    expect(ev).not.toContain('북한이탈')
  })
})
