import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { clearLive } from '@/lib/liveTasks'
import { isKeepOn, setKeepOn, saveKept, loadKept, clearKept } from '@/lib/rpaInfoKeep'
import { notifyDocsChanged } from '@/components/DocVault'

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
 * 본인인증 폼 자동 작성에만 쓰이며, 기본은 서버 전송 없이 '메모리에만' 유지된다 —
 * rpaInfo는 persist(partialize)에서 의도적으로 제외돼 디스크(localStorage)에 남지 않고,
 * 새로고침하면 비워진다(공용 PC에서 실명·연락처가 디스크에 잔류하지 않게 하는 프라이버시 설계).
 * ⚠️ 예외 1: 사용자가 '원격 RPA 서버'에 명시 동의(rpaRemote)한 경우엔 그 서버로 전송돼 자동입력에 쓰인다 —
 * 문구도 그 사실대로 분기한다(거짓 '미전송' 표기 금지, 정직성 원칙).
 * ⚠️ 예외 2(옵트인): '이 탭에서는 기억하기'를 켜면 sessionStorage에만 보관 — 새로고침(F5)에도 유지되고
 * 탭을 닫으면 브라우저가 삭제한다. 기본 OFF, '다음 분 상담 시작'이 보관분+옵트인을 함께 지운다(rpaInfoKeep).
 */
