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
  const p: UserProfile = { ...BASE, life_events: [], _query: t }
  if (!t) return p

  // ── 자녀 나이 선처리 ── "아이가 셋이에요 7살 5살 2살"처럼 자녀 맥락에서 나이가 여러 개 나열되면
  // 전부 자녀 나이로 보고, 부모 나이 추출에서는 제외한다(첫 토큰을 부모 나이로 오인 방지).
  const kidKw = t.match(/아이|애(?!인)|자녀|아들|딸|아기|애들|손주|손자|손녀/)
  const kidCtxIdx = kidKw ? (kidKw.index ?? -1) : -1
  // 자녀 맥락 키워드 '이후'에 나열된 나이만 자녀 나이로 본다 — 그 앞의 'N살 엄마'(부모 나이)를
  //   자녀 나이로 흡수하던 오류 방지(예: "18살 엄마가 아이 7살 5살" → 자녀는 7·5, 부모는 18).
  const ageMatchesAll = [...t.matchAll(/(\d{1,2})\s*(?:살|세)/g)]
  const kidAgeMatches = kidCtxIdx >= 0 ? ageMatchesAll.filter((m) => (m.index ?? 0) > kidCtxIdx) : []
  // 1개여도 인정 — "아이가 10살"처럼 자녀 한 명을 명사-먼저로 말하면 나이가 유실돼(→기본 3세)
  //   10살 아이 부모에게 아동수당(만 9세 미만)을 과장 추천하던 결함 수정.
  // ⚠️ 18세 이하만 '개별' 필터 — 자녀 맥락 뒤에 부모 나이가 섞여도("아이 7살이고 저는 38살") 그 성인 나이는
  //   자녀로 흡수하지 않는다. (과거 .every(≤18): 뒤에 성인 나이 하나만 껴도 자녀 격리 전체가 꺼져
  //   자녀 나이(7)가 부모 나이로 오인되던 결함 — 감사 Finding 1)
  const kidAges18 = kidAgeMatches.filter((m) => parseInt(m[1], 10) <= 18)
  const multiKidAges = kidAges18.length >= 1 ? kidAges18.map((m) => parseInt(m[1], 10)) : null
  // 부모 나이 추출용 문자열: 자녀 나이 토큰만 제거(그 앞·뒤 부모 나이는 보존)
  let tForAge = t
  if (multiKidAges) for (const m of kidAges18) tForAge = tForAge.replace(m[0], ' ')

  // ── 나이 ── (단, "5살 아이"처럼 자녀를 가리키는 N살/세는 부모 나이로 잡지 않음)
  const exact = tForAge.match(/(\d{1,3})\s*(?:세|살)(?!\s*(?:아이|자녀|아들|딸|아기|아동|손주|손자|손녀))/)
  const decade = tForAge.match(/(\d0)\s*대/)
  let ageExplicit = true // 아래 분기 중 하나로 나이를 실제 파싱했는지(기본값 30과 구별 — 자립준비 등 나이 보정이 명시값을 덮지 않게)
  if (exact) p.age = parseInt(exact[1], 10)
  else if (decade) p.age = parseInt(decade[1], 10) + 5
  else if (/노인|어르신|고령|할머니|할아버지|경로/.test(t)) p.age = 70
  else if (/청년|대학생|취준|사회초년/.test(t)) p.age = 27
  else if (/청소년|중학생|고등학생|10대/.test(t)) p.age = 16
  else ageExplicit = false

  // ── 가구 형태 (뒤일수록 우선) ──
  if (/혼자|독거|1인|일인|홀로|혼자\s*살/.test(t)) p.household_type = '1인가구'
  if (/신혼/.test(t)) p.household_type = '신혼부부'
  // ⚠️ 맨 숫자 '3'은 '아이가 3살'·'13살'·'30살' 같은 흔한 문장을 다자녀로 오분류(셋째 이상 전용 현금혜택 과장 추천) →
  //   반드시 '3명'/'세 명' 명수 표기일 때만 다자녀로 본다(자녀 절과 통일).
  if (/다자녀|아이.*(셋|3\s*명|세\s*명)|자녀.*(셋|3\s*명|세\s*명)/.test(t)) p.household_type = '다자녀가구'
  // 다문화: '다문화/결혼이민' 외에 출신국·이주 표현도 인식(외국인·다문화 사각지대 데모 대응).
  //   ⚠️ 국가명은 '에서 왔/이주/시집/출신/이민' 같은 정주·혼인 맥락일 때만 — '일본 다녀왔어요'(여행)를 다문화로 오분류 방지.
  if (/다문화|결혼이민|이주여성|외국인|이주민|이주\s*노동|한국말.{0,5}(서툴|못하|못\s해|어눌|어려)|한국어.{0,5}(서툴|못하|어려)|외국인.*(배우자|결혼)|(베트남|필리핀|중국|캄보디아|태국|몽골|우즈베|네팔|일본|인도네시아|미얀마)\s*(에서\s*(왔|와서|이주|시집|장가|살)|출신|이민)|외국.*(에서\s*왔|출신)/.test(t)) p.household_type = '다문화가족'
  // 한부모: 명시어(한부모/미혼모/미혼부)는 그대로, 이혼·사별은 '자녀 양육 맥락'이 있을 때만 한부모로 본다.
  //   (배우자 사망 후 혼자 사는 어르신은 한부모가 아니라 1인가구 — '사별' 단독으로 한부모 처리하던 오분류 수정)
  const kidCtx = /아이|애기|자녀|키[우워]|양육|손주/.test(t)
  if (/한부모|미혼모|미혼부/.test(t) || (kidCtx && /혼자.*키[우워]|홀로.*키[우워]|이혼|사별|(남편|아내|배우자).*(죽|잃)/.test(t)))
    p.household_type = '한부모가족'
  if (/조손|손주.*키[우워]|(할머니|할아버지|조부모).*(키[우워]|양육|맡아|돌보)/.test(t)) p.household_type = '조손가구'

  // ── 소득 ──
  // 부정문 오탐 방지: '소득이 적지 않다/부족하지 않다/낮지 않다'는 저소득이 아님(오히려 여유).
  //   단 '넉넉하지 않다'는 저소득이 맞으므로 이 가드에서 제외(적/낮/부족/없이 '~지 않'으로 부정될 때만).
  //   ⚠️ 저소득 트리거(아래)가 '형편/생활/살기 + 어렵·힘들·막막·곤란·빠듯·쪼들'에도 걸리므로, 이 부정 가드도
  //   같은 어려움 어간을 포함해야 "형편이 어렵지 않아요"(오히려 여유)를 저소득으로 오판하지 않는다(감사).
  const incomeNegated = /(적|낮|부족|없|어렵|어려|힘[들드]|막막|곤란|빠듯|쪼들)\S{0,2}(지\s*(않|는\s*않)|하지\s*않|치\s*않)/.test(t)
  if (/기초생활|기초수급|수급자|생계급여|기초\s*수급/.test(t)) p.income_percentile = 28
  else if (/차상위/.test(t)) p.income_percentile = 45
  // 저소득: '소득이 많지 않다·많이 부족하다·넉넉지 않다' 같은 부정형도 저소득으로 흡수(고소득 오분류 방지).
  //   소득뿐 아니라 '월급·벌이·수입·연봉이 적다'(워킹푸어)와 '장사 안돼·매출 줄·폐업'(자영업 부진)도 저소득 신호로 흡수.
  // ⚠️ 한국어 활용 주의: '어렵다'는 '어렵습니다'(어렵)와 '어려워요/어려운'(어려)로 갈린다 → 둘 다(어렵|어려) 매칭해야
  //   가장 흔한 표현이 누락되지 않는다. '거르다'도 '거를/걸러'로 변형되므로 함께.
  // ⚠️ 한국어 활용: '어렵다'=어렵/어려, '힘들다'=ㄹ불규칙(힘들/힘듭/힘드/힘든), '나쁘다'=나빠/나쁨/나쁩/나쁜.
  //   어간 하나만 쓰면 격식체(-습니다)·관형형(-ㄴ)이 통째로 누락됨 → char class로 활용 어미 모두 포괄.
  else if (!incomeNegated && /저소득|(?:소득|월급|월수입|벌이|수입|연봉).*(없|적|낮|많지\s*않|많진\s*않|많이\s*부족|넉넉[하지]*\s*않|부족|시원찮|신통찮|쥐꼬리)|형편.*(어렵|어려|힘[들듭드든]|안\s*좋|나[쁨쁩쁜]|막막)|(?:생활(?:비)?|생계).*(어렵|어려|힘[들듭드든]|빠듯|쪼들|막막|곤란)|살기.*(어렵|어려|힘[들듭드든]|막막)|돈.*(없|부족|막막)|가난|빈곤|생활고|끼니.*(거르|거를|걸러|굶)|입에\s*풀칠|장사.*안\s*(돼|되|굴러)|매출.*(줄|없|감소|반토막)|폐업|가게.*(접|문\s*닫)/.test(t)) p.income_percentile = 40
  else if (/고소득|소득.*많|여유.*있|잘\s*사/.test(t)) p.income_percentile = 130
  // 주거지원(월세·전세·임대) 문의인데 소득 신호가 없으면(기본 80 유지): 기본값이 물어본 혜택을 소득으로
  //   숨기는 거짓음성이 된다(월세지원은 중위 60% 이하) → 중립 프라이어인 '중위(50)'로만 낮춰 물어본 혜택이
  //   보이게 한다. 단정이 아니라 발견을 돕는 것 — 실제 자격은 카드의 자격 기준에서 확인한다.
  else if (!incomeNegated && /(월세|전세|임대|주거)\S{0,4}\s*(지원|보조|급여|혜택|도움|받|얼마|가능|신청|알아)/.test(t)) p.income_percentile = 50
  // 주거 위기(노숙·무주택·길에서 지냄·쪽방) = 명백한 저소득 → 주거급여·긴급복지·생계급여 발굴(else-if 아님: 항상 반영)
  if (/노숙|집이?\s*없|갈\s*곳\s*(이|도)?\s*없|잘\s*곳\s*(이|도)?\s*없|길에서\s*(자|지내|살)|쪽방|한뎃잠|거리\s*생활/.test(t)) {
    p.income_percentile = Math.min(p.income_percentile, 30)
  }

  // ── 장애 ── 자녀가 장애인 경우(장애 아동 발달재활 등)와 본인 장애를 구분 — '장애가 있는 아들' 같은 자녀 맥락은 성인 장애로 오귀속하지 않음
  if (/장애/.test(t)) {
    const childDis = /(아들|딸|자녀|아이|애).{0,10}장애|장애.{0,10}(아들|딸|자녀|아이)/.test(t)
    // 자녀 명사가 장애 '바로 앞'(조사+공백 정도)에 붙으면 자녀 장애로 확정한다 — 앞에 '저는' 같은 자기지칭이
    //   자녀 명사를 건너뛰어(.{0,6}) 본인 장애로 오귀속하던 결함 차단(예 "저는 아이가 장애가 있어요", 감사 Finding 2)
    const childDisTight = /(아들|딸|자녀|아이|애)(?:가|는|이|을|를|도|한테|에게)?\s*장애/.test(t)
    const selfDis = /(저|제가|내가|본인|나).{0,6}장애|장애인이(에요|다|라)|장애\s*(등록|판정)|중증\s*장애/.test(t)
    if (childDisTight || (childDis && !selfDis)) {
      p.has_children = true
      if (!p.life_events.includes('장애아동')) p.life_events.push('장애아동')
    } else {
      p.disability = true
      p.disability_grade = /중증|심한|1급|2급|3급/.test(t) ? '1급' : '4급'
      p.life_events.push('장애진단')
    }
  }

  // ── 임신·자녀 ──
  if (/임신|임산부|만삭|출산\s*예정|곧\s*출산/.test(t)) { p.is_pregnant = true; p.life_events.push('출산') }
  // 나이-먼저 자녀 표기 — "5살 아이" 및 필러가 낀 "5살짜리/정도 아이", 손주 표기까지.
  const kids = [...t.matchAll(/(\d{1,2})\s*(살|세)\s*(?:짜리|정도|가량|쯤|밖에)?\s*(아이|자녀|아들|딸|아기|손주|손자|손녀)/g)]
  const kidCount = t.match(/(?:아이|애들?|자녀)\s*(둘|두|셋|세|넷|[2-4])\s*(?:명|이|을|이에요|입니다)?/)
  const COUNT: Record<string, number> = { 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4 }
  // 부정문 오탐 방지: '자녀 없이·아이 없어요·무자녀·딩크'는 자녀 있음이 아니다(소득 incomeNegated와 동일 취지).
  //   → 이 가드가 없으면 childless 사용자에게 아동수당·부모급여가 잘못 추천된다.
  //   '아이는 아직 없어요'처럼 조사(는/가/도)+필러(아직/여태)가 끼는 무자녀만 잡되, '아이 셋 돈이 없어요'처럼
  //   '없'이 '돈'을 부정하는 다자녀 문장을 무자녀로 오판하지 않게 — 임의 6자 창(.{0,6}) 대신 조사·필러만 허용(감사 회귀수정).
  const childNegated = /(아이|자녀|자식|애|아들|딸|손주|손자|손녀)(는|은|가|도|를)?\s*(아직은?|여태|현재|당장|지금은?)?\s*(없|안\s*낳|안\s*키)/.test(t) || /무자녀|딩크|자녀\s*계획\s*없/.test(t)
  if (multiKidAges) { p.has_children = true; p.children_ages = multiKidAges }
  else if (kids.length) { p.has_children = true; p.children_ages = kids.map((m) => parseInt(m[1], 10)) }
  else if (!childNegated && /아이|자녀|아들|딸|육아|아기|영유아|어린이집|유치원|키[우워]|쌍둥이|신생아|갓\s*태어|손주|손자|손녀/.test(t)) {
    const bornSignal = /신생아|갓난|갓\s*태어|쌍둥이|0\s*살|돌\s*전|아기|영아|백일|젖먹이|막\s*낳/.test(t)
    const caregiving = /육아|키[우워]|어린이집|유치원|등원|먹이|돌보|재우/.test(t)
    if (bornSignal) { p.has_children = true; p.children_ages = /쌍둥이/.test(t) ? [0, 0] : [0] }
    else if (kidCount) { p.has_children = true; p.children_ages = Array(COUNT[kidCount[1]] ?? parseInt(kidCount[1], 10)).fill(5) }
    else if (p.is_pregnant && /첫\s*(아이|애|아기)|첫아이|처음.*아이/.test(t) && !caregiving && !/있|아프|아파|둘째|셋째|첫째/.test(t)) {
      // 임신 중 + '첫 아이'(태어날 첫 아이) 명시 + 기존 자녀 신호(있/키우/둘째…) 없음 = 아직 자녀 없음 → 날조 안 함
      //   (예제칩 "임신 중이고 첫 아이예요"). ⚠️ "임신했고 딸이 있어요"(둘째 임신)엔 안 걸리게 좁힘(감사 회귀수정).
    }
    else { p.has_children = true; if (!p.children_ages.length) p.children_ages = [3] }
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
  //   + 본인이 아파서 일/생계가 어려운 경우(근로불가 건강)도 질병 신호 — 긴급복지·의료급여 발굴 유도.
  if (/암(이|에|을|으로|\s|$)|백혈병|투병|입원(했|중|하)|큰\s*병|수술\s*받|수술비|희귀질환|난치병|중증질환|지병|만성질환|병원비|치료비|(아이|애(?!인)|아들|딸|아기).*아[파프픈팠픕]|(몸|건강).{0,4}(아[파프픈팠픕]|안\s*좋|나[빠쁨쁩쁜쁘])|아파서\s*(일|근로|출근|생계|움직)/.test(t) && !p.life_events.includes('질병')) {
    p.life_events.push('질병')
  }

  // ── 안전 위기(폭력·학대) ── 자연어로 피해를 알리면 폭력피해 지원·1366을 최우선 발굴(안전 직결).
  //   '맞아요'(=옳다) 오탐 방지 위해 구타·폭행 맥락만: 때리/때린/폭행/구타/맞고 살/학대/가정폭력/성폭력/데이트폭력.
  if (/때리|때린|때려|폭행|구타|맞고\s*살|두들겨|가정폭력|성폭력|데이트\s*폭력|학대(당|받|해)|남편이\s*(때|폭)|아내가\s*(때|폭)/.test(t) && !p.life_events.includes('가정폭력')) {
    p.life_events.push('가정폭력')
  }

  // ── 보훈·국가유공 ── 참전·유공·상이군경 → 보훈 지원 발굴
  if (/보훈|국가유공|유공자|참전용사|참전\s*군인|상이군경|고엽제|월남전|독립유공|6\.?25\s*참전/.test(t) && !p.life_events.includes('보훈')) {
    p.life_events.push('보훈')
  }

  // ── 산재·업무상 부상 ── 일하다 다침 → 산재보험·긴급복지 발굴
  if (/산재|산업재해|일하다.{0,6}다[쳤쳐치]|업무.{0,4}(중\s*)?다[쳤쳐]|다쳐서\s*일|작업\s*중\s*다[쳤쳐]|공사.{0,4}다[쳤쳐]/.test(t) && !p.life_events.includes('산재')) {
    p.life_events.push('산재')
  }

  // ── 고용 ── (한국어 활용: '잘렸/짤렸', 격식체 '안 됩니다', 조사 낀 '일을 구하다' 등 포괄)
  if (/실직|실업|퇴사|해고|(잘|짤)렸|일자리.*(잃|없)|직장.*잃|짤림|잘림/.test(t)) {
    p.employment_status = 'unemployed'
    if (!p.life_events.includes('실직')) p.life_events.push('실직')
  } else if (/구직|취준|취업.*준비|일(을|자리)?.{0,3}구하|일자리.*찾|구직활동|취(업|직).*안\s*(돼|되|됨|됩니|되네|되서)|일자리.*(못\s*구|안\s*생)|일.{0,3}못\s*구|백수/.test(t)) {
    p.employment_status = 'unemployed'
  } else if (/자영업|자영|장사(를|가|해|하|합)|가게.*(운영|해|하|차림|봐)|개인\s*사업|사업.*(운영|해요|합니다|중)|프리랜서|노점|포장마차|1인\s*사업/.test(t)) {
    p.employment_status = 'self'
  } else if (/대학생|대학원생|학생|휴학|복학|재학|등록금/.test(t)) {
    p.employment_status = 'student'
  } else if (/직장인|회사원|재직|근무\s*(중|해|하)|다니고\s*있|(직장|회사|공장|공기업|중소기업|대기업).{0,3}다[니녀닙]|취업했|취직했|맞벌이|일하는|일하고\s*있|일합니다|출[근퇴]|알바|아르바이트|파트타임|정규직|계약직/.test(t)) {
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
    if (!ageExplicit) p.age = 21 // 자립준비청년·보호종료아동 통상 만 18~24 (명시 나이는 덮지 않음)
  }
  if (/가정폭력|데이트폭력|성폭력|학대\s*피해|폭력.*피해|피해\s*여성/.test(t)) p.life_events.push('가정폭력')

  // ── 지역(시·도) ──
  const sido = sidoOf(t)
  if (sido) p.region = sido

  // ── 성별 ── '명시적 자기 지칭'에서만 추정. [signalCount는 파일 하단 profileSignalCount 참조] 관계 명사(남편/아내/어머니/아들/딸 …)는 '다른 사람'을 가리켜
  //   화자 성별을 오추정한다 — 특히 "남편이 때려요"(아내 신고)를 남성으로 오태깅하면 여성 전용 지원에서
  //   부당 배제된다(감사). 성별은 여성 전용 '배제' 게이트에만 쓰이므로 미설정('other')이 안전·포용적.
  // ⚠️ '남자/여자'가 제3자 합성어(남자친구·여자아이·남자애·여자형제…)에 박혀 화자 성별을 오추정하지 않게 한다 —
  //   성별은 여성 전용 지원 '배제' 게이트에 쓰이므로, 오태깅은 부당 배제로 직결된다
  //   (예 "남자친구한테 맞고 살아요"[여성 DV 신고]를 남성으로 오태깅 → 여성 지원 배제, 감사 Finding 3)
  if (/임신|임산부|산모|미혼모|여성|여자(?!친구|아이|애|사람|형제|조카|짝)/.test(t)) p.gender = 'female'
  else if (/남성|남자(?!친구|아이|애|사람|형제|조카|짝)/.test(t)) p.gender = 'male'

  // 나이를 '실제 수치'로 잡았는지 기록 — '청년→27'·자립준비→21·기본 30 같은 추정은 false.
  //   대화형 진입(QuickAsk)이 이 값으로 '정확한 나이를 되물을지'를 판단한다(퉁침 방지).
  //   exact(N세/살)만 명시로 본다 — 'N0대'는 대(범위) 추정이라 되물음 대상(중앙값 오차 방지).
  p._ageExplicit = !!exact

  return p
}

/**
 * 문장에서 실제로 추출된 프로필 신호 수 — '상황 문장'(분석감) 판별 근거.
 * 통화·챗이 "72세 혼자 소득 적어요"(신호≥2 → 즉시 분석)와 "기초연금 알려줘"(0 → 지식 답변)를
 * 구분할 때 쓴다. 임계 판단은 호출부 몫(단정 아님) — 파서가 못 잡은 문장은 0으로 정직하게.
 */
export function profileSignalCount(text: string): number {
  const p = parseProfileFromText(text)
  let n = 0
  if (p.age !== BASE.age) n++
  if (p.household_type) n++
  if (p.income_percentile !== BASE.income_percentile) n++
  if (p.disability) n++
  if (p.is_pregnant) n++
  if (p.has_children) n++
  if (p.employment_status) n++
  if (p.region) n++
  if ((p.life_events || []).length > 0) n++
  return n
}
