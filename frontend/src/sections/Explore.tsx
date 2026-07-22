import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, X, Mic, ArrowDownWideNarrow, Calculator, ChevronDown, Globe, Sparkles, Volume2, Square, Languages } from 'lucide-react'
import { useSpeech } from '@/lib/useSpeech'
import { useTTS } from '@/lib/useTTS'
import { hybridSearch, warmupSemantic, type SemanticHit } from '@/lib/semanticSearch'
import { detectLang, detectUiLang } from '@/lib/detectLang'
import { isUiLang } from '@/lib/i18nLite'
import { benefitTypeOf, BENEFIT_TYPE_META, type BenefitType } from '@/lib/benefitType'
import { useAppStore } from '@/store/useAppStore'
import { IncomeCalculator } from '@/components/IncomeCalculator'
import { parseMonthly, isCashBenefit } from '@/lib/format'
import { applyDifficulty } from '@/lib/priority'
import { applyChannel } from '@/lib/roadmap'
import { buildAiAnswer } from '@/lib/aiAnswer'
import { supportsOnDeviceTranslation, getTranslator, zhTarget } from '@/lib/onDeviceTranslate'
import { queryConcepts, relevance } from '@/lib/search'
import { cn } from '@/lib/utils'
import type { Policy } from '@/data/policies'
import { useCatalog } from '@/data/useCatalog'
import { sidoOf, guOf, collapseProgramDuplicates, isClosedForNew, type EligiblePolicy } from '@/lib/welfare-engine'
import { PolicyCard } from '@/components/PolicyCard'
import { PolicyDetailDrawer } from '@/components/PolicyDetailDrawer'
import { Glossary } from '@/components/Glossary'

// match: category에 포함되면 해당 버킷. test: 이름·혜택 등 넓은 필드로 판정(장학금·서민금융처럼
//   카테고리가 아니라 정책명에 흩어져 있는 유형을 정확히 모아 보여주기 위함).
const BUCKETS: { key: string; label: string; emoji: string; match?: string[]; test?: (p: Policy) => boolean }[] = [
  { key: 'all', label: '전체', emoji: '🌼' },
  { key: 'senior', label: '노인', emoji: '👵', match: ['노인'] },
  { key: 'child', label: '아동·육아', emoji: '👶', match: ['아동', '영유아', '보육'] },
  { key: 'youth', label: '청년', emoji: '🧑', match: ['청년'] },
  { key: 'disabled', label: '장애인', emoji: '♿', match: ['장애'] },
  { key: 'birth', label: '임신·출산', emoji: '🤰', match: ['임신', '출산', '산모', '모성', '임산부'] },
  { key: 'lowincome', label: '저소득', emoji: '🤝', match: ['저소득', '생계', '기초'] },
  // 🏠 주거 — 카테고리 '주거' + 정책명의 행복주택·임대주택 등을 함께 모은다(공고가 이름에만 있는 경우 대응)
  { key: 'house', label: '주거·주택', emoji: '🏠', test: (p) => p.category.includes('주거') || /행복주택|임대주택|전세임대|매입임대|청년주택|공공임대|국민임대|주거급여|월세\s*지원|전세\s*지원|주택\s*공고/.test(`${p.name} ${p.benefit}`) },
  // 🎓 장학금 — 이름·대상·혜택에 장학/학자금이 있으면(카테고리가 청년·교육 등으로 흩어져 있어 test 필요)
  { key: 'scholarship', label: '장학금', emoji: '🎓', test: (p) => /장학|학자금|스칼러십|등록금\s*지원/.test(`${p.name} ${p.target} ${p.benefit}`) },
  // 🏦 서민금융 — 서민금융 시드(FIN-)·대출/융자형·햇살론 등(대출이라 현금성 합산엔 이미 제외됨)
  { key: 'finance', label: '서민금융', emoji: '🏦', test: (p) => p.id.startsWith('FIN-') || benefitTypeOf(p) === 'loan' || /서민금융|햇살론|미소금융|소액생계비|근로자\s*햇살|자립\s*자금/.test(`${p.name} ${p.benefit}`) },
  { key: 'medical', label: '의료', emoji: '🏥', match: ['의료', '건강'] },
  { key: 'job', label: '고용', emoji: '💼', match: ['고용', '취업', '일자리'] },
  { key: 'edu', label: '교육', emoji: '📚', match: ['교육', '학'] },
  { key: 'family', label: '가족', emoji: '👨‍👩‍👧', match: ['한부모', '가족', '다문화'] },
  { key: 'private', label: '민간재단', emoji: '💝', match: ['민간'] }, // 기업·재단 장학/의료/위기지원 큐레이션
  { key: 'veteran', label: '보훈', emoji: '🎖️', match: ['보훈'] },
  { key: 'farm', label: '농어민', emoji: '🌾', match: ['농어'] },
]

