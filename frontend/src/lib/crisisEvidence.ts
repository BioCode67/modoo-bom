/**
 * 위기 사유 입증 서류 도우미(Crisis-Cause Evidence Prep)
 *
 * 긴급복지 신청의 가장 큰 마찰은 '위기 사유를 무엇으로·어디서 입증하나'이다.
 * 이 모듈은 위기 유형(실직·질병·사망·화재·소득단절·이혼 등)을 대표 입증서류·발급처·발급난이도로
 * 매핑하고, 이미 발급해 둔 서류(issuedDocs)와 대조해 '무엇이 남았는지'를 정직하게 보여준다.
 *
 * 정직성 원칙(모두봄 핵심):
 *  - 정부 정액·고시값을 새로 만들지 않는다. source/effort/deferrable은 '어디서·얼마나 걸리나'라는 구조 정보일 뿐이다.
 *  - issuedAlready는 호출자가 넘긴 issuedDocs로만 대조한다(기기 밖 조회·상상 금지).
 *  - 긴급복지는 '선지원 후심사'다 → 서류가 없어도 신고부터 하도록 deferNote로 골든타임을 우선 안내한다.
 *  - 조건부 서류('해당 시')는 proves 문구에 라벨을 담아 과장하지 않는다.
 */

export type EvidenceSource = '정부24' | '병원' | '직장' | '경찰·소방' | '주민센터' | '금융기관'
export type EvidenceEffort = '바로발급' | '요청필요'

export interface EvidenceDoc {
  /** 서류명(예: 진단서, 화재증명원) */
  name: string
  /** 이 서류가 입증하는 위기 사실(조건부면 '(해당 시)' 라벨 포함) */
  proves: string
  /** 발급처 — 어디로 가야 하나(구조 정보) */
  source: EvidenceSource
  /** 발급 난이도 — 그 자리에서 바로 나오나, 요청·대기가 필요한가(구조 정보) */
  effort: EvidenceEffort
  /** issuedDocs 대조 결과 — 이미 발급했는가(넘겨받은 목록에서만 판단) */
  issuedAlready: boolean
  /** 선지원 후심사라 지원 시작 뒤로 제출을 미뤄도 되는 서류인가(구조 정보) */
  deferrable: boolean
}

export interface Crisis {
  key: string
  label: string
}

export interface EvidenceGroup {
  crisis: Crisis
  docs: EvidenceDoc[]
}

export interface EvidencePlan {
  groups: EvidenceGroup[]
  /** 골든타임 우선 안내(선지원 후심사·129·주민센터) — 정직성 라벨을 담는 문구 */
  deferNote: string
}

// issuedAlready는 대조 시점에 채우는 관계형 필드라, 큐레이션 원본에는 담지 않는다(구조 정보만 큐레이션).
type BaseDoc = Omit<EvidenceDoc, 'issuedAlready'>

