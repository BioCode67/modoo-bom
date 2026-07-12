import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 연계 감면(요금감면 일괄신청) — '자격이 되면 딸려오지만 몰라서 못 받는' 감면을 묶어 안내.
 *
 * 미션 직결: 기초수급·차상위·장애·다자녀·한부모 자격이 되면 통신·전기·도시가스·TV수신료 감면이
 * 함께 적용되는데, 각각 따로 신청해야 해 대부분 놓친다. 정부24 '요금감면 일괄신청'으로 한 번에 처리.
 *
 * 정직성: (1) 금액을 '현금 합계'에 더하지 않는다(감면=지출 절감이지 현금소득 아님). (2) 문서화된 연계만.
 * (3) '자격이 확정되면'이라는 조건부로만 안내(수급·장애 등 자격은 심사로 확정). (4) 금액은 2026 기준
 * '최대·약'으로 보수적 표기, 세부 감면액은 신청 시 확정.
 */
export interface DiscountItem {
  icon: string
  name: string
  detail: string
}

export interface LinkedGroup {
  id: string
  label: string
  why: string // 이 묶음이 적용되는 자격 근거(조건부 안내)
  items: DiscountItem[]
  apply: { label: string; url: string }
}

// 정부24 '요금감면 일괄신청'(전기·도시가스·지역난방) 실제 민원 — 2026-07 <title> '요금감면일괄신청'로 생존 검증.
//   ⚠️ 통신요금(통신사 114)·TV수신료(KBS 1588-1801/주민센터)는 이 일괄신청에 포함 안 됨 → 카드 문구로 별도 안내.
//   (과거 rcvfvrStus 딥링크는 200이지만 soft-404 에러페이지라 사용 금지 — 반드시 <title> 확인.)
const ONESTOP = {
  label: '정부24 요금감면 일괄신청',
  url: 'https://www.gov.kr/portal/service/serviceInfo/174100000049',
}
const BOKJIRO = { label: '복지로에서 확인·신청', url: 'https://www.bokjiro.go.kr' }

/** 프로필의 '자격 신호'로 적용 가능한 연계 감면 묶음을 반환(조건부 안내). 금액은 현금 합계에 더하지 않는다. */
export function getLinkedDiscounts(p: UserProfile): LinkedGroup[] {
  const groups: LinkedGroup[] = []
  const inc = p.income_percentile
  const minors = (p.children_ages || []).filter((a) => a < 18).length
  const isMultiChild = minors >= 2 || (p.household_type || '').includes('다자녀')
  const isSingleParent = /한부모|조손/.test(p.household_type || '')

  // ── 기초생활 수급(생계·의료, 중위 40% 이하) — TV수신료 면제 포함(생계·의료) ──
  if (inc <= 40) {
    groups.push({
      id: 'recipient',
      label: '기초생활 수급 가구',
      why: '생계·의료급여 수급이 확정되면 아래 요금감면이 함께 적용돼요(주거·교육급여는 감면폭이 달라요).',
      items: [
        { icon: '💡', name: '전기요금 감면', detail: '월 최대 16,000원(여름 20,000원) 감면 · 정부24 일괄신청' },
        { icon: '🔥', name: '도시가스 감면', detail: '동절기 취사·난방 월 24,000원 정액 감면 · 정부24 일괄신청' },
        { icon: '📱', name: '통신요금 감면', detail: '기본료 최대 26,000원 면제 + 통화료 50%(합산 41,000원 한도) · 통신사 114' },
        { icon: '📺', name: 'TV 수신료 면제', detail: '생계·의료 수급 월 2,500원 면제 · KBS 1588-1801/주민센터' },
      ],
      apply: ONESTOP,
    })
  } else if (inc <= 50) {
    // ── 차상위계층(중위 50% 이하) ──
    groups.push({
      id: 'near-poor',
      label: '차상위계층',
      why: '차상위 자격이 확정되면 아래 요금감면을 함께 신청할 수 있어요.',
      items: [
        { icon: '📱', name: '통신요금 감면', detail: '기본감면 + 통화료 35% (차상위 최대 월 약 2.1만원)' },
        { icon: '💡', name: '전기요금 감면', detail: '월 최대 약 8천원(여름 1만원) 한도 감면' },
        { icon: '🔥', name: '도시가스 감면', detail: '동절기 월 최대 약 1.2만원 감면' },
      ],
      apply: ONESTOP,
    })
  }

  // ── 등록 장애인 ── (소득과 별개로 적용되는 감면 다수)
  if (p.disability) {
    groups.push({
      id: 'disability',
      label: '등록 장애인',
      why: '장애인 등록이 되어 있으면 소득과 별개로 아래 감면을 받을 수 있어요(중증 여부에 따라 폭이 달라요).',
      items: [
        { icon: '📱', name: '통신요금 감면', detail: '이동전화 기본료·통화료 35% 감면' },
        { icon: '💡', name: '전기요금 감면', detail: '월 최대 약 1.6만원(여름 2만원) — 중증 기준' },
        { icon: '📺', name: 'TV 수신료 면제', detail: '시각·청각 장애인은 월 2,500원 면제' },
        { icon: '🚗', name: '교통 감면', detail: '고속도로 통행료 50%·철도·도시철도 감면' },
      ],
      apply: ONESTOP,
    })
  }

  // ── 다자녀 가구 ──
  if (isMultiChild) {
    groups.push({
      id: 'multichild',
      label: '다자녀 가구',
      why: '자녀 수 기준(혜택별 2자녀/3자녀)을 충족하면 아래 감면·할인이 적용돼요.',
      items: [
        { icon: '💡', name: '전기요금 감면', detail: '3자녀 이상 30%, 월 최대 약 1.6만원' },
        { icon: '🔥', name: '도시가스 감면', detail: '동절기 월 최대 약 1.8만원' },
        { icon: '🚄', name: 'KTX·SRT 할인', detail: '어른 운임 할인(2자녀 이상)' },
        { icon: '🚗', name: '자동차 취득세 감면', detail: '2자녀 50%·3자녀 이상 100%(한도 내)' },
      ],
      apply: ONESTOP,
    })
  }

  // ── 한부모가족(수급·차상위와 함께) ──
  if (isSingleParent && inc <= 60) {
    groups.push({
      id: 'single-parent',
      label: '한부모가족',
      why: '한부모가족 증명이 되면 이동통신 감면 등 추가 지원을 받을 수 있어요.',
      items: [
        { icon: '📱', name: '이동통신 요금감면', detail: '기본감면 + 통화료 감면(자격 기준)' },
        { icon: '🏠', name: '공공요금·주거 지원 연계', detail: '수급·차상위이면 위 감면과 함께 적용' },
      ],
      apply: BOKJIRO,
    })
  }

  return groups
}
