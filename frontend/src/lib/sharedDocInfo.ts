// 행정정보 공동이용 — '안 떼도 되는 서류' 판별.
// 전자정부법 '행정정보 공동이용' 대상(등·초본·가족관계·소득금액증명·지방세·건강보험 자격·장애인증명 등)은
// 신청서의 '공동이용 동의' 서명만으로 담당기관이 직접 조회 → 신청자가 별도로 발급받아 낼 필요가 없다.
// 각 required_doc을 '직접 제출(no)/동의로 생략 가능(yes)/조건부(maybe)'로 분류한다.
//
// 정직성 원칙:
//  - 대상 목록(SHAREABLE_DOCS)은 '공개된 제도 구조'(정액·연도 고시값 아님)만 사용 — 날조 없음.
//  - 공동이용 가능 여부는 신청기관·온라인 신청 여부·담당자 재량에 좌우되므로 '추정'으로 표기하고
//    최종 판단은 접수처 확인으로 넘긴다. 애매하면 보수적으로 'maybe'.
//  - 통장·계약서·신분증·증명사진·동의서·본인서명 등 명백한 '본인 제출' 서류만 단정 'no'.
import type { Policy } from '@/data/policies'

export type Sharable = 'yes' | 'no' | 'maybe'

export interface DocSharingRow {
  doc: string
  sharable: Sharable
  why: string
}

export interface DocSharingPlan {
  rows: DocSharingRow[]
  /** yes(동의로 생략 가능) 서류 수 */
  skippableCount: number
  /** 생략 가능 서류가 하나라도 있으면 신청서 '공동이용 동의' 서명이 필요 */
  consentNeeded: boolean
  summary: string
}

/** 서류명 정규화 — 공백을 제거해 '통장 사본' → '통장사본'처럼 부분문자열 매칭이 흔들리지 않게 한다. */
function norm(s: string): string {
  return (s || '').replace(/\s+/g, '')
}

/**
 * 행정정보 공동이용 대상 서류(정규화 표시 목록).
 * 전자정부법·행정정보 공동이용센터에 공개된 대표 대상만 담는다(공개 제도 구조 — 금액·연도값 아님).
 */
export const SHAREABLE_DOCS: string[] = [
  '주민등록등본',
  '주민등록초본',
  '가족관계증명서',
  '기본증명서',
  '혼인관계증명서',
  '소득금액증명',
  '지방세 납세증명서',
  '지방세 세목별 과세증명서',
  '국세 납세증명서',
  '건강보험 자격득실확인서',
  '건강보험료 납부확인서',
  '장애인증명서',
  '국민기초생활 수급자 증명서',
  '한부모가족 증명서',
]

// 공동이용 매칭 키(정규화 부분문자열) — SHAREABLE_DOCS의 축약·변형까지 포섭한다.
//   '등본'처럼 지나치게 넓은 키는 '건물 등기부등본' 등 오탐을 부르므로 '주민등록등본'으로 좁힌다.
const SHAREABLE_KEYS = [
  '주민등록등본',
  '초본', // 주민등록초본
  '가족관계증명',
  '기본증명',
  '혼인관계증명',
  '소득금액증명',
  '지방세납세증명',
  '지방세과세증명',
  '지방세세목별',
  '납세증명', // 국세·지방세 납세증명서
  '자격득실', // 건강보험 자격득실확인서
  '건강보험료', // 건강보험료 납부확인서/영수증/확인서(보험료 납부 사실)
  '장애인증명',
  '장애인등록', // 장애 등록 사실은 장애인증명서로 공동이용 확인 가능
  '수급자', // 국민기초생활 수급자 증명서
  '한부모', // 한부모가족 증명서
]

// '본인 제출'(공동이용 대상 아님) 매칭 키 — 통장·계약서·신분증·증명사진·동의서·본인서명 +
//   본인이 직접 작성(신고서·계획서)하거나 병원에서 발급받는(진단서·소견서·처방전) 서류.
//   ⚠️ SHAREABLE_KEYS와 겹치지 않도록 좁게 유지(예: 넓은 '영수증'을 넣으면 '건강보험료 납부영수증'이 오탐).
const NO_KEYS = [
  '신분증',
  '통장',
  '계좌',
  '계약서', // 임대차계약서·근로계약서 등 민간 계약서
  '사진', // 증명사진
  '동의서', // 금융정보 제공 동의서 등 본인 서명 동의
  '서명', // 본인서명
  '신고서', // 소득·재산 신고서 등 본인 작성 신고 양식
  '계획서', // 사업계획서·설치계획서 등 본인 작성
  '진단서', // 병원 발급
  '소견서', // 의사소견서·초진소견서
  '처방전',
  '진료비', // 진료비 영수증
  '의료비', // 의료비 영수증
  '이체확인', // 월세 이체확인증 등 본인 거래 내역
]