// 위기별 큐레이션 원본 — 각 위기 2~4개 대표 입증서류. source/effort/deferrable은 발급 실무의 구조 정보이며 정액이 아니다.
// key는 앱의 위기 분류(lib/emergency.ts CRISES)와 동일하게 맞춘다 — EmergencyHelp에서 선택한 위기 key가 그대로 들어온다.
const RAW: Record<string, { label: string; docs: BaseDoc[] }> = {
  joblost: {
    label: '실직(비자발적 이직)',
    docs: [
      { name: '해고(예고)통지서·권고사직 확인서', proves: '비자발적 실직 사유', source: '직장', effort: '요청필요', deferrable: true },
      { name: '이직확인서', proves: '이직 사유·퇴사일 (실업급여 연계)', source: '직장', effort: '요청필요', deferrable: true },
      { name: '고용보험 피보험자격 이력내역서', proves: '고용보험 가입·상실 이력', source: '정부24', effort: '바로발급', deferrable: false },
    ],
  },
  sick: {
    label: '질병·부상',
    docs: [
      { name: '진단서', proves: '질병·부상 사실과 치료 필요', source: '병원', effort: '요청필요', deferrable: true },
      { name: '입·퇴원 확인서', proves: '입원 치료로 인한 소득활동 중단', source: '병원', effort: '요청필요', deferrable: true },
      { name: '진료비 납입확인서·영수증', proves: '과도한 의료비 부담', source: '병원', effort: '바로발급', deferrable: true },
    ],
  },
  death: {
    label: '주소득자 사망',
    docs: [
      { name: '사망진단서(또는 시체검안서)', proves: '주소득자의 사망 사실', source: '병원', effort: '요청필요', deferrable: true },
      { name: '기본증명서(사망 사실 기재)', proves: '사망 신고 반영·사망 사실', source: '정부24', effort: '바로발급', deferrable: false },
      { name: '가족관계증명서', proves: '사망한 주소득자와의 관계', source: '정부24', effort: '바로발급', deferrable: false },
    ],
  },
  business: {
    label: '사업 위기·폐업',
    docs: [
      { name: '폐업사실증명원', proves: '자영업 폐업으로 인한 소득상실', source: '정부24', effort: '바로발급', deferrable: false },
      { name: '사업자등록 휴·폐업 사실증명', proves: '영업 중단 사실', source: '정부24', effort: '바로발급', deferrable: false },
      { name: '소득금액증명(또는 사실증명)', proves: '소득 급감·무소득', source: '정부24', effort: '바로발급', deferrable: false },
    ],
  },
  disaster: {
    label: '화재·재난',
    docs: [
      { name: '화재증명원', proves: '화재 발생 사실과 피해', source: '경찰·소방', effort: '요청필요', deferrable: true },
      { name: '피해사실확인서', proves: '재난·재해로 인한 주거·재산 피해', source: '주민센터', effort: '요청필요', deferrable: true },
    ],
  },
  housing: {
    label: '주거 위기(월세 연체·퇴거)',
    docs: [
      { name: '임대차(전월세) 계약서', proves: '임차 사실·월 임대료 부담 (확정일자 받은 사본)', source: '주민센터', effort: '요청필요', deferrable: true },
      { name: '월세 이체내역·입금확인서', proves: '월세 납부·연체 정황', source: '금융기관', effort: '바로발급', deferrable: true },
    ],
  },
  violence: {
    label: '폭력·학대 위기',
    docs: [
      { name: '경찰 사건사고사실확인원', proves: '폭력·학대 신고 사실', source: '경찰·소방', effort: '요청필요', deferrable: true },
      { name: '보호시설 입소확인서', proves: '보호시설 입소 사실 (해당 시)', source: '주민센터', effort: '요청필요', deferrable: true },
    ],
  },
  birth: {
    label: '출산',
    docs: [
      { name: '임신확인서', proves: '임신·출산 예정 사실', source: '병원', effort: '요청필요', deferrable: true },
      { name: '출생증명서', proves: '출생 사실 (출산 후 신고·바우처 연계)', source: '병원', effort: '요청필요', deferrable: false },
    ],
  },
}

/**
 * 공개 매핑 상수 — 큐레이션 원본(RAW)에 issuedAlready 기본값(false)을 채워 EvidenceDoc으로 승격한다.
 * 흐름: ① RAW 엔트리 순회 → ② 각 doc에 issuedAlready:false 부여 → ③ key→{label; docs} 형태로 고정.
 */
export const CRISIS_EVIDENCE: Record<string, { label: string; docs: EvidenceDoc[] }> = Object.fromEntries(
  Object.entries(RAW).map(([key, v]): [string, { label: string; docs: EvidenceDoc[] }] => [
    key,
    { label: v.label, docs: v.docs.map((d) => ({ ...d, issuedAlready: false })) },
  ]),
)