type SortKey = 'default' | 'amount' | 'name' | 'ease'
const DIFF_RANK = { easy: 0, medium: 1, hard: 2 } as const
const PAGE = 60 // '더 보기' 1회당 추가 노출 수
// 첫 화면·검색어 변경 직후 노출 수 — 검색 중 지연 커밋(카드 마운트) 비용을 낮춘다.
// CPU×4 실측: 60장 커밋이 타이핑 중 100~600ms 롱태스크의 주범(구형 PC 타이핑 끊김). 24장도 2~3화면 분량.
const PAGE_FIRST = 24

// 다국어 AI 의미 검색 체험용 예시(클릭하면 바로 검색) — 다양한 언어로 "대단함"을 즉시 각인
const AI_EXAMPLES: { text: string; lang: string }[] = [
  { text: '노인인데 돈이 없어요', lang: 'ko' },
  { text: 'I lost my job and need help', lang: 'en' },
  { text: 'Tôi cần hỗ trợ tiền thuê nhà', lang: 'vi' }, // 집세 지원이 필요해요
  { text: '老年人没有收入', lang: 'zh' }, // 노인 무소득
  { text: '혼자 아이를 키워요', lang: 'ko' },
]

export function Explore() {
  const [q, setQ] = useState('')
  // 검색 입력 지연값 — 5,300건 관련도 계산·리스트 렌더를 키입력마다 동기로 돌리면 구형 PC에서
  // 타이핑이 얼어붙는다(CPU×4 실측: 8타에 롱태스크 16회·최장 1011ms·합계 5.0s). 입력칸은 q로 즉시
  // 반응하고, 무거운 filtered 계산·리스트 렌더는 지연값으로 미뤄 중간 타이핑 프레임을 건너뛴다.
  const dq = useDeferredValue(q)
  const [bucket, setBucket] = useState('all')
  const [sort, setSort] = useState<SortKey>('default')
  const [onlyCash, setOnlyCash] = useState(false)
  const [benefitType, setBenefitType] = useState('')
  const [region, setRegion] = useState('')
  const [gungu, setGungu] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [selected, setSelected] = useState<Policy | EligiblePolicy | null>(null)
  const [visible, setVisible] = useState(PAGE_FIRST)
  // 온디바이스 AI 의미 검색(다국어)
  const [aiMode, setAiMode] = useState(false)
  const [aiHits, setAiHits] = useState<SemanticHit[] | null>(null)
  // aiHits가 '어떤 질의'의 결과인지 — 새 질의 임베딩이 도는 동안 직전 질의의 결과로 답변/번역이 만들어지는
  //   스테일 문제(감사)를 막기 위해, 답변은 aiHitsQuery === 현재 질의일 때만 생성한다.
  const [aiHitsQuery, setAiHitsQuery] = useState('')
  const [aiProgress, setAiProgress] = useState<{ stage: string; pct?: number } | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [voiceUsed, setVoiceUsed] = useState(false) // 음성으로 질의하면 AI가 음성으로 답
  const [voiceLang, setVoiceLang] = useState('ko-KR') // 음성 입력 언어(다국어)
  const aiRunId = useRef(0)
  const tts = useTTS()
  const catalog = useCatalog()
  const aiIntent = useAppStore((s) => s.aiIntent)
  const setAiIntent = useAppStore((s) => s.setAiIntent)
  const aiQuery = useAppStore((s) => s.aiQuery)
  const setAiQuery = useAppStore((s) => s.setAiQuery)
  const { supported: micOk, listening, toggle: toggleMic, error: micError } = useSpeech((text) => { setQ(text); setVoiceUsed(true) }, voiceLang)

  // 홈 카드·외국어 입력 등으로 진입한 경우 AI 모드 자동 활성화(+질의 프리필)
  useEffect(() => {
    if (aiIntent) {
      setAiMode(true)
      if (aiQuery) setQ(aiQuery)
      setAiIntent(false)
      setAiQuery('')
    }
  }, [aiIntent, aiQuery, setAiIntent, setAiQuery])

  // '우리 동네 복지'로 진입한 경우 해당 시·도 필터를 미리 지정
  const pendingRegion = useAppStore((s) => s.pendingRegion)
  const setPendingRegion = useAppStore((s) => s.setPendingRegion)
  useEffect(() => {
    if (pendingRegion) { setRegion(pendingRegion); setPendingRegion('') }
  }, [pendingRegion, setPendingRegion])

  // 선택한 시·도 안에서 고를 수 있는 시·군·구 목록(해당 시도 LOC 정책에서 추출, 가나다순)
  const gunguOptions = useMemo(() => {
    if (!region) return []
    const set = new Set<string>()
    for (const p of catalog) {
      if (!p.id.startsWith('LOC-') || sidoOf(p.target) !== region) continue
      const g = guOf(p.target)
      if (g) set.add(g)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [catalog, region])

  // 필터/검색/정렬 변경 시 노출 개수 초기화(점진 렌더링)
  // 검색어가 있으면 초기 노출을 PAGE(60)로 — 검색 결과 가시성 계약 유지(실측: '대출' 검색에서
  // 서민금융(FIN) 최고 순위 48위가 24컷에 잘려 e2e:fin 회귀). 타이핑 부드러움은 dq 지연이 담당하고,
  // 확정 커밋 1회의 60장 비용은 수용(중간 커밋 다발이 문제였지 최종 1회가 아님). 브라우징(무검색)은 24 유지.
  useEffect(() => { setVisible(dq.trim() ? PAGE : PAGE_FIRST) }, [dq, bucket, sort, onlyCash, benefitType, region, gungu])
  // 시·도가 바뀌면 시·군·구 선택 초기화
  useEffect(() => { setGungu('') }, [region])

  // AI 의미 검색: 켜져 있고 질의가 있으면 온디바이스 임베딩으로 검색(디바운스+레이스가드)
  useEffect(() => {
    if (!aiMode) { setAiHits(null); setAiHitsQuery(''); setAiProgress(null); setAiError(null); return }
    const query = q.trim()
    if (!query) {
      // 질의 전이라도 토글을 켜면 모델을 미리 내려받아 체감 지연을 줄인다.
      setAiHits(null); setAiHitsQuery('')
      const wid = ++aiRunId.current
      warmupSemantic((p) => { if (wid === aiRunId.current) setAiProgress(p) })
        .then(() => { if (wid === aiRunId.current) setAiProgress(null) })
        // 실패 시 진행바를 반드시 내린다 — 안 내리면 오류문구 옆에 멈춘 진행바가 남는다(감사 Finding 5)
        .catch((e) => { console.error('[AI검색] 모델 워밍업 실패:', e); if (wid === aiRunId.current) { setAiProgress(null); setAiError('AI 모델을 불러오지 못했어요. 네트워크를 확인하거나 일반 검색을 이용해주세요.') } })
      return
    }
    const runId = ++aiRunId.current
    setAiError(null)
    const t = setTimeout(async () => {
      try {
        // 하이브리드(의미+키워드 RRF): "기초연금" 같은 정확명 질의와 다국어·생활어 질의를 모두 강하게
        const hits = await hybridSearch(query, 60, (p) => {
          if (runId === aiRunId.current) setAiProgress(p)
        })
        if (runId === aiRunId.current) { setAiHits(hits); setAiHitsQuery(query); setAiProgress(null) }
      } catch (e) {
        console.error('[AI검색] semanticSearch 실패:', e) // silent swallow 제거 — 진단 가능하게
        if (runId === aiRunId.current) {
          setAiError('AI 모델을 불러오지 못했어요. 네트워크를 확인하거나 일반 검색을 이용해주세요.')
          setAiHits(null); setAiHitsQuery(''); setAiProgress(null)
        }
      }
    }, 450)
    return () => clearTimeout(t)
  }, [aiMode, q])

  // AI 매칭 점수(정책 id → 코사인 유사도) — 배지 표시용
  const aiScore = useMemo(() => {
    const m = new Map<string, number>()
    if (aiHits) for (const h of aiHits) m.set(h.policy.id, h.score)
    return m
  }, [aiHits])

  // 비검색 필터(분류·지역·현금성·혜택유형) 공통 술어 — 목록과 AI 답변이 '같은 결과'를 보게 hoist(감사 Finding 1)
  const passNonSearch = useCallback((p: Policy) => {
    // 신규 신청이 종료된(모집·접수·가입 종료·일몰) 정책은 탐색에서도 숨긴다 — 결과 화면과 동일 원칙.
    //   '신청할 수 있는 것만' 보여줘 사용자가 종료된 혜택에 헛걸음하지 않게(사용자 요청).
    if (isClosedForNew(p)) return false
    const b = BUCKETS.find((x) => x.key === bucket)
    if (b?.test) { if (!b.test(p)) return false }
    else if (b?.match && !b.match.some((m) => p.category.includes(m))) return false
    if (region && p.id.startsWith('LOC-') && sidoOf(p.target) !== region) return false
    if (gungu && p.id.startsWith('LOC-')) {
      const g = guOf(p.target)
      if (g && g !== gungu) return false
    }
    if (onlyCash && !isCashBenefit(p.benefit, `${p.name} ${p.category}`)) return false
    if (benefitType && benefitTypeOf(p) !== benefitType) return false
    return true
  }, [bucket, region, gungu, onlyCash, benefitType])

  // AI 답변 요약(환각 없이 검색결과 기반 템플릿) — 입력 언어를 이해했음을 알리고 대표 복지·금액을 한 줄로.
  // ⚠️ 반드시 '화면에 실제로 남는' 결과(필터 적용)에서, 그리고 '현재 질의'의 결과일 때만 생성한다 —
  //   ① 카테고리/지역/현금성 필터로 사라진 복지를 답변이 언급하거나 '결과 없음' 위에 답변이 뜨던 문제(Finding 1),
  //   ② 새 질의 임베딩이 도는 동안 직전 질의 결과로 답변이 만들어지던 스테일 문제(Finding 4)를 함께 차단.
  //   의미순(정렬/접기 전)을 유지해 '가장 잘 맞아요'의 의미를 지킨다.
  const aiAnswer = useMemo(() => {
    if (!aiMode || !aiHits || aiHitsQuery !== q.trim()) return ''
    const pol = aiHits.map((h) => h.policy).filter(passNonSearch)
    return buildAiAnswer(pol, q)
  }, [aiMode, aiHits, aiHitsQuery, q, passNonSearch])

  // AI 답변의 언어 = 질의 언어(aiAnswer가 질의 언어로 생성) → TTS도 그 언어 보이스로 읽어야 발음이 안 깨진다.
  // ⚠️ 보수적 detectUiLang 사용 — 한국어 사용자의 짧은 영문 약어('EITC','LH')에 카드가 통째로 외국어로
  //   번역되지 않게(aiAnswer의 답변 언어 판정과 동일 기준으로 일관성 확보, 감사).
  const answerLang = useMemo(() => (aiMode && q.trim() ? detectUiLang(q) : 'ko'), [aiMode, q])
  // 해당 언어 보이스가 이 기기에 없으면(한국어 Windows/Android에서 베트남어·태국어 흔함) 한국어 보이스로
  // 외국어를 읽어 발음이 깨지거나 무음이 된다 → 재생 대신 텍스트로 안내(voiceschanged 후 재판단).
  const noVoice = answerLang !== 'ko' && !tts.hasVoice(answerLang)

  // 다국어 AI 검색 — 질의가 외국어면 결과 카드(정책명·대상·혜택)를 그 언어로 '온디바이스' 번역해 표시.
  // 미지원 브라우저는 undefined → 카드가 한국어 원문 그대로(폴백). 금액·자격 등 로직은 항상 한국어 원문 기준.
  // 중국어는 질의의 자형으로 간체/번체를 판정(대만·홍콩 사용자에게 간체를 내밀지 않게 — 감사 확정).
  const translateTo = useMemo(() => {
    if (!aiMode || answerLang === 'ko' || !q.trim()) return undefined
    return answerLang === 'zh' ? zhTarget(q) : answerLang
  }, [aiMode, answerLang, q])
  const canTranslate = supportsOnDeviceTranslation()
  // 번역기 '실제 준비' 상태(null=확인 중) — 상태문구를 실측으로만 표시(언어팩 미지원·다운로드 실패인데
  // '번역했어요'라고 단정하던 허위 안내 수정, 감사 확정). 워밍업을 겸한다(첫 카드 번역 지연 최소화).
  const [trReady, setTrReady] = useState<boolean | null>(null)
  useEffect(() => {
    setTrReady(null)
    if (!translateTo || !canTranslate) return
    let alive = true
    getTranslator(translateTo).then((t) => { if (alive) setTrReady(!!t) })
    return () => { alive = false }
  }, [translateTo, canTranslate])

  // 음성으로 물었으면 AI가 음성으로 답한다(대화형) — 마이크 클릭이 사용자 제스처라 TTS 허용됨
  useEffect(() => {
    if (voiceUsed && aiMode && aiAnswer && tts.supported && !noVoice) {
      tts.speak(aiAnswer, answerLang)
      setVoiceUsed(false)
    } else if (voiceUsed && noVoice) {
      setVoiceUsed(false) // 보이스 없음 — 자동 낭독 생략(아래 안내 문구로 대체)
    }
    // tts는 매 렌더 새 객체라 deps에서 제외(speak만 호출)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAnswer, voiceUsed, aiMode, noVoice])

  const filtered = useMemo(() => {
    let list: Policy[]
    if (aiMode && aiHits) {
      // AI 의미 검색: 임베딩 유사도 순서 유지 + 비검색 필터만 적용
      list = aiHits.map((h) => h.policy).filter(passNonSearch)
    } else {
      const base = catalog.filter(passNonSearch)
      const concepts = queryConcepts(dq)
      // 검색어가 있으면 개념 확장 + 관련도순. 다단어·생활어·다개념 우대.
      if (concepts.length) {
        list = base
          .map((p) => ({ p, s: relevance(p, concepts, dq) }))
          .filter((x) => x.s > 0)
          .sort((a, b2) => b2.s - a.s)
          .map((x) => x.p)
      } else if (aiMode && dq.trim()) {
        // AI 모드인데 질의가 있고, 키워드로도 못 잡으며(비한국어 등) AI 결과도 아직 없음(로딩/실패).
        // → 전체 카탈로그 수천 건을 쏟지 않고 비운다. 아래 로딩/오류 안내가 상황을 설명.
        list = []
      } else {
        list = base
      }
    }
    let out = list
    // '금액 높은순'은 현금성만 실제 금액으로 정렬 — 서비스 한도액(재가급여 '월 206만원 한도' 등)이
    //   진짜 현금처럼 맨 위로 오던 문제 차단(isCashBenefit 정직성 게이트, 감사 Finding 7).
    if (sort === 'amount') {
      const cashAmt = (p: Policy) => (isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0)
      out = [...list].sort((a, b2) => cashAmt(b2) - cashAmt(a))
    } else if (sort === 'name') out = [...list].sort((a, b2) => a.name.localeCompare(b2.name, 'ko'))
    else if (sort === 'ease') {
      // 신청 쉬운 순 — 자동발급/온라인·서류 적은 순(applyDifficulty), 동급이면 현금액 높은 순
      const cashAmt = (p: Policy) => (isCashBenefit(p.benefit, `${p.name} ${p.category}`) ? parseMonthly(p.benefit) : 0)
      const diff = (p: Policy) => DIFF_RANK[applyDifficulty(applyChannel(p.application), (p.required_docs || []).length)]
      out = [...list].sort((a, b2) => diff(a) - diff(b2) || cashAmt(b2) - cashAmt(a))
    }
    // 같은 프로그램 중복(문화누리 3중복 등) 접기 — 결과 뷰와 동일 기준. POL- 시드에만 적용, 외부 데이터는 그대로.
    return collapseProgramDuplicates(out)
  }, [dq, catalog, sort, aiMode, aiHits, passNonSearch])

  // 감지 언어 배지·다누리 안내·번역 배너는 '실제로 그 언어로 답/번역할 때만' 표시 —
  //   답변/번역은 보수적 detectUiLang을 쓰는데 배지만 공격적 detectLang을 쓰면, 한 단어 영어('housing')에
  //   "🇬🇧 English 감지 + 번역해드려요"라 해놓고 답변은 한국어·번역 미실행인 허위 안내가 났다(감사 Finding 3).
  const detected = aiMode && q.trim() && detectUiLang(q) !== 'ko' ? detectLang(q) : null
  // 외국어 질의를 감지하면 UI 표시 언어를 그 언어로 — 상세·신청키트가 자국어로 뜬다(외국인 딥퍼널).
  // detectUiLang은 보수적(라틴 확신 게이트)이고 빈 질의·한국어면 'ko'로 복귀시켜, 오타 한 번에
  // 외국어 UI가 영구 고착되던 문제와 외국인이 일반검색만 써도 'ko'로 리셋되던 역방향 문제를 함께 해소.
  // AI 모드 여부와 무관하게 실제 입력 언어로 판단(일반 검색을 쓰는 외국인도 자국어 유지).
  const setUiLang = useAppStore((s) => s.setUiLang)
  const prevQRef = useRef(q)
  useEffect(() => {
    const prev = prevQRef.current
    prevQRef.current = q
    // 마운트 직후(빈 질의로 시작)나 계속 빈 상태면 uiLang을 건드리지 않는다 —
    // 탭 이동으로 Explore가 재마운트될 때마다 외국인 사용자의 자국어 UI가 'ko'로 초기화되던 회귀 방지.
    // 사용자가 실제로 입력(비-공백)했거나, 비-공백→공백으로 '지운' 순간에만 언어를 재판정한다.
    if (!q.trim() && !prev.trim()) return
    const code = detectUiLang(q)
    setUiLang(isUiLang(code) ? code : 'ko')
  }, [q, setUiLang])

  return (
    <div className="page-container py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl sm:text-3xl font-extrabold">정책 탐색 <span className="gradient-text">🧭</span></h1>
        <p className="text-muted-foreground mt-1">{catalog.length.toLocaleString()}개 복지 정책을 검색하고 둘러보세요.</p>

        {/* 기초생활보장 급여 계산기 — 접이식(내가 받을 수 있는 급여를 1분에 확인) */}
        <div className="mt-4 max-w-xl">
          <button
            onClick={() => setShowCalc((v) => !v)}
            aria-expanded={showCalc}
            className="w-full flex items-center gap-2 rounded-2xl border-2 border-sky2-100 bg-sky2-50/50 px-4 py-3 text-left hover:border-sky2-200 transition-colors"
          >
            <Calculator className="h-5 w-5 text-sky2-700 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold">내가 받을 수 있는 급여 계산하기</span>
              <span className="block text-xs text-muted-foreground">가구원 수·월 소득만 넣으면 생계·의료·주거급여 자격을 바로 확인</span>
            </span>
            <ChevronDown className={cn('h-5 w-5 text-muted-foreground shrink-0 transition-transform', showCalc && 'rotate-180')} />
          </button>
          {showCalc && (
            <div className="mt-2">
              <IncomeCalculator onPickBenefit={(label) => { setQ(label); setShowCalc(false) }} />
            </div>
          )}
        </div>

        {/* 검색 */}
        <div className="mt-5 relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setVoiceUsed(false) }}
            placeholder={aiMode ? '상황을 자유롭게 — 한국어·English·Tiếng Việt…' : '기초연금, 청년, 출산… 검색'}
            className="w-full rounded-2xl border-2 border-sprout-100 bg-white pl-12 pr-10 py-3.5 text-sm font-medium focus-ring"
            aria-label="정책 검색"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="검색어 지우기" className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1.5 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
          {micOk && (
            <button onClick={toggleMic} aria-label={listening ? '음성 입력 중지' : '음성으로 검색'}
              className={cn('absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 transition-colors', listening ? 'bg-rose-500 text-white animate-pulse' : 'text-sprout-700 hover:bg-sprout-50')}>
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 온디바이스 AI 다국어 의미 검색 토글 */}
        <div className="mt-3 max-w-xl">
          <button
            onClick={() => setAiMode((v) => !v)}
            aria-pressed={aiMode}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold border-2 transition-all',
              aiMode
                ? 'bg-gradient-to-r from-sprout-700 to-emerald-700 border-transparent text-white shadow-cute'
                : 'bg-white border-sprout-200 text-sprout-700 hover:border-sprout-300',
            )}
          >
            <Globe className="h-4 w-4" /> AI 의미 검색{aiMode ? ' ON' : ''}
            <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold">다국어</span>
          </button>
          {aiMode && (
            <div className="mt-2 rounded-2xl border-2 border-sprout-100 bg-sprout-50/50 px-4 py-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-foreground/80">
                <Sparkles className="h-3.5 w-3.5 text-sprout-700 shrink-0" />
                뜻을 이해하는 AI 검색 — <b>한국어·English·Tiếng Việt</b> 등 어떤 언어로든 상황을 적어보세요.
              </p>
              {micOk && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  🎙️ 음성 언어:
                  <select
                    value={voiceLang}
                    onChange={(e) => setVoiceLang(e.target.value)}
                    aria-label="음성 입력 언어 선택"
                    className="rounded-md border border-sprout-200 bg-white px-1.5 py-0.5 text-[11px] font-medium focus-ring"
                  >
                    <option value="ko-KR">한국어</option>
                    <option value="en-US">English</option>
                    <option value="vi-VN">Tiếng Việt</option>
                    <option value="zh-CN">中文</option>
                    <option value="ja-JP">日本語</option>
                  </select>
                  로 말할 수 있어요 (🎤 아이콘)
                </p>
              )}
              {micError && (
                <p role="alert" className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">🎤 {micError}</p>
              )}
              {detected && (
                <p className="mt-1.5 text-[11px] font-semibold text-sprout-700">🌐 감지된 언어: {detected.flag} {detected.label}</p>
              )}
              {detected && detected.code !== 'ko' && (
                <div className="mt-2 rounded-xl border border-sky2-200 bg-sky2-50/70 px-3 py-2 text-[11px] leading-relaxed">
                  🌍 <b>외국인·다문화 가정</b>이신가요? 복지 상담은 <b>다누리콜센터</b>{' '}
                  <a href="tel:1577-1366" className="font-bold text-sky2-700 hover:underline">☎ 1577-1366</a>{' '}
                  (13개 언어·24시간 무료) 또는{' '}
                  <a href="https://www.liveinkorea.kr" target="_blank" rel="noopener noreferrer" className="font-bold text-sky2-700 hover:underline">다누리 포털</a>에서 받을 수 있어요.
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {AI_EXAMPLES.map((ex) => (
                  <button
                    key={ex.text}
                    lang={ex.lang}
                    onClick={() => setQ(ex.text)}
                    className="rounded-full border border-sprout-200 bg-white px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-sprout-400 hover:bg-sprout-50"
                  >
                    {ex.text}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">🔒 AI 모델이 <b>내 기기 안에서</b> 직접 실행돼요(서버 전송 없음). 최초 1회만 준비(약 1분), 이후엔 <b>즉시</b> 실행돼요.</p>
              {aiProgress && (
                <div className="mt-2" role="status" aria-live="polite">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-sprout-700">
                    <span>🧠 {aiProgress.stage}…</span>
                    {aiProgress.pct != null && <span>{aiProgress.pct}%</span>}
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sprout-100">
                    <div className="h-full bg-sprout-500 transition-all" style={{ width: `${aiProgress.pct ?? 15}%` }} />
                  </div>
                </div>
              )}
              {aiError && (
                <p className="mt-2 font-medium text-rose-600">
                  {aiError}
                  {/* 외국어 질의 사용자용 영어 브리지 — 7개 감지 언어 전부 번역하는 대신 정직한 영어 고정 안내 */}
                  {answerLang !== 'ko' && <span className="block mt-0.5">Couldn't load the AI model — check your network, or use the regular keyword search.</span>}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 카테고리 칩 */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2 nice-scroll -mx-1 px-1">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBucket(b.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold border-2 transition-all ${
                bucket === b.key ? 'bg-sprout-700 border-sprout-700 text-white shadow-soft' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200'
              }`}
            >
              <span>{b.emoji}</span> {b.label}
            </button>
          ))}
        </div>
        {/* 정렬·필터 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
          {([['default', '기본순'], ['amount', '금액 높은순'], ['ease', '신청 쉬운 순'], ['name', '이름순']] as [SortKey, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', sort === k ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}>
              {l}
            </button>
          ))}
          <button onClick={() => setOnlyCash((v) => !v)}
            className={cn('ml-1 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors', onlyCash ? 'bg-peach-400 border-peach-400 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}>
            💰 현금 지원만
          </button>
          {/* 지원형태 파셋 — 지자체 4,598건도 텍스트 신호로 분류(현금 필터가 못 잡던 것 보완) */}
          <select
            value={benefitType}
            onChange={(e) => setBenefitType(e.target.value)}
            aria-label="지원형태 선택"
            className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer', benefitType ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
          >
            <option value="">🎁 지원형태</option>
            {(Object.keys(BENEFIT_TYPE_META) as BenefitType[]).map((k) => (
              <option key={k} value={k}>{BENEFIT_TYPE_META[k].emoji} {BENEFIT_TYPE_META[k].label}</option>
            ))}
          </select>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            aria-label="지역 선택"
            className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer', region ? 'bg-sky2-700 border-sky2-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
          >
            <option value="">📍 전국</option>
            {['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {/* 시·도 선택 시 시·군·구 2차 필터 — '내 동네 복지'만 */}
          {region && gunguOptions.length > 0 && (
            <select
              value={gungu}
              onChange={(e) => setGungu(e.target.value)}
              aria-label="시군구 선택"
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer', gungu ? 'bg-sky2-700 border-sky2-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200')}
            >
              <option value="">{region} 전체</option>
              {gunguOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
      </motion.div>

      <div className="mt-5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {aiMode && aiHits ? <>🌍 <b className="text-foreground">AI</b>가 의미로 찾은 </> : '총 '}
          <b className="text-foreground">{filtered.length}</b>개 정책{onlyCash ? ' · 현금 지원' : ''}{sort === 'amount' ? ' · 금액순' : sort === 'ease' ? ' · 신청 쉬운 순' : sort === 'name' ? ' · 이름순' : ''}
        </p>
        <Glossary />
      </div>

      {aiMode && aiAnswer && (
        <div className="mt-3 rounded-2xl border-2 border-sprout-200 bg-gradient-to-br from-sprout-50 to-emerald-50 p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-xl leading-none">✨</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-sprout-700">AI 답변</p>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground">{aiAnswer}</p>
            </div>
            {tts.supported && !noVoice && (
              <button
                onClick={() => tts.toggle(aiAnswer, answerLang)}
                aria-label={tts.speaking ? '읽기 중지' : '음성으로 듣기'}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-sprout-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sprout-700 transition-colors hover:bg-sprout-50"
              >
                {tts.speaking ? <><Square className="h-3.5 w-3.5" /> 중지</> : <><Volume2 className="h-3.5 w-3.5" /> 듣기</>}
              </button>
            )}
            {tts.supported && noVoice && (
              <span className="shrink-0 text-[11px] text-muted-foreground max-w-[7rem] leading-tight">이 기기에 해당 언어 음성이 없어 텍스트로만 안내해요</span>
            )}
          </div>
        </div>
      )}

      {/* 다국어 결과 번역 상태 — '실제로 번역기가 준비됐을 때만' 성공 문구(허위 안내 금지, 감사 확정).
          미지원 브라우저/언어팩 불가는 정직한 폴백 안내, 확인 중(null)엔 아무 문구도 단정하지 않는다. */}
      {translateTo && filtered.length > 0 && (
        canTranslate && trReady === true ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-violet-700" role="status">
            <Languages className="h-3.5 w-3.5 shrink-0" />
            결과를 <b>이 기기 안에서</b> {detected?.flag} <b>{detected?.label || '입력 언어'}</b>로 자동 번역해 보여드려요 · 원문(신청·자격 기준)은 한국어예요.
          </p>
        ) : !canTranslate || trReady === false ? (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            이 브라우저에선 이 언어로 자동 번역을 켤 수 없어 정책이 <b>한국어</b>로 표시돼요(최신 Chrome·Edge에서 지원). ·{' '}
            <a
              href={`https://translate.google.com/?sl=ko&tl=${translateTo === 'zh' ? 'zh-CN' : translateTo === 'zh-Hant' ? 'zh-TW' : translateTo}&op=translate`}
              target="_blank" rel="noopener noreferrer"
              className="underline font-semibold text-sky2-700"
            >
              Google 번역 열기
            </a>
          </p>
        ) : null
      )}

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          {aiMode && q.trim() && aiProgress ? (
            <><p className="text-4xl mb-2">🧠</p>AI가 뜻을 이해하는 중이에요… 잠시만요.</>
          ) : aiMode && q.trim() && aiError ? (
            <>
              <p className="text-4xl mb-2">🔌</p>AI 검색을 불러오지 못했어요. AI 토글을 끄고 <b>일반 검색</b>으로 찾아보세요.
              {answerLang !== 'ko' && <p className="mt-1 text-sm">Couldn't load AI search — please check your network and try again.</p>}
            </>
          ) : (
            /* 막다른 길 금지 — 0건이어도 바로 눌러볼 다음 행동을 준다 */
            <>
              <p className="text-4xl mb-2">🔍</p>
              <p>검색 결과가 없어요.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {!aiMode && q.trim() && (
                  <button onClick={() => setAiMode(true)} className="btn-primary !py-2 text-sm">
                    🧠 AI 의미 검색으로 다시 찾기
                  </button>
                )}
                {(q.trim() || bucket !== 'all' || onlyCash || benefitType || region) && (
                  <button
                    onClick={() => { setQ(''); setBucket('all'); setOnlyCash(false); setBenefitType(''); setRegion(''); setGungu('') }}
                    className="btn-secondary !py-2 text-sm"
                  >
                    필터 지우고 전체 보기
                  </button>
                )}
                <a href="tel:129" className="btn-secondary !py-2 text-sm">📞 129 무료 상담</a>
              </div>
              <p className="mt-3 text-xs text-muted-foreground/70">
                생활어로 적어보세요 — 예: “전세 지원”, “아이 학원비”, “병원비가 부담돼요”
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.slice(0, visible).map((p, i) => (
              <div key={p.id} className="relative">
                {aiMode && aiScore.has(p.id) && (
                  <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-sprout-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-soft">
                    ✨ AI 매칭
                  </span>
                )}
                <PolicyCard policy={p} index={Math.min(i, 12)} onOpen={setSelected} translateTo={translateTo} />
              </div>
            ))}
          </div>
          {visible < filtered.length && (
            <div className="mt-6 text-center">
              <button onClick={() => setVisible((v) => v + PAGE)} className="btn-secondary">
                더 보기 ({filtered.length - visible}건 남음)
              </button>
            </div>
          )}
        </>
      )}

      {/* 데이터 출처·기준 투명성 — 신뢰 가능한 서비스를 위한 정직한 안내 */}
      <div className="mt-10 rounded-2xl border border-sprout-100 bg-sprout-50/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground/70">ℹ️ 데이터 출처 · 기준</p>
        <p className="mt-0.5">
          보건복지부 검증 시드 + <b>한국사회보장정보원 공공데이터(복지로)</b> 기준 총 {catalog.length.toLocaleString()}건 ·
          금액·받는 조건은 <b>2026년</b> 기준입니다. 공공데이터 정책은 요약 정보라 실제 조건·금액과 다를 수 있어요 —
          정확한 내용은 <a href="https://www.bokjiro.go.kr" target="_blank" rel="noopener noreferrer" className="font-semibold text-sprout-700 hover:underline">복지로</a> 또는
          주민센터(☎129 보건복지상담)에서 꼭 확인하세요.
        </p>
      </div>

      <PolicyDetailDrawer policy={selected} onClose={() => setSelected(null)} onOpen={setSelected} />
    </div>
  )
}