/** name이 처음 매칭되는 NO 키를 돌려준다(없으면 null). 'no' 사유 문구를 세분화할 때 재사용. */
function matchedNoKey(n: string): string | null {
  return NO_KEYS.find((k) => n.includes(k)) ?? null
}

/**
 * 서류 한 건을 공동이용 관점에서 분류.
 * 흐름:
 *  ① 정규화 → 빈 값이면 판단 보류('maybe').
 *  ② '본인 제출' 키(NO_KEYS) 매칭 시 단정 'no' — 명백한 본인 서류를 우선 걸러 false 'yes'를 막는다(보수).
 *  ③ 공동이용 대상 키(SHAREABLE_KEYS) 매칭 시 'yes'.
 *  ④ 어디에도 안 걸리면 보수적으로 'maybe'.
 */
export function classifyDoc(name: string): Sharable {
  const n = norm(name)
  if (!n) return 'maybe'
  if (matchedNoKey(n)) return 'no'
  if (SHAREABLE_KEYS.some((k) => n.includes(k))) return 'yes'
  return 'maybe'
}

/**
 * 분류 결과에 대한 '정직한' 사유 문구를 만든다.
 * - yes/maybe: 공동이용 가능 여부는 재량·온라인여부에 좌우 → '추정' 라벨 + 최종은 접수처 확인.
 * - no: 본인 제출 서류이므로 단정하되, 어떤 종류(신분·계좌·계약·의료 등)인지 세분해 안내.
 */
function reasonFor(name: string, sharable: Sharable): string {
  if (sharable === 'yes') {
    return "행정정보 공동이용 대상 — 신청서의 '공동이용 동의'에 서명하면 담당기관이 직접 조회해요. 안 떼도 될 수 있어요(추정). 최종은 접수처 확인."
  }
  if (sharable === 'maybe') {
    return "공동이용 가능 여부가 신청기관·온라인 신청 여부·담당자 재량에 따라 달라요(추정). 접수처에 '공동이용으로 대체되나요?'라고 확인하세요."
  }
  // sharable === 'no' — 본인 제출. 매칭된 키로 사유를 세분화.
  const key = matchedNoKey(norm(name))
  switch (key) {
    case '신분증':
      return '본인 확인용이라 직접 지참·제출해야 해요(공동이용 대상 아님).'
    case '통장':
    case '계좌':
      return '입금 계좌 확인용이라 본인이 직접 제출해요(공동이용 대상 아님).'
    case '계약서':
      return '민간 계약서라 기관이 조회할 수 없어요 — 본인이 직접 제출해요.'
    case '사진':
      return '본인 증명사진이라 직접 준비해요(공동이용 대상 아님).'
    case '동의서':
    case '서명':
      return '본인 서명이 필요한 서류라 직접 작성·제출해요.'
    case '신고서':
    case '계획서':
      return '본인이 작성하는 서류라 직접 제출해요(공동이용 대상 아님).'
    case '진단서':
    case '소견서':
    case '처방전':
      return '병원에서 발급받아 본인이 제출해요(공동이용 대상 아님).'
    case '진료비':
    case '의료비':
    case '이체확인':
      return '본인 거래·의료 내역이라 직접 발급·제출해요(공동이용 대상 아님).'
    default:
      return '본인이 직접 준비·제출하는 서류예요(공동이용 대상 아님).'
  }
}

/**
 * 정책의 required_docs 전체를 공동이용 관점에서 진단.
 * 흐름:
 *  ① 각 서류를 classifyDoc으로 분류하고 사유(why)를 붙여 rows 생성(원문 서류명 보존).
 *  ② skippableCount = 'yes' 수, consentNeeded = 생략 가능 서류가 1건 이상인지.
 *  ③ summary는 'N건 중 X건은 공동이용 동의로 생략 가능(추정)' 형식(정직성 라벨 '추정' + 접수처 확인).
 */
export function classifyDocSharing(policy: Policy): DocSharingPlan {
  const docs = Array.isArray(policy?.required_docs) ? policy.required_docs : []
  const rows: DocSharingRow[] = docs.map((doc) => {
    const sharable = classifyDoc(doc)
    return { doc, sharable, why: reasonFor(doc, sharable) }
  })
  const skippableCount = rows.filter((r) => r.sharable === 'yes').length
  const consentNeeded = skippableCount > 0
  const total = rows.length

  let summary: string
  if (total === 0) {
    summary = '필요 서류 정보가 없어 공동이용 판단을 건너뜁니다.'
  } else if (skippableCount === 0) {
    summary = `${total}건 모두 본인이 직접 준비하는 서류로 보여요(추정). 공동이용으로 생략되는지는 접수처에서 확인하세요.`
  } else {
    summary = `${total}건 중 ${skippableCount}건은 공동이용 동의로 생략 가능(추정) — 최종은 접수처 확인.`
  }

  return { rows, skippableCount, consentNeeded, summary }
}