// 긴급복지의 대원칙 — 선지원 후심사. 서류가 없어도 신고부터(골든타임 우선). deferNote에 정직성 라벨을 담는다.
const DEFER_NOTE =
  '긴급복지는 선지원 후심사예요 — 위기 입증 서류가 아직 없어도 129(보건복지상담센터)나 주민센터 신고부터 하세요. ' +
  '골든타임이 우선이라 지원이 먼저 시작되고, 서류는 발급되는 대로 나중에 제출해도 됩니다. ' +
  '위기 인정 범위와 필요한 서류는 주민센터·129에서 함께 확인하시길 권장해요.'

// 공백·부연 괄호를 무시한 '핵심 이름' — issuedDocs 대조를 표기 차이(띄어쓰기·괄호 부연)에 견고하게 만든다.
function coreName(s: string): string {
  return (s || '').replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, '')
}

/**
 * 이 서류가 이미 발급됐는지 — 넘겨받은 issuedDocs에서만 판단(공백·괄호부연 무시 후 정확일치). 외부 조회·상상 없음.
 * 흐름: ① 서류명 핵심화(공백·괄호부연 제거) → ② issuedDocs 각 항목도 핵심화 →
 *       ③ 핵심 이름이 '정확히 일치'할 때만 발급됨으로 본다.
 *  ⚠️ 부분 포함(substring)은 쓰지 않는다 — '진단서'가 '사망진단서'로 번지는 식으로 발급 안 한 서류를
 *     발급했다고 오탐(상상)하면 정작 필요한 서류를 건너뛰게 되어 위험하다(정직성: 오탐 < 미탐).
 */
function isIssued(name: string, issuedDocs: string[]): boolean {
  const core = coreName(name)
  if (core.length < 2) return false // 빈·1글자 핵심은 오탐 방지로 제외
  return issuedDocs.some((raw) => coreName(raw) === core)
}

/**
 * 위기 key 하나에 대한 큐레이션 입증서류 목록(issuedAlready는 기본 false로 반환).
 * 흐름: ① CRISIS_EVIDENCE에서 key 조회 → ② 없으면 빈 배열(알 수 없는 key는 조용히 스킵) →
 *       ③ 있으면 각 doc의 사본을 반환(원본 상수 불변 보호).
 */
export function crisisDocsFor(key: string): EvidenceDoc[] {
  const entry = CRISIS_EVIDENCE[key]
  if (!entry) return []
  return entry.docs.map((d) => ({ ...d }))
}

/**
 * 선택한 위기들의 입증서류 계획을 만든다.
 * 흐름:
 *  ① crisisKeys를 순서대로 순회(중복 key는 첫 등장만 반영) →
 *  ② 알 수 없는 key는 건너뜀(빈 groups 허용) →
 *  ③ 각 key의 서류를 crisisDocsFor로 가져와 issuedDocs와 공백무시 대조로 issuedAlready 세팅 →
 *  ④ Crisis(label 포함)와 함께 group으로 묶고, deferNote(선지원 후심사·129·골든타임)를 채워 반환.
 */
export function crisisEvidence(crisisKeys: string[], opts: { issuedDocs?: string[] } = {}): EvidencePlan {
  const issuedDocs = opts.issuedDocs || []
  const groups: EvidenceGroup[] = []
  const seen = new Set<string>()
  for (const key of crisisKeys || []) {
    if (seen.has(key)) continue // 같은 위기를 두 번 선택해도 그룹은 한 번만
    const entry = CRISIS_EVIDENCE[key]
    if (!entry) continue // 알 수 없는 key는 조용히 스킵(정직성: 없는 위기를 지어내지 않음)
    seen.add(key)
    const docs = crisisDocsFor(key).map((d) => ({ ...d, issuedAlready: isIssued(d.name, issuedDocs) }))
    groups.push({ crisis: { key, label: entry.label }, docs })
  }
  return { groups, deferNote: DEFER_NOTE }
}
