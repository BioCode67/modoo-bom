import { describe, it, expect } from 'vitest'
import { parseProfileFromText } from './parseQuery'

describe('parseProfileFromText', () => {
  it('_ageExplicit: 정확한 나이(N세/살)만 명시로, 추정(청년→27·기본 30·N0대)은 되물음 대상', () => {
    // 실제 수치를 말하면 명시 → 되묻지 않음
    expect(parseProfileFromText('27세 청년입니다')._ageExplicit).toBe(true)
    expect(parseProfileFromText('만 65세예요')._ageExplicit).toBe(true)
    // '청년'·기본값·'30대'는 추정 → 대화형 진입이 정확한 나이를 되묻게 false
    expect(parseProfileFromText('청년인데 월세 지원 받고 싶어요')._ageExplicit).toBe(false)
    expect(parseProfileFromText('월세 지원 받고 싶어요')._ageExplicit).toBe(false)
    expect(parseProfileFromText('30대인데 일자리 찾아요')._ageExplicit).toBe(false)
  })
  it('72세 혼자 사는 저소득 어르신', () => {
    const p = parseProfileFromText('72세 혼자 사는데 소득이 적어요')
    expect(p.age).toBe(72)
    expect(p._ageExplicit).toBe(true)
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

  it("'아이가 N살' 같은 나이 표현을 다자녀로 오분류하지 않음(맨 숫자 3 함정)", () => {
    // 셋째 이상 전용 현금혜택을 자녀 1명 사용자에게 과장 추천하던 회귀 방지
    expect(parseProfileFromText('아이가 3살이에요').household_type).not.toBe('다자녀가구')
    expect(parseProfileFromText('아이가 13살이에요').household_type).not.toBe('다자녀가구')
    expect(parseProfileFromText('아이 키우는데 33살이에요').household_type).not.toBe('다자녀가구')
    // 진짜 다자녀 표현은 인식
    expect(parseProfileFromText('아이 셋 키워요').household_type).toBe('다자녀가구')
    expect(parseProfileFromText('자녀 3명이에요').household_type).toBe('다자녀가구')
  })

  it('명사-먼저 단일 자녀 나이를 정확히 잡음(아동수당 과장 방지 — 감사 수정)', () => {
    // "아이가 10살" → 자녀 나이 10 (기본 3세로 뭉개지지 않음). 10살은 아동수당(만 9세 미만) 대상 아님.
    const p = parseProfileFromText('아이가 10살이에요')
    expect(p.has_children).toBe(true)
    expect(p.children_ages).toContain(10)
    expect(p.children_ages).not.toContain(3)
    expect(p.age).toBe(30) // 자녀 나이(10)를 부모 나이로 오인하지 않음
  })
  it('필러가 낀 나이-먼저 자녀 표기(5살짜리 아이)', () => {
    const p = parseProfileFromText('5살짜리 아이를 키워요')
    expect(p.children_ages).toContain(5)
  })
  it('조손가구 손주 나이를 잡음(교육급여 누락 방지 — 감사 수정)', () => {
    const p = parseProfileFromText('할머니가 손주 9살 7살 키워요')
    expect(p.household_type).toBe('조손가구')
    expect(p.has_children).toBe(true)
    expect(p.children_ages).toEqual(expect.arrayContaining([9, 7]))
    expect(p.children_ages).not.toContain(3)
  })
  it('자립준비 나이 보정이 명시 나이를 덮지 않음(감사 수정)', () => {
    expect(parseProfileFromText('30살인데 보호종료 됐어요').age).toBe(30) // 명시 30 유지(21로 덮지 않음)
    expect(parseProfileFromText('보호종료 됐어요').age).toBe(21)          // 나이 미명시 시엔 통상값(21) 보정
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

  it('주거지원 문의(소득 미언급) → 중위(50)로 낮춰 물어본 혜택이 숨지 않게', () => {
    // 기본 80은 청년월세(중위 60% 이하)를 소득으로 숨기는 거짓음성 → 물어본 사람에겐 중립 프라이어(50).
    expect(parseProfileFromText('27살 자취하는데 월세 지원 받을 수 있어?').income_percentile).toBe(50)
    expect(parseProfileFromText('원룸 전세자금 지원 얼마나 받아?').income_percentile).toBe(50)
    // 소득을 명시했으면 그 값이 우선(주거 문의라도 덮어쓰지 않음)
    expect(parseProfileFromText('월세 지원 궁금한데 소득이 많아요').income_percentile).toBe(130)
    expect(parseProfileFromText('기초수급자인데 월세 지원 되나요').income_percentile).toBe(28)
    // 주거 키워드 없는 일반 문의는 여전히 기본값(과도 확산 방지)
    expect(parseProfileFromText('무슨 복지 받을 수 있어?').income_percentile).toBe(80)
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

describe('감사 수정 회귀 — 오분류 방지(2026-07)', () => {
  it('해외 여행/출장 표현을 다문화가족으로 오분류하지 않음', () => {
    expect(parseProfileFromText('일본 다녀왔어요').household_type).not.toBe('다문화가족')
    expect(parseProfileFromText('중국 여행 갔다 왔어요').household_type).not.toBe('다문화가족')
    // 진짜 이주·혼인 맥락은 그대로 다문화로
    expect(parseProfileFromText('베트남에서 시집왔어요').household_type).toBe('다문화가족')
    expect(parseProfileFromText('필리핀 출신이에요').household_type).toBe('다문화가족')
  })
  it("소득 부정문('적지 않다')을 저소득으로 오분류하지 않음", () => {
    expect(parseProfileFromText('소득이 적지 않아요').income_percentile).not.toBe(40)
    expect(parseProfileFromText('벌이가 부족하지 않아요').income_percentile).not.toBe(40)
    // 긍정형 저소득은 그대로
    expect(parseProfileFromText('소득이 적어요').income_percentile).toBe(40)
    // '넉넉하지 않다'는 여전히 저소득(부정의 부정 아님)
    expect(parseProfileFromText('소득이 넉넉하지 않아요').income_percentile).toBe(40)
  })
})

describe('parseProfileFromText — 2차 감사 회귀(2026-07)', () => {
  it('부정문 자녀 언급은 자녀 있음이 아님(아동수당 오추천 방지)', () => {
    expect(parseProfileFromText('자녀 없이 혼자 살아요').has_children).toBe(false)
    expect(parseProfileFromText('아이 없어요').has_children).toBe(false)
    expect(parseProfileFromText('무자녀 부부입니다').has_children).toBe(false)
    // 긍정형은 그대로 자녀 있음
    expect(parseProfileFromText('아이 키워요').has_children).toBe(true)
  })
  it('어린 부모 나이를 자녀 나이로 흡수하지 않음(자녀 맥락 이후 나이만)', () => {
    const p = parseProfileFromText('18살 엄마가 아이 7살 5살 키워요')
    expect(p.children_ages).toEqual(expect.arrayContaining([7, 5]))
    expect(p.children_ages).not.toContain(18) // 부모 나이는 자녀에서 제외
    expect(p.age).toBe(18)                     // 부모 나이는 보존
  })
  it('폭력 피해 자연어를 감지(안전 직결) — "맞아요"(옳다) 오탐 없음', () => {
    expect(parseProfileFromText('남편이 때려요').life_events).toContain('가정폭력')
    expect(parseProfileFromText('가정폭력을 당하고 있어요').life_events).toContain('가정폭력')
    expect(parseProfileFromText('아이가 학대당해요').life_events).toContain('가정폭력')
    expect(parseProfileFromText('네 맞아요 소득이 적어요').life_events).not.toContain('가정폭력')
  })
  it('주거 위기(노숙·무주택)를 저소득으로 추론 → 주거·생계 급여 발굴', () => {
    expect(parseProfileFromText('집이 없어서 길에서 지내요').income_percentile).toBeLessThanOrEqual(30)
    expect(parseProfileFromText('노숙 생활 중이에요').income_percentile).toBeLessThanOrEqual(30)
  })
  it('외국인·한국어 미숙을 다문화가족으로 인식(헤드라인) — "일본 다녀왔어요"(여행) 오탐 없음', () => {
    expect(parseProfileFromText('외국인인데 한국말이 서툴러요').household_type).toBe('다문화가족')
    expect(parseProfileFromText('이주노동자예요').household_type).toBe('다문화가족')
    expect(parseProfileFromText('일본 다녀왔어요').household_type).not.toBe('다문화가족')
  })
  it('미혼모 "아기를 낳아"를 영아(0세)로 인식 → 부모급여·첫만남', () => {
    const p = parseProfileFromText('혼자서 아기를 낳아 키워요')
    expect(p.has_children).toBe(true)
    expect(p.children_ages).toContain(0)
  })
  it('산재(일하다 다침)를 감지', () => {
    expect(parseProfileFromText('일하다가 다쳐서 일을 못해요').life_events).toContain('산재')
    expect(parseProfileFromText('공사장에서 다쳤어요').life_events).toContain('산재')
  })
  it('보훈·참전용사를 감지', () => {
    expect(parseProfileFromText('6.25 참전용사인데 도움이 필요해요').life_events).toContain('보훈')
    expect(parseProfileFromText('국가유공자입니다').life_events).toContain('보훈')
  })
  it('"취업이 안돼요"를 구직(미취업)으로 인식', () => {
    expect(parseProfileFromText('20대 청년인데 취업이 안돼요').employment_status).toBe('unemployed')
    expect(parseProfileFromText('백수예요').employment_status).toBe('unemployed')
  })
  it('"형편이 어려워요/어렵습니다" 등 활용형을 저소득으로 인식(활용 어미 누락 방지)', () => {
    // '어렵다'는 '어렵습니다'(어렵)·'어려워요'(어려)로 갈려 어간 하나로는 한쪽이 누락됨 → 둘 다 잡아야
    for (const q of ['형편이 어려워요', '형편이 어렵습니다', '살기 어렵습니다', '생활이 어려운 상황이에요', '끼니를 거를 만큼 어렵습니다']) {
      expect(parseProfileFromText(q).income_percentile, q).toBeLessThanOrEqual(45)
    }
  })
  it('저소득 오탐 방지: "소득이 넉넉합니다·돈이 많아요"는 저소득 아님', () => {
    expect(parseProfileFromText('소득이 넉넉합니다').income_percentile).toBeGreaterThan(60)
    expect(parseProfileFromText('돈이 많아요').income_percentile).toBeGreaterThan(60)
  })
  it('"힘들다" ㄹ불규칙 활용(힘듭니다/힘드네요/힘든데)도 저소득 인식', () => {
    for (const q of ['생활이 힘듭니다', '생계가 힘드네요', '형편이 힘든데요', '살기가 힘듭니다']) {
      expect(parseProfileFromText(q).income_percentile, q).toBeLessThanOrEqual(45)
    }
  })
  it('"건강이 나쁩니다/나쁜" 활용도 질병 신호', () => {
    expect(parseProfileFromText('건강이 나쁩니다').life_events).toContain('질병')
    expect(parseProfileFromText('몸이 아파서 일을 못해요').life_events).toContain('질병')
  })
  it('구어 "짤렸어요"·격식 "취직이 안 됩니다"도 실직/구직 인식', () => {
    expect(parseProfileFromText('짤렸어요').employment_status).toBe('unemployed')
    expect(parseProfileFromText('취직이 안 됩니다').employment_status).toBe('unemployed')
    expect(parseProfileFromText('일을 구하고 있어요').employment_status).toBe('unemployed')
  })
  it('"회사 다녀요"(다니다 활용)·자영업을 고용/자영으로 인식', () => {
    expect(parseProfileFromText('회사 다녀요').employment_status).toBe('employed')
    expect(parseProfileFromText('직장 다닙니다').employment_status).toBe('employed')
    expect(parseProfileFromText('장사해요').employment_status).toBe('self')
    expect(parseProfileFromText('자영업 합니다').employment_status).toBe('self')
  })
})

describe('부정문 오탐 방지 회귀(감사 2026-07)', () => {
  it("'형편이 어렵지 않아요'(여유)는 저소득 아님 — 어려움 어간 부정 가드", () => {
    expect(parseProfileFromText('형편이 어렵지 않아요').income_percentile).toBe(80)
    expect(parseProfileFromText('생활이 힘들지 않아요').income_percentile).toBe(80)
    expect(parseProfileFromText('살기 어렵지 않습니다').income_percentile).toBe(80)
    // 긍정형(진짜 어려움)은 여전히 저소득으로 흡수
    expect(parseProfileFromText('형편이 어려워요').income_percentile).toBe(40)
    expect(parseProfileFromText('생활이 힘들어요').income_percentile).toBe(40)
  })
  it("'아이는 아직 없어요'(무자녀)에 필러가 껴도 자녀 없음으로 — 조사/필러만 허용", () => {
    expect(parseProfileFromText('아이는 아직 없어요').has_children).toBe(false)
    expect(parseProfileFromText('자녀는 아직은 없어요').has_children).toBe(false)
    // 진짜 자녀 있음은 그대로
    expect(parseProfileFromText('5살 아이 키워요').has_children).toBe(true)
  })
  it("다자녀+무돈 문장을 무자녀로 오판하지 않음(자기감사 회귀수정)", () => {
    // '없'이 '돈'을 부정 — 자녀는 있음. 임의창(.{0,6})이 과탐지하던 것 조사/필러만 허용으로 좁혀 수정.
    expect(parseProfileFromText('아이 셋 돈이 없어요').has_children).toBe(true)
    expect(parseProfileFromText('자녀 둘 있는데 돈이 없어요').has_children).toBe(true)
  })
  it("임신 중 '첫 아이'는 태어난 자녀로 날조하지 않되, 기존 자녀 문장은 인정(예제칩 + 회귀수정)", () => {
    const p = parseProfileFromText('임신 중이고 첫 아이예요')
    expect(p.is_pregnant).toBe(true)
    expect(p.has_children).toBe(false)       // 태어날 아이 → 자녀 있음 아님
    expect(p.children_ages).toEqual([])
    // 임신 중이라도 '기존 자녀' 신호가 있으면 인정(둘째 임신 등) — 좁힌 스킵이 실자녀를 떨구지 않게
    expect(parseProfileFromText('임신했고 딸이 있어요').has_children).toBe(true)
    expect(parseProfileFromText('임신 중이고 아들 있어요').has_children).toBe(true)
    expect(parseProfileFromText('임신 중이고 5살 아이 키워요').has_children).toBe(true)
  })
  it('성별은 명시적 자기지칭에서만 — 관계명사(남편/아내)로 오태깅 안 함(DV 오배제 방지)', () => {
    expect(parseProfileFromText('남편이 때려요').gender).not.toBe('male') // 아내 신고 → 남성 오태깅 금지
    expect(parseProfileFromText('아내가 아파요').gender).not.toBe('female')
    // 명시적 자기지칭은 그대로
    expect(parseProfileFromText('저는 여성이에요').gender).toBe('female')
    expect(parseProfileFromText('30대 남자입니다').gender).toBe('male')
    expect(parseProfileFromText('임신했어요').gender).toBe('female')
  })
})

describe('감사 3라운드 회귀 — 자연어 오귀속 방지(2026-07)', () => {
  it('P1: 자녀 명사가 앞서고 부모 나이가 뒤에 와도 부모 나이를 자녀 나이로 오인하지 않음', () => {
    const p = parseProfileFromText('아이 7살이고 저는 38살이에요')
    expect(p.age).toBe(38)                 // 부모 나이(과거: 7로 오인돼 화면에 "7세"로 표기됨)
    expect(p.children_ages).toEqual([7])   // 자녀 나이
    const q = parseProfileFromText('아들 10살인데 제가 40살이에요')
    expect(q.age).toBe(40)
    expect(q.children_ages).toEqual([10])
    // 기존 케이스(부모 나이 먼저 / 자녀만)도 그대로 유지
    expect(parseProfileFromText('35살인데 7살 아이').age).toBe(35)
    expect(parseProfileFromText('아이가 10살').children_ages).toEqual([10])
  })
  it('P2: "저는 아이가 장애가 있어요"는 본인이 아니라 자녀 장애로 귀속', () => {
    const p = parseProfileFromText('저는 아이가 장애가 있어요')
    expect(p.disability).not.toBe(true)          // 부모를 장애인으로 오태깅 금지
    expect(p.has_children).toBe(true)
    expect(p.life_events).toContain('장애아동')
    // 진짜 본인 장애는 그대로
    expect(parseProfileFromText('저는 장애가 있어요').disability).toBe(true)
    // 자녀 명사가 뒤에 오는 기존 예도 자녀 장애 유지
    expect(parseProfileFromText('장애가 있는 아들이에요').disability).not.toBe(true)
  })
  it('P3: "남자친구/남자아이" 같은 제3자 합성어로 화자 성별을 오태깅하지 않음', () => {
    expect(parseProfileFromText('남자친구한테 맞고 살아요').gender).not.toBe('male') // 여성 DV → 여성지원 배제 금지
    expect(parseProfileFromText('남자아이 둘 키워요').gender).not.toBe('male')        // 아들 키우는 엄마
    // 명시적 자기지칭은 그대로
    expect(parseProfileFromText('저는 남자예요').gender).toBe('male')
    expect(parseProfileFromText('저는 여자예요').gender).toBe('female')
  })
})

describe('profileSignalCount — 상황 문장 판별', () => {
  it('상황 문장(신호≥2)과 지식 질문(0)을 구분한다', async () => {
    const { profileSignalCount } = await import('./parseQuery')
    expect(profileSignalCount('72세 혼자 사는데 소득이 적어요')).toBeGreaterThanOrEqual(2)
    expect(profileSignalCount('서울 사는 한부모인데 5살 아이 키워요')).toBeGreaterThanOrEqual(2)
    expect(profileSignalCount('기초연금 알려줘')).toBe(0)
    expect(profileSignalCount('서류 뭐 필요해')).toBe(0)
  })
})
