import { useState } from 'react'
import { Server, ShieldAlert, Check, X, ChevronDown } from 'lucide-react'
import { getConfiguredRemoteRpa, setRemoteRpaServer, hasEnvRpaServer } from '@/lib/backend'
import { cn } from '@/lib/utils'

/**
 * 서버 사이드 RPA 옵트인(설치 없이 폰/배포에서 서류 자동발급) 설정 UI.
 *
 * 폰 브라우저는 정부24를 '직접' 조작할 수 없어(Same-Origin/CORS), 사용자가 **자신의 RPA 서버 주소**를
 * 지정하면 그 서버의 브라우저가 대신 정부24를 조작한다(본인인증은 폰 카카오/PASS 승인). 이는 이름·생년월일·
 * 연락처가 그 서버를 '경유'하므로, 반드시 **명시적 동의**를 받고서만 켠다(공개 배포 기본은 로컬 전용).
 *
 * 안전장치(backend.ts): https 서버만·동의 플래그 필수, 자동 감지된 클라우드엔 PII를 절대 안 보냄.
 */
export function RemoteRpaSetup() {
  const current = getConfiguredRemoteRpa()
  const envServer = hasEnvRpaServer() // 팀이 빌드 시 지정한 데모 서버 존재 → URL 없이 '동의만'으로 옵트인 가능
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(current && !envServer ? current : '')
  const [agree, setAgree] = useState(!!current)
  const [err, setErr] = useState('')

  const connect = () => {
    const clean = url.trim()
    // 데모 서버(envServer)가 있으면 URL 없이 동의만으로 OK, 없으면 https URL 필수
    if (!envServer && !/^https:\/\//i.test(clean)) { setErr('https:// 로 시작하는 서버 주소를 입력해 주세요 (개인정보 보호).'); return }
    if (clean && !/^https:\/\//i.test(clean)) { setErr('서버 주소는 https:// 로 시작해야 해요.'); return }
    if (!agree) { setErr('개인정보가 서버를 거치는 것에 동의하셔야 켤 수 있어요.'); return }
    setRemoteRpaServer(clean, true) // 저장(빈 URL이면 데모 서버 폴백) + 재탐지
    window.location.reload() // 백엔드 재감지 반영(설정은 유지됨)
  }
  const disconnect = () => {
    setRemoteRpaServer('', false)
    window.location.reload()
  }

  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <Server className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-sm font-semibold text-amber-900">
          고급: 설치 없이 <b>내 서버로</b> 자동발급 {current && <span className="text-emerald-700">· 연결됨</span>}
        </span>
        <ChevronDown className={cn('ml-auto h-4 w-4 text-amber-600 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm text-amber-950/90">
          <p className="leading-relaxed">
            {envServer ? (
              <>이 데모의 <b>자동발급 서버</b>가 대신 정부24를 조작하고, 본인인증은 <b>내 폰의 카카오톡·PASS</b>로 승인해요.
                아래 동의만 하면 <b>내 정보로 실제 서류 발급까지</b> 이어서 해볼 수 있어요.</>
            ) : (
              <>폰 화면(웹)은 정부24를 직접 조작할 수 없어요(브라우저 보안). 대신 <b>내가 띄운 RPA 서버</b>의
                브라우저가 대신 정부24를 조작하고, 본인인증은 <b>내 폰의 카카오톡·PASS</b>로 승인해요.</>
            )}
          </p>
          <div className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-[13px] leading-relaxed text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              이 기능을 켜면 <b>이름·생년월일·연락처가 지정한 서버를 거쳐</b> 정부24에 입력돼요.
              신뢰할 수 있는(직접 운영하는) 서버만 입력하세요. 서버는 개인정보를 저장하지 않도록 설계돼야 해요.
            </span>
          </div>

          {!envServer && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-amber-800">내 RPA 서버 주소 (https)</span>
              <input
                type="url"
                inputMode="url"
                placeholder="https://my-rpa.example.com"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setErr('') }}
                className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              />
            </label>
          )}

          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => { setAgree(e.target.checked); setErr('') }}
              className="mt-0.5 h-4 w-4 accent-amber-600"
            />
            <span>내 정보(이름·생년월일·연락처)가 이 서버를 거쳐 정부24에 입력되는 것에 동의합니다.</span>
          </label>

          {err && <p className="text-[13px] font-medium text-rose-600">{err}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={connect}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              <Check className="h-4 w-4" /> {current ? (envServer ? '동의 갱신' : '서버 변경') : (envServer ? '실제 발급 켜기 (동의)' : '서버 연결')}
            </button>
            {current && (
              <button
                type="button"
                onClick={disconnect}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
              >
                <X className="h-4 w-4" /> 연결 해제
              </button>
            )}
          </div>
          <p className="text-[12px] text-amber-800">
            서버 띄우는 법은 <code>docs/서버사이드-RPA-설계.md</code> 참고. 노트북에서 쓴다면 설치형 로컬 앱이 더 안전·간편해요.
          </p>
        </div>
      )}
    </div>
  )
}
