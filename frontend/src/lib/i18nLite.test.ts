import { describe, it, expect } from 'vitest'
import { t, UI_LANGS, isUiLang, type UiLang } from './i18nLite'

const KEYS = [
  'benefit', 'target', 'eligibility', 'howToApply', 'applyKit', 'requiredDocs',
  'related', 'aiSimilar', 'serviceInfo', 'trust', 'visitPrint',
  'save', 'saved', 'goApply', 'issue',
  'flowTitle', 'stepRecommend', 'stepInfo', 'stepDocs', 'stepAuth', 'stepSubmit',
  'byAuto', 'byGuide', 'byYou', 'banner',
  'clerkCard', 'clerkHint', // 창구 도움 카드(신규)
  'confirmApplyQ', 'confirmDocQ', 'yesDone', 'notYet', 'openOfficial', // 복귀 확인·복구 결정 UI(18차)
] as const

describe('i18nLite — UI 다국어 사전 완전성', () => {
  it('모든 언어가 모든 키를 채운다(빈 문자열 없음)', () => {
    for (const lang of UI_LANGS) {
      for (const key of KEYS) {
        const v = t(lang as UiLang, key)
        expect(v, `${lang}.${key}`).toBeTruthy()
        expect(v.trim().length, `${lang}.${key}`).toBeGreaterThan(0)
      }
    }
  })
  it('지원 언어는 aiAnswer와 동일한 7개+ko', () => {
    expect(UI_LANGS).toEqual(['ko', 'en', 'vi', 'zh', 'ja', 'th', 'ru', 'ar'])
  })
  it('isUiLang — 지원 코드만 통과', () => {
    expect(isUiLang('en')).toBe(true)
    expect(isUiLang('id')).toBe(false) // 인도네시아어는 UI 미지원 → 한국어 폴백
    expect(isUiLang(undefined)).toBe(false)
  })
  it('banner에 통역 연락처(1577-1366 또는 129) 포함 — 정직한 안내', () => {
    for (const lang of UI_LANGS) {
      expect(t(lang as UiLang, 'banner')).toMatch(/1577-1366|129/)
    }
  })
})
