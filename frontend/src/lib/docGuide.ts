import { issuableCanonical } from '@/lib/docAliases'

/**
 * 서류 발급 방법 안내 — '어떤 서류가 필요한지'(docPlan)를 넘어 '어디서 어떻게 떼는지'를 알려준다.
 *
 * 발급 채널(정부24·홈택스·위택스·건보·고용24 등)은 오래 고정된 공식 창구라 안정적이다.
 * 자동발급(RPA) 대상 증명서는 앱이 대신 떼줄 수 있고, 통장사본·신분증·계약서 등은 발급처가 달라
 * 사람이 준비해야 한다 → 서류마다 '온라인/앱/방문/은행/본인보관'을 정직하게 구분해 안내한다.
 *
 * 정직성: 무료/유료·즉시 여부는 일반적인 기준이며 창구·상황에 따라 다를 수 있음을 note로 남긴다.
 */

export type IssueMethod = 'online' | 'app' | 'kiosk' | 'visit' | 'bank' | 'self' | 'work'

export const METHOD_LABEL: Record<IssueMethod, string> = {
  online: '온라인', app: '앱', kiosk: '무인발급기', visit: '방문', bank: '은행', self: '본인 보관', work: '직장',
}

export interface IssueChannel {
  method: IssueMethod
  label: string            // 창구 이름(예: '정부24')
  detail?: string          // '무료·즉시' 등
  url?: string
}

export interface DocGuide {
  name: string             // 표시명(정식명 우선)
  channels: IssueChannel[]
  fee: 'free' | 'paid' | 'varies'
  note?: string
}

const norm = (s: string): string => (s || '').replace(/\s/g, '')

const GOV24 = 'https://www.gov.kr'
const HOMETAX = 'https://www.hometax.go.kr'
const WETAX = 'https://www.wetax.go.kr'
const NHIS = 'https://www.nhis.or.kr'
const WORK24 = 'https://www.work24.go.kr'
const NPS = 'https://www.nps.or.kr'
const EFAMILY = 'https://efamily.scourt.go.kr'
const MMA = 'https://www.mma.go.kr'
const HIKOREA = 'https://www.hikorea.go.kr'

interface GuideDef {
  keys: string[]           // 정규화(공백 제거) 매칭 키 — 구체적인 것을 먼저
  channels: IssueChannel[]
  fee: DocGuide['fee']
  note?: string
}

const gov24 = (detail = '무료·즉시'): IssueChannel => ({ method: 'online', label: '정부24', detail, url: GOV24 })
const kiosk: IssueChannel = { method: 'kiosk', label: '무인민원발급기', detail: '지하철·주민센터' }
const center: IssueChannel = { method: 'visit', label: '주민센터', detail: '방문 발급' }

// 구체적 키를 앞에 둔다(‘주민등록등본’이 ‘주민등록’ 일반 규칙보다 먼저 매칭되도록)
const GUIDES: GuideDef[] = [
  { keys: ['주민등록표등본', '주민등록등본'], fee: 'free', channels: [gov24(), kiosk, center] },
  { keys: ['주민등록표초본', '주민등록초본'], fee: 'free', channels: [gov24(), kiosk, center] },
  { keys: ['가족관계증명서', '기본증명서', '혼인관계증명서'], fee: 'free',
    channels: [{ method: 'online', label: '대법원 전자가족관계등록', detail: '무료·즉시', url: EFAMILY }, gov24(), center] },
  { keys: ['소득금액증명'], fee: 'free',
    channels: [{ method: 'online', label: '홈택스', detail: '무료·즉시', url: HOMETAX }, gov24(), { method: 'visit', label: '세무서' }] },
  { keys: ['국세납세증명서'], fee: 'free',
    channels: [{ method: 'online', label: '홈택스', detail: '무료·즉시', url: HOMETAX }, gov24(), { method: 'visit', label: '세무서' }] },
  { keys: ['지방세납세증명서', '지방세세목별과세증명서', '지방세세목별과세증명', '지방세'], fee: 'free',
    channels: [{ method: 'online', label: '위택스', detail: '무료·즉시', url: WETAX }, gov24(), center] },
  { keys: ['건강보험자격득실확인서', '건강보험료납부확인서', '건강보험'], fee: 'free',
    channels: [{ method: 'app', label: 'The건강보험 앱' }, { method: 'online', label: '건강보험공단', detail: '무료·즉시', url: NHIS }, gov24(), { method: 'visit', label: '☎ 1577-1000' }] },
  { keys: ['고용보험피보험자격이력내역서', '고용보험', '피보험자격'], fee: 'free',
    channels: [{ method: 'work', label: '고용24', detail: '무료·즉시', url: WORK24 }, gov24()] },
  { keys: ['국민연금가입자증명서', '국민연금가입내역확인서', '국민연금'], fee: 'free',
    channels: [{ method: 'online', label: '국민연금공단', detail: '무료·즉시', url: NPS }, gov24()] },
  { keys: ['장애인증명서', '장애인등록증'], fee: 'free', channels: [gov24(), center] },
  { keys: ['기초생활수급자증명서', '수급자증명서', '한부모가족증명서'], fee: 'free', channels: [gov24(), center] },
  { keys: ['출입국에관한사실증명', '출입국사실증명'], fee: 'free',
    channels: [gov24(), { method: 'online', label: '하이코리아', url: HIKOREA }] },
  { keys: ['병적증명서'], fee: 'free', channels: [gov24(), { method: 'online', label: '병무청', url: MMA }] },
  // 발급 증명서가 아닌 서류 — 발급처가 달라 사람이 준비
  { keys: ['통장사본'], fee: 'free', note: '계좌번호가 보이게', channels: [{ method: 'app', label: '은행 앱', detail: '계좌 화면 캡처·PDF' }, { method: 'bank', label: '은행 창구' }] },
  { keys: ['신분증', '주민등록증', '운전면허증'], fee: 'varies', note: '분실 시 재발급', channels: [center, { method: 'self', label: '본인 소지' }] },
  { keys: ['임대차계약서', '전월세계약서', '월세계약서'], fee: 'free', note: '계약 시 받은 원본', channels: [{ method: 'self', label: '본인 보관' }, { method: 'visit', label: '부동산' }] },
  { keys: ['근로소득원천징수영수증', '원천징수영수증'], fee: 'free',
    channels: [{ method: 'work', label: '직장(회사)', detail: '연말정산 담당' }, { method: 'online', label: '홈택스', detail: '지급명세서', url: HOMETAX }] },
  { keys: ['월세이체확인증', '이체확인증', '입금확인증'], fee: 'free', channels: [{ method: 'app', label: '은행 앱', detail: '이체내역 조회' }, { method: 'bank', label: '은행 창구' }] },
]

/** 서류명 → 발급 방법 안내(없으면 null). 정식명 해석 후 정규화 포함관계로 매칭. */
export function docGuide(docName: string): DocGuide | null {
  const canon = issuableCanonical(docName) || docName
  const n = norm(canon)
  if (!n) return null
  for (const g of GUIDES) {
    if (g.keys.some((k) => n.includes(k) || k.includes(n))) {
      return { name: canon, channels: g.channels, fee: g.fee, note: g.note }
    }
  }
  return null
}

/** 발급 채널을 한 줄 텍스트로(요약 표기) */
export function guideSummary(g: DocGuide): string {
  return g.channels.map((c) => c.label).join(' · ')
}
