import { describe, it, expect } from 'vitest'
import { detectLang, detectUiLang } from './detectLang'

describe('detectLang', () => {
  it('빈 문자열은 null', () => {
    expect(detectLang('')).toBeNull()
    expect(detectLang('   ')).toBeNull()
  })

  it('한국어 감지', () => {
    expect(detectLang('노인인데 돈이 없어요')?.code).toBe('ko')
  })

  it('영어 감지', () => {
    expect(detectLang('I lost my job and need help')?.code).toBe('en')
  })

  it('베트남어 감지(성조 문자)', () => {
    expect(detectLang('Tôi là người khuyết tật')?.code).toBe('vi')
    expect(detectLang('Tôi cần hỗ trợ tiền thuê nhà')?.code).toBe('vi')
  })

  it('중국어(한자) 감지', () => {
    expect(detectLang('我需要帮助')?.code).toBe('zh')
  })

  it('일본어(가나) 감지', () => {
    expect(detectLang('お金がありません')?.code).toBe('ja')
  })

  it('한글이 섞이면 한국어 우선', () => {
    expect(detectLang('welfare 복지 help')?.code).toBe('ko')
  })

  it('감지 결과에 라벨·국기 포함', () => {
    const d = detectLang('xin chào tôi cần giúp đỡ')
    expect(d?.label).toBe('Tiếng Việt')
    expect(d?.flag).toBe('🇻🇳')
  })
})

describe('detectUiLang — UI 언어 결정(보수적·항상 ko 복귀)', () => {
  it('빈 문자열은 ko로 복귀(외국어 고착 방지)', () => {
    expect(detectUiLang('')).toBe('ko')
    expect(detectUiLang('   ')).toBe('ko')
  })
  it('한국어는 ko', () => {
    expect(detectUiLang('기초연금 알려줘')).toBe('ko')
  })
  it('감사 회귀: 영문 약어·오타 한 글자로는 en 전환 안 함(확신 게이트)', () => {
    expect(detectUiLang('LH')).toBe('ko')
    expect(detectUiLang('EITC')).toBe('ko')
    expect(detectUiLang('a')).toBe('ko')
    expect(detectUiLang('dks')).toBe('ko') // 짧은 한/영 오타(라틴 3자)는 ko 유지
    expect(detectUiLang('dkssud')).toBe('ko') // 6자 이상 단일어 오타도 ko(영어 UI는 2단어 이상만)
    expect(detectUiLang('wldnjs')).toBe('ko')
    expect(detectUiLang('welfare')).toBe('ko') // 단일 영단어는 검색은 되지만 UI는 ko 유지(오발동 방지)
  })
  it('명확한 영어 문장은 en(2단어 이상)', () => {
    expect(detectUiLang('I lost my job and need help')).toBe('en')
    expect(detectUiLang('housing support')).toBe('en')
  })
  it('베트남어 문장은 vi', () => {
    expect(detectUiLang('Tôi cần hỗ trợ tiền thuê nhà')).toBe('vi')
  })
  it('비라틴 스크립트는 짧아도 신뢰(일·중)', () => {
    expect(detectUiLang('お金')).toBe('ja')
    expect(detectUiLang('帮助')).toBe('zh')
  })
})

describe('스크립트 고유 언어 확장(2026-08-11) — 결과 번역 대상 언어 확대', () => {
  it('데바나가리·벵골·타밀·싱할라 문장 감지', () => {
    expect(detectLang('मुझे मदद चाहिए')?.code).toBe('hi')
    expect(detectLang('আমার সাহায্য দরকার')?.code).toBe('bn')
    expect(detectLang('எனக்கு உதவி வேண்டும்')?.code).toBe('ta')
    expect(detectLang('මට උදව් අවශ්‍යයි')?.code).toBe('si')
  })
  it('크메르·미얀마·라오 문장 감지(라오는 태국 문자와 구분)', () => {
    expect(detectLang('ខ្ញុំត្រូវការជំនួយ')?.code).toBe('km')
    expect(detectLang('ကျွန်တော် အကူအညီ လိုပါတယ်')?.code).toBe('my')
    expect(detectLang('ຂ້ອຍຕ້ອງການຄວາມຊ່ວຍເຫຼືອ')?.code).toBe('lo')
    expect(detectLang('ฉันต้องการความช่วยเหลือ')?.code).toBe('th') // 태국어는 여전히 th(비회귀)
  })
  it('새 언어도 라벨·국기가 있다(감지 칩 표시 계약)', () => {
    for (const q of ['मदद', 'সাহায্য', 'உதவி', 'උදව්', 'ជំនួយ', 'အကူအညီ', 'ຊ່ວຍ']) {
      const d = detectLang(q)
      expect(d?.label, q).toBeTruthy()
      expect(d?.flag, q).toBeTruthy()
    }
  })
  it('detectUiLang: 비라틴 신뢰 원칙이 새 언어에도 적용(짧아도 채택)', () => {
    expect(detectUiLang('ជំនួយ')).toBe('km')
    expect(detectUiLang('मदद')).toBe('hi')
  })
  it('비회귀: 한국어·영어·베트남어 판정 불변', () => {
    expect(detectLang('기초연금')?.code).toBe('ko')
    expect(detectLang('I need help with housing')?.code).toBe('en')
    expect(detectLang('Tôi cần hỗ trợ')?.code).toBe('vi')
  })
})