export function RpaInfoForm() {
  const { rpaInfo, setRpaInfo, resetForNextUser } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa
  // '이 탭에서는 기억' 옵트인 — 새로고침 실수로 인증정보를 재입력하는 실사용 불편의 안전망(발표·상담 현장)
  const [keep, setKeep] = useState(isKeepOn)
  const hydratedRef = useRef(false)
  useEffect(() => {
    // 마운트 1회: 옵트인 상태고 폼이 비어 있으면 이 탭 보관분 복원(입력 중 값 덮어쓰기 금지)
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (!isKeepOn()) return
    const kept = loadKept()
    if (kept && !rpaInfo.name?.trim() && !rpaInfo.birth_date?.trim() && !rpaInfo.phone?.trim()) setRpaInfo(kept)
  }, [rpaInfo, setRpaInfo])
  useEffect(() => {
    // 입력 변경마다 — 옵트인 시에만 이 탭(sessionStorage)에 반영(OFF면 saveKept가 no-op)
    if (keep) saveKept(rpaInfo)
  }, [keep, rpaInfo])
  // 검증형 리셋 — '지웠다'고 말만 하지 않고 무엇이 지워졌는지 결과로 보여준다(복지관 공용 PC 신뢰성).
  //   ⚠️ 리셋이 tracked를 비우면 이 폼(DocumentCenter 안)이 통째로 언마운트되므로 인라인 메시지는
  //   보일 곳이 없다 → 언마운트와 무관한 alert로 결과를 확정 표시(기존 confirm과 동일한 대화 방식).
  const nextUser = async () => {
    if (!window.confirm('이전 상담자의 정보(이름·생년월일·연락처·담은 복지·발급 기록·대화 내용)를 모두 지우고 새 상담을 시작할까요?')) return
    // 서버의 발급 서류(주민번호 포함 PDF)부터 삭제 — 결과 건수를 확보한 뒤 화면을 리셋한다.
    let msg = '✅ 새 상담 준비 완료 — 이 기기의 기록을 지웠어요.'
    // 서버 발급 폴더 삭제는 '내 PC' 에이전트에서만 — 원격/공유 서버의 폴더는 내 것이 아니며
    // 서버도 RPA_SHARED에서 403으로 막는다(호출하면 불필요한 실패 경고만 뜸).
    if (localAgent && !caps?.rpaRemote && !caps?.shared) {
      try {
        // 서버가 행이면 confirm 뒤 아무 반응 없는 상태가 길어진다 → 5초 타임아웃(초과 시 정직한 경고 폴백)
        const ctrl = new AbortController()
        const to = setTimeout(() => ctrl.abort(), 5000)
        const r = await fetch(`${getRpaBase()}/api/session/reset`, { method: 'POST', signal: ctrl.signal }).then((x) => x.json())
        clearTimeout(to)
        msg = `✅ 새 상담 준비 완료 — 화면 기록과 발급 서류 파일 ${Number(r?.cleared ?? 0)}건을 지웠어요.`
      } catch {
        // 서버 삭제 실패는 숨기지 않는다 — 발급 폴더에 이전 분 서류(주민번호 포함)가 남았을 수 있음
        msg = '⚠️ 화면 기록은 지웠지만 발급 폴더 정리에 실패했어요 — 서류 폴더에서 이전 분 서류를 직접 확인해 주세요.'
      }
    }
    resetForNextUser() // 화면·localStorage·챗 대화 초기화
    clearLive() // 진행 중 태스크 복원 기록(taskId·토큰)도 제거 — 다음 상담자에게 직전 사용자의 진행이 복원되지 않게
    clearKept(); setKeep(false) // '이 탭에서는 기억' 보관분+옵트인도 삭제 — 다음 분에게 이전 분 인증정보가 남지 않게
    notifyDocsChanged() // 🗂 내 서류함도 비워진 상태로 갱신
    window.alert(msg)
  }
  return (
    <div className="mt-3 rounded-xl bg-white border border-sprout-100 p-3 space-y-2 scroll-mt-24">
      <p className="text-[11px] font-bold flex items-center gap-1 text-muted-foreground">
        {/* 보관 방식 문구는 실제 상태 그대로 분기 — 옵트인을 켰는데 '새로고침 시 비워짐'이라 쓰면 거짓 */}
        <ShieldCheck className="h-3.5 w-3.5 text-sprout-500" /> 자동입력 추가정보 (선택 · {caps?.rpaRemote ? '동의한 원격 에이전트로 전송돼 자동입력에만 사용' : keep ? '내 기기에서만 사용 · 이 탭에만 잠시 보관(탭 닫으면 삭제)' : '내 기기에서만 사용 · 디스크에 저장 안 함(새로고침 시 비워짐)'})
      </p>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={keep}
          onChange={(e) => { const on = e.target.checked; setKeep(on); setKeepOn(on, rpaInfo) }}
          className="accent-sprout-600"
        />
        이 탭에서는 기억하기 — 실수로 새로고침해도 유지 · 탭을 닫으면 자동 삭제
      </label>
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
        {/* 🔒 가족관계증명서(대법원 efamily)용 — 뒷자리는 password 타입이라 화면에 ●●●●●●●로만 보인다.
            rpaInfoKeep FIELDS에서 제외돼 '이 탭에서는 기억'을 켜도 보관되지 않는다(민감정보 무보관). */}
        <input
          type="password"
          value={rpaInfo.rrn_back ?? ''}
          onChange={(e) => setRpaInfo({ rrn_back: e.target.value.replace(/[^0-9]/g, '').slice(0, 7) })}
          placeholder="주민번호 뒷 7자리 (가족관계용·선택)"
          inputMode="numeric"
          maxLength={7}
          autoComplete="off"
          className="rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
          aria-label="주민등록번호 뒷자리 (가족관계증명서용, 화면에 가려져 표시)"
        />
        <div className="flex gap-1">
          <select
            value={rpaInfo.parent_kind || '부'}
            onChange={(e) => setRpaInfo({ parent_kind: e.target.value })}
            className="rounded-lg border border-sprout-100 px-1.5 py-1.5 text-xs focus-ring shrink-0"
            aria-label="추가정보확인 종류 (부 또는 모)"
          >
            <option value="부">부</option>
            <option value="모">모</option>
          </select>
          <input
            value={rpaInfo.parent_name ?? ''}
            onChange={(e) => setRpaInfo({ parent_name: e.target.value })}
            placeholder="부/모 성명 (가족관계용·선택)"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-sprout-100 px-2.5 py-1.5 text-xs focus-ring"
            aria-label="부 또는 모 성명 (가족관계증명서용)"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        🔒 뒷 7자리·부모 성명은 <b>가족관계증명서(대법원) 발급 자동입력에만</b> 쓰여요 — 화면엔 ●로 가려지고,
        디스크·탭 기억에도 <b>저장되지 않아요</b>. 넣어두면 인증 요청까지 전부 자동이 돼요.
      </p>
      <div className="flex flex-wrap gap-1">
        {CARRIERS.map((c) => (
          <button
            key={c}
            onClick={() => setRpaInfo({ carrier: rpaInfo.carrier === c ? '' : c })}
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
