import { ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'

const CARRIERS = ['SKT', 'KT', 'LGU+', 'SKM', 'KTM', 'LGM']
// 간편인증 수단 — 어르신 다수가 카카오 미사용(통신사 PASS 등)이라 선택 지원(복지관 현장 필수)
const AUTH_PROVIDERS = [
  { v: 'kakao', label: '카카오톡' },
  { v: 'pass', label: '통신사 PASS' },
  { v: 'naver', label: '네이버' },
  { v: 'toss', label: '토스' },
] as const

/**
 * 에이전트 자동입력용 추가정보 입력(선택).
 * 본인인증 폼 자동 작성에만 쓰이며, 서버 전송 없이 내 기기(localStorage)에만 저장.
 */
export function RpaInfoForm() {
  const { rpaInfo, setRpaInfo, resetForNextUser } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa
  const nextUser = () => {
    if (!window.confirm('이전 상담자의 정보(이름·생년월일·연락처·담은 복지·발급 기록·대화 내용)를 모두 지우고 새 상담을 시작할까요?')) return
    resetForNextUser() // 화면·localStorage·챗 대화 초기화
    // 로컬 에이전트면 서버에 저장된 발급 서류(주민번호 포함 PDF)도 삭제 — 다음 분에게 안 남게
    if (localAgent) fetch(`${getRpaBase()}/api/session/reset`, { method: 'POST' }).catch(() => { /* 실패해도 화면은 초기화됨 */ })
  }
  return (
    <div className="mt-3 rounded-xl bg-white border border-sprout-100 p-3 space-y-2 scroll-mt-24">
      <p className="text-[11px] font-bold flex items-center gap-1 text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-sprout-500" /> 자동입력 추가정보 (선택 · 내 기기에만 저장)
      </p>
      <p className="text-[11px] text-sprout-700 leading-relaxed">
        실명·생년월일·휴대폰을 넣어두면 서류 발급 때 <b>본인인증 화면까지 자동으로 채워드려요</b> — 폰에서 ‘인증 허용’만 누르면 끝이에요.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={rpaInfo.name ?? ''}
          onChange={(e) => setRpaInfo({ name: e.target.value })}
          placeholder="실명 (본인인증용)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="실명"
        />
        <input
          value={rpaInfo.birth_date}
          onChange={(e) => setRpaInfo({ birth_date: e.target.value })}
          placeholder="생년월일 (예: 19600101)"
          inputMode="numeric"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="생년월일"
        />
        <input
          value={rpaInfo.phone}
          onChange={(e) => setRpaInfo({ phone: e.target.value })}
          placeholder="휴대폰 (01012345678)"
          inputMode="numeric"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="휴대폰 번호"
        />
        {/* 주민등록상 주소 — 회원정보 주소와 다르면 발급 폼에서 자동으로 이 주소로 정정 */}
        <input
          value={rpaInfo.sido ?? ''}
          onChange={(e) => setRpaInfo({ sido: e.target.value })}
          placeholder="시도 (예: 경상북도)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="주민등록상 시도"
        />
        <input
          value={rpaInfo.sigungu ?? ''}
          onChange={(e) => setRpaInfo({ sigungu: e.target.value })}
          placeholder="시군구 (예: 경산시)"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="주민등록상 시군구"
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="통신사">
        {CARRIERS.map((c) => (
          <button
            key={c}
            onClick={() => setRpaInfo({ carrier: rpaInfo.carrier === c ? '' : c })}
            aria-pressed={rpaInfo.carrier === c}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              rpaInfo.carrier === c ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {/* 현장(복지관) 상담 전환 — 이전 분의 개인정보·기록을 한 번에 삭제.
          ⚠️ 항상 노출(조건부 렌더 금지) — 서류 발급을 안 한 상담에서도 이전 어르신의 분석·담은목록·챗 대화가 남아 삭제가 필요하다(감사 확정). */}
      <button
        onClick={nextUser}
        className="w-full rounded-lg border border-peach-200 bg-peach-50 px-2.5 py-1.5 text-[11px] font-bold text-peach-800 hover:bg-peach-100 transition-colors"
      >
        다음 분 상담 시작 (이전 정보 전체 삭제)
      </button>
      {/* 인증수단 — 폰에 깔린 앱으로 선택(카카오 없는 어르신은 통신사 PASS가 대부분) */}
      <p className="text-[11px] font-bold text-muted-foreground pt-1">본인인증 앱 (폰에 있는 걸로 선택)</p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="간편인증 수단">
        {AUTH_PROVIDERS.map(({ v, label }) => (
          <button
            key={v}
            role="radio"
            aria-checked={(rpaInfo.auth_provider || 'kakao') === v}
            onClick={() => setRpaInfo({ auth_provider: v })}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
              (rpaInfo.auth_provider || 'kakao') === v ? 'bg-sprout-700 border-sprout-700 text-white' : 'bg-white border-sprout-100 text-muted-foreground hover:border-sprout-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
