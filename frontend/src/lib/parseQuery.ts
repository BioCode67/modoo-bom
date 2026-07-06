import type { UserProfile } from './welfare-engine'
import { sidoOf } from './welfare-engine'

/**
 * 자연어 한 문장 → 프로필 신호 추출(LLM 없이 규칙 기반, 비용 0).
 * 위저드 없이도 "72세 혼자 사는데 소득 적어요" 같은 문장으로 즉시 분석하기 위함.
 * 완벽한 NLU가 아니라 흔한 한국어 표현을 폭넓게 잡는 휴리스틱 — 신호 없으면 기본값.
 */
const BASE: UserProfile = {
  name: '', age: 30, gender: 'other', region: '', household_type: '',
  income_percentile: 80, disability: false, disability_grade: '',
  employment_status: '', has_children: false, children_ages: [],
  is_pregnant: false, life_events: [],
}

export function parseProfileFromText(text: string): UserProfile {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  const p: UserProfile = { ...BASE, life_events: [] }
  if (!t) return p

  // ── 자녀 나이 선처리 ── "아이가 셋이에요 7살 5살 2살"처럼 자녀 맥락에서 나이가 여러 개 나열되면
  // 전부 자녀 나이로 보고, 부모 나이 추출에서는 제외한다(첫 토큰을 부모 나이로 오인 방지).
  const kidContext = /아이|애(?!인)|자녀|아들|딸|아기|애들/.test(t)
  const ageTokens = [...t.matchAll(/(\d{1,2})\s*(?:살|세)/g)].map((m) => parseInt(m[1], 10))
  const multiKidAges = kidContext && ageTokens.length >= 2 && ageTokens.every((a) => a <= 18) ? ageTokens : null
  const tForAge = multiKidAges ? t.replace(/\d{1,2}\s*(?:살|세)/g, '') : t

  // ── 나이 ── (단, "5살 아이"처럼 자녀를 가리키는 N살/세는 부모 나이로 잡지 않음)
  const exact = tForAge.match(/(\d{1,3})\s*(?:세|살)(?!\s*(?:아이|자녀|아들|딸|아기|아동|손주|손자|손녀))/)
  const decade = tForAge.match(/(\d0)\s*대/)
  if (exact) p.age = parseInt(exact[1], 10)
  else if (decade) p.age = parseInt(decade[1], 10) + 5
  else if (/노인|어르신|고령|할머니|할아버지|경로/.test(t)) p.age = 70
  else if (/청년|대학생|취준|사회초년/.test(t)) p.age = 27
  else if (/청소년|중학생|고등학생|10대/.test(t)) p.age = 16

  // ── 가구 형태 (뒤일수록 우선) ──
  if (/혼자|독거|1인|일인|홀로|혼자\s*살/.test(t)) p.household_type = '1인가구'
  if (/신혼/.test(t)) p.household_type = '신혼부부'
  if (/다자녀|아이.*(셋|3|세 명)|자녀.*(셋|3명)/.test(t)) p.household_type = '다자녀가구'
  // 다문화: '다문화/결혼이민' 외에 출신국·이주 표현도 인식(외국인·다문화 사각지대 데모 대응)
  if (/다문화|결혼이민|이주여성|외국인.*(배우자|결혼)|(베트남|필리핀|중국|캄보디아|태국|몽골|우즈베|네팔|일본|인도네시아|미얀마).*(왔|출신|에서\s*옴)|외국.*(에서\s*왔|출신)/.test(t)) p.household_type = '다문화가족'
  // 한부모: 명시어(한부모/미혼모/미혼부)는 그대로, 이혼·사별은 '자녀 양육 맥락'이 있을 때만 한부모로 본다.
  //   (배우자 사망 후 혼자 사는 어르신은 한부모가 아니라 1인가구 — '사별' 단독으로 한부모 처리하던 오분류 수정)
  const kidCtx = /아이|애기|자녀|키[우워]|양육|손주/.test(t)
  if (/한부모|미혼모|미혼부/.test(t) || (kidCtx && /혼자.*키[우워]|홀로.*키[우워]|이혼|사별|(남편|아내|배우자).*(죽|잃)/.test(t)))
    p.household_type = '한부모가족'
  if (/조손|손주.*키우|할머니.*키우/.test(t)) p.household_type = '조손가구'

  // ── 소득 ──
  if (/기초생활|기초수급|수급자|생계급여|기초\s*수급/.test(t)) p.income_percentile = 28
  else if (/차상위/.test(t)) p.income_percentile = 45
  // 저소득: '소득이 많지 않다·많이 부족하다·넉넉지 않다' 같은 부정형도 저소득으로 흡수(고소득 오분류 방지).
  //   소득뿐 아니라 '월급·벌이·수입·연봉이 적다'(워킹푸어)와 '장사 안돼·매출 줄·폐업'(자영업 부진)도 저소득 신호로 흡수.
  else if (/저소득|(?:소득|월급|월수입|벌이|수입|연봉).*(없|적|낮|많지\s*않|많진\s*않|많이\s*부족|넉넉[하지]*\s*않|부족)|형편.*(어렵|힘들)|생활(?:비)?.*(어렵|힘들|빠듯|쪼들)|돈.*(없|부족)|가난|빈곤|장사.*안\s*(돼|되|굴러)|매출.*(줄|없|감소|반토막)|폐업|가게.*(접|문\s*닫)/.test(t)) p.income_percentile = 40
  else if (/고소득|소득.*많|여유.*있|잘\s*사/.test(t)) p.income_percentile = 130

  // ── 장애 ──
  if (/장애/.test(t)) {
    p.disability = true
    p.disability_grade = /중증|심한|1급|2급|3급/.test(t) ? '1급' : '4급'
    p.life_events.push('장애진단')
  }

  // ── 임신·자녀 ──
  if (/임신|임산부|만삭|출산\s*예정|곧\s*출산/.test(t)) { p.is_pregnant = true; p.life_events.push('출산') }
  const kids = [...t.matchAll(/(\d{1,2})\s*(살|세)\s*(아이|자녀|아들|딸|아기)/g)]
  const kidCount = t.match(/(?:아이|애들?|자녀)\s*(둘|두|셋|세|넷|[2-4])\s*(?:명|이|을|이에요|입니다)?/)
  const COUNT: Record<string, number> = { 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4 }
  if (multiKidAges) { p.has_children = true; p.children_ages = multiKidAges }
  else if (kids.length) { p.has_children = true; p.children_ages = kids.map((m) => parseInt(m[1], 10)) }
  else if (/아이|자녀|아들|딸|육아|아기|영유아|어린이집|유치원|키[우워]|쌍둥이|신생아|갓\s*태어/.test(t)) {
    p.has_children = true
    if (/신생아|갓난|갓\s*태어|쌍둥이|0\s*살|돌\s*전/.test(t)) p.children_ages = /쌍둥이/.test(t) ? [0, 0] : [0]
    else if (kidCount) p.children_ages = Array(COUNT[kidCount[1]] ?? parseInt(kidCount[1], 10)).fill(5)
    else if (!p.children_ages.length) p.children_ages = [3]
  }
  if (p.children_ages.length >= 3) p.household_type = p.household_type || '다자녀가구'
  if (/출산|아기.*낳|애.*낳/.test(t) && !p.life_events.includes('출산')) p.life_events.push('출산')

  // ── 출생 순서(첫째·둘째·셋째…) ── "셋째 낳았어요"처럼 '아이/자녀' 명시어 없이도 자녀·출산·다자녀를 인식
  const ORDINAL: Record<string, number> = { 첫째: 1, 둘째: 2, 셋째: 3, 넷째: 4, 다섯째: 5 }
  const ord = t.match(/(첫째|둘째|셋째|넷째|다섯째|막내)/)
  if (ord) {
    p.has_children = true
    const born = /낳|출산|태어|생겼|가졌|봤/.test(t)
    if (born && !p.life_events.includes('출산')) p.life_events.push('출산')
    if (!p.children_ages.length) p.children_ages = born ? [0] : [5]
    const n = ORDINAL[ord[1]]
    if (n && n >= 3) p.household_type = p.household_type || '다자녀가구'
  }

  // ── 질병(투병·입원·의료비) ── 갑작스러운 질병·큰 의료비는 긴급복지·의료 신호
  //   희귀·난치·중증질환, 병원비/치료비/수술비 부담, 아픈 자녀까지 포함(의료 지원 발굴 유도)
  if (/암(이|에|을|으로|\s|$)|백혈병|투병|입원(했|중|하)|큰\s*병|수술\s*받|수술비|희귀질환|난치병|중증질환|지병|만성질환|병원비|치료비|(아이|애(?!인)|아들|딸|아기).*아[파프픈팠]/.test(t) && !p.life_events.includes('질병')) {
    p.life_events.push('질병')
  }

  // ── 고용 ──
  if (/실직|실업|퇴사|해고|잘렸|일자리.*(잃|없)|직장.*잃/.test(t)) {
    p.employment_status = 'unemployed'
    if (!p.life_events.includes('실직')) p.life_events.push('실직')
  } else if (/구직|취준|취업.*준비|일\s*구하|일자리.*찾|구직활동/.test(t)) {
    p.employment_status = 'unemployed'
  } else if (/대학생|대학원생|학생|휴학|복학|재학|등록금/.test(t)) {
    p.employment_status = 'student'
  } else if (/직장인|회사원|재직|근무\s*(중|해)|다니고\s*있|직장.*다|취업했|취직했|맞벌이/.test(t)) {
    p.employment_status = 'employed'
  }
  // 주거 위기(집 상실·재개발·화재 등)는 저소득 신호로 반영 → 주거급여·긴급복지·저소득 매칭 유도
  // (실직/질병이 아니면 별도 이벤트는 넣지 않음 — 엉뚱한 실업급여 추천 방지)
  if (/집.*(잃|없어졌|철거)|화재.*(집|주택)|재개발.*(쫓|나가)|쫓겨나|노숙|갈\s*곳\s*없/.test(t)) {
    if (p.income_percentile === BASE.income_percentile) p.income_percentile = 40
  }

  // ── 특정 대상군(복지 사각지대) ── 프로필 필드가 없는 자격군은 life_events 신호로 표시하고,
  //   엔진(TEXT_SIGNALS)이 이를 저신뢰 '관련 복지'로 매칭한다. 자격을 단정하지 않으므로 과장이 아니다.
  if (/북한이탈|탈북|새터민/.test(t)) p.life_events.push('북한이탈')
  if (/국가유공|보훈|유공자|참전유공|고엽제|독립유공|상이군경|보훈\s*대상/.test(t)) p.life_events.push('보훈')
  if (/자립준비|보호종료|아동복지시설.*퇴소|가정위탁.*종료/.test(t)) {
    p.life_events.push('자립준비')
    if (p.age === BASE.age) p.age = 21 // 자립준비청년·보호종료아동 통상 만 18~24
  }
  if (/가정폭력|데이트폭력|성폭력|학대\s*피해|폭력.*피해|피해\s*여성/.test(t)) p.life_events.push('가정폭력')

  // ── 지역(시·도) ──
  const sido = sidoOf(t)
  if (sido) p.region = sido

  // ── 성별 ──
  if (/임신|임산부|산모|미혼모|할머니|어머니|엄마|아내|여성|여자|딸/.test(t)) p.gender = 'female'
  else if (/할아버지|아버지|아빠|남편|남성|남자|아들/.test(t)) p.gender = 'male'

  return p
}
