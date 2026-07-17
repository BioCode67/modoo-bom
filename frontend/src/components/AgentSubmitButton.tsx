import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react'
import type { Policy } from '@/data/policies'
import type { EligiblePolicy } from '@/lib/welfare-engine'
import { useBackend } from '@/lib/useBackend'
import { isApplyAutomatable, applyLink } from '@/lib/officialLinks'
import { bestApplyUrl, isBokjiroApplyable } from '@/lib/quickApply'
import { getRpaBase } from '@/lib/backend'
import { detectExtension, applyViaExtension, onExtensionStatus, sameDocName } from '@/lib/extension'
import { setPendingReturn } from '@/lib/returnPrompt'
import { rememberLive, forgetLive, listLive } from '@/lib/liveTasks'
import { titleBadge } from '@/lib/titleBadge'
import { playAuthCue, isAuthWaitTransition } from '@/lib/authCue'
import { RpaInfoForm } from '@/components/RpaInfoForm'
import { useAppStore } from '@/store/useAppStore'

type RunState = { status: string; step: string; shot?: string; at?: number; taskId?: string } | null

/**
 * 에이전트 신청 자동화 — 정직한 human-in-the-loop.
 * 로컬 에이전트(백엔드) 또는 크롬 확장이 있을 때 실제 RPA 구동. 본인인증·최종 제출은 사용자가 직접.
 */
export function AgentSubmitButton({ policy }: { policy: Policy | EligiblePolicy }) {
  const { ready, caps } = useBackend()
  const profile = useAppStore((s) => s.profile)
  const rpaInfo = useAppStore((s) => s.rpaInfo)
  const isSaved = useAppStore((s) => s.isSaved)
  const toggleSaved = useAppStore((s) => s.toggleSaved)
  const setStatus = useAppStore((s) => s.setStatus)
  const setView = useAppStore((s) => s.setView)
  const [recorded, setRecorded] = useState(false) // '제출까지 마쳤어요' 기록 여부(이 세션 표시용)
  const [run, setRun] = useState<RunState>(null)
  const [ext, setExt] = useState(false)
  const automatable = isApplyAutomatable(policy.name)
  // 폴링 중단 가드(언마운트 후 setState 방지) + 중복 기동 방지(신청이 진행 중이면 재클릭 무시)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)
  // 폴링 세대 카운터 — '처음부터 다시'가 진행 중 폴링 루프를 실제로 끊게 한다(감사 :145).
  //   과거엔 setRun(null)만 해서 1.5초 뒤 이전 상태가 부활하고 runningRef가 잠겨 재시작이 무시됐다.
  const genRef = useRef(0)
  useEffect(() => () => { mountedRef.current = false }, [])

  // 확장 감지 + 진행상태 구독(해당 서비스만 — 표기 차이는 퍼지매칭) + 무응답 감지용 틱
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000)
    const off = onExtensionStatus((s) => {
      if (sameDocName(s.docName, policy.name)) setRun({ status: s.status, step: s.step, at: Date.now() })
    })
    return () => { clearInterval(t); off() }
  }, [policy.name])

  // 📎 자동첨부 미리보기 — '지금 신청하면 붙을 후보'를 서버 기준(/api/documents/list attach_candidate)으로
  //   미리 보여준다. 자동첨부가 보이지 않는 마법이 아니라 시작 전 확인 가능한 상태가 되게(신뢰성).
  //   ⚠️ '내 PC' 에이전트에서만 — 원격(공유) RPA에선 서버 목록에 다른 이용자의 서류 표시명(실명 포함)이
  //   섞일 수 있어 조회하지 않는다(DocVault 와 동일한 프라이버시 게이트).
  const [attachPreview, setAttachPreview] = useState<string[] | null>(null)
  const rpaOn = ready === true && !!caps?.rpa
  const previewOn = rpaOn && !caps?.rpaRemote && !caps?.shared
  useEffect(() => {
    if (!previewOn) { setAttachPreview(null); return }
    let alive = true
    fetch(`${getRpaBase()}/api/documents/list`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return
        const names = (j.documents || []).filter((d: { attach_candidate?: boolean }) => d.attach_candidate)
          .map((d: { display: string }) => d.display)
        setAttachPreview(names)
      })
      .catch(() => { /* 미리보기는 부가 정보 — 실패해도 신청 흐름엔 영향 없음 */ })
    return () => { alive = false }
  }, [previewOn, run?.status])

  // 🔁 세션 연속성 — 새로고침·뷰 이탈 후에도 진행 중이던 자동신청 추적을 재연결(문서센터와 동일 원리).
  //   ⚠️ 훅은 아래 조기 return(null)보다 먼저 선언돼야 한다(rules-of-hooks). pollApply는 effect 실행
  //   시점(마운트 후)엔 이미 정의돼 있어 안전하게 참조된다.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (!rpaOn || resumedRef.current || run) return
    const t = listLive('apply')[policy.id]
    if (!t) return
    resumedRef.current = true
    runningRef.current = true
    const gen = ++genRef.current
    const startedAt = Date.now()
    setRun({ status: 'running', step: '진행 상태 다시 연결 중…', at: startedAt, taskId: t.taskId })
    pollApply(t.taskId, t.token, startedAt, gen, true).finally(() => { if (genRef.current === gen) runningRef.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpaOn])

  // 복지로/한국장학재단 신청 URL을 가진 정책이면 자동신청 가능(내장 6종에 국한하지 않음)
  const app = policy.application || ''
  // ⚠️ 로컬 백엔드용 URL은 bestApplyUrl 결과 기준 — 복지로 '홈'(wlfareInfoId 없음, 미등록 서비스)은
  //   bestApplyUrl이 gov.kr 검색으로 폴백해 백엔드가 400을 낸다. 결과가 실제 복지로일 때만 로컬 자동신청.
  const localApplyUrl = bestApplyUrl(policy.application, policy.name, policy.id)
  // 복지로 '딥링크'로 해석될 때만(홈으로만 빠지는 방문형 제외) 자동신청 노출/구동 — 단일 기준 helper 사용
  const isBokjiroLocal = isBokjiroApplyable(policy.application, policy.name, policy.id)
  const isExtApplyable = /bokjiro\.go\.kr/.test(app) || /kosaf\.go\.kr/.test(app)  // 확장은 원 URL 기준(복지로+장학재단)
  // ⚠️ application 필드가 '복지로 온라인 신청'처럼 URL이 아닌 표시문자열이면 isExtApplyable=false라
  //   청년월세지원 등 인기 서비스의 자동신청 버튼이 통째로 숨던 결함 → 해석된 복지로 딥링크(isBokjiroLocal)도 노출조건에 포함.
  const showApply = automatable || isExtApplyable || isBokjiroLocal
  if (!showApply) return null

  // 실제 자동화 가능 여부: 확장(복지로/장학재단) 또는 로컬 에이전트(내장 6종 + 복지로 딥링크 일반화).
  const rpaReady = ready === true && !!caps?.rpa
  const canExt = ext && (isExtApplyable || isBokjiroLocal)  // 확장도 해석된 복지로 딥링크로 신청 가능
  const canLocal = rpaReady && (automatable || isBokjiroLocal)
  const canRpa = canExt || canLocal
  if (!canRpa) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-sprout-200 bg-sprout-50/50 p-4">
        <p className="text-sm font-bold flex items-center gap-1.5"><Bot className="h-4 w-4 text-sprout-500" /> 에이전트 자동 신청</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          설치 없이 아래 버튼으로 <b>공식 신청 페이지에 바로</b> 가세요 — 위 신청 키트의 내 정보 복사와 함께 쓰면 가장 빨라요.
          <b> 본인인증·최종 제출은 본인이 직접</b> 하셔야 해요. (파워유저·시연용: 크롬 확장을 설치하면 로그인·이동·양식 작성까지 에이전트가 대신해요)
        </p>
        <a href={bestApplyUrl(policy.application, policy.name, policy.id)} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 mt-2 text-xs">
          <ExternalLink className="h-3.5 w-3.5" /> {applyLink(policy.application).label}
        </a>
      </div>
    )
  }

  // 신청이 실제로 시작되면(백엔드 태스크 생성·확장 새 탭) 정부 탭에서 돌아온 순간 '신청하셨나요?' 1탭 확인을
  //   띄우게 예약한다 → '네'를 눌러야만 applied 기록(자동 낙관처리 금지, 정직성). 미저장 정책이면 먼저 담아
  //   확인 '네'가 실제로 상태에 남게 한다(setStatus는 tracked 항목만 갱신하므로).
  const armReturnConfirm = () => {
    if (!isSaved(policy.id)) toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
    setPendingReturn({ kind: 'apply', policyId: policy.id, name: policy.name })
  }

  const start = async () => {
    if (runningRef.current) return  // 진행 중 재클릭 무시 — 동일 신청 태스크 중복 기동 방지(감사 확정)
    runningRef.current = true
    const gen = ++genRef.current    // 이 실행의 세대 — reset()이 세대를 올리면 이 루프는 스스로 종료
    const startedAt = Date.now()
    setRun({ status: 'running', step: '에이전트 시작 — 새 탭에서 복지로에 접속해요…', at: startedAt })
    // 로컬 에이전트(내장 6종)가 되면 백엔드 우선, 아니면 확장으로 신청(복지로 딥링크 전달)
    if (!canLocal && canExt) {
      const r = await applyViaExtension(policy.name, {
        user_name: rpaInfo.name || profile?.name || '사용자', birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        auth_provider: rpaInfo.auth_provider || 'kakao', // 확장 자동신청에도 인증수단 전달
      }, localApplyUrl || policy.application) // 원 URL 대신 해석된 복지로 딥링크 전달(표시문자열이어도 이동 가능)
      if (!r.ok) setRun({ status: 'error', step: r.error || '이 서비스는 확장 자동신청을 아직 지원하지 않아요.', at: Date.now() })
      else armReturnConfirm() // 확장이 복지로 탭을 열었으니 복귀 시 신청완료 확인
      runningRef.current = false
      return
    }
    try {
      const res = await fetch(`${getRpaBase()}/api/apply/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // apply_url: 검증된 복지로 딥링크(canLocal이 isBokjiroLocal일 때만 도달) — 백엔드가 호스트 재검증.
        body: JSON.stringify({ service_name: policy.name, user_name: rpaInfo.name || profile?.name || '사용자', profile: { ...(profile || {}), ...rpaInfo, apply_url: localApplyUrl } }),
      })
      if (!res.ok) {
        // 503(이용자 많음/RPA 비활성)은 서버 안내를 그대로 노출 — 아래 공식 신청 링크로 폴백
        const detail = await res.json().then((d) => d?.detail).catch(() => '')
        throw new Error(detail || (res.status === 503 ? '지금은 자동 신청이 어려워요 — 공식 신청 페이지로 진행해 주세요.' : '이 서비스는 자동 신청을 지원하지 않아요'))
      }
      const { task_id, download_token } = await res.json()
      armReturnConfirm() // 로컬 에이전트가 복지로 창을 여는 중 — 복귀 시 '신청하셨나요?' 확인으로 사후관리 진입
      rememberLive('apply', policy.id, { taskId: task_id, token: download_token || '' }) // 새로고침·뷰 이탈 복원용
      setRun((prev) => ({ status: prev?.status || 'running', step: prev?.step || '', shot: prev?.shot, at: startedAt, taskId: task_id }))
      await pollApply(task_id, download_token || '', startedAt, gen)
    } catch (e) {
      if (genRef.current === gen) setRun({ status: 'error', step: e instanceof Error ? e.message : '실패', at: startedAt })
    } finally {
      if (genRef.current === gen) runningRef.current = false
    }
  }

  // 신청 폴링 — 시작(start)과 복원(마운트 재연결)이 공유. resumed=true면 404를 조용한 정리로.
  const pollApply = async (task_id: string, download_token: string, startedAt: number, gen: number, resumed = false) => {
    // 스크린샷(정부 페이지 — PII 가능)은 시작자 토큰(?t=)이 있어야 응답에 포함된다(백엔드 게이트)
    const tq = download_token ? `?t=${encodeURIComponent(download_token)}` : ''
    let failStreak = 0
    let prevStatus = '' // 📱 인증 대기 '전이' 감지용
    // 폴링 상한을 백엔드 대기창(로그인 5분 + 검토 10분) 이상으로 — 인증이 느려도 UI가 완료 전에 멈추지 않게
    for (let i = 0; i < 800; i++) { // 최대 ~20분
      await new Promise((r) => setTimeout(r, 1500))
      if (!mountedRef.current || genRef.current !== gen) return  // 언마운트/재시작 시 폴링 종료(감사 :145)
      let st: { status?: string; current_step?: string; screenshot_b64?: string }
      try {
        const resp = await fetch(`${getRpaBase()}/api/apply/status/${task_id}${tq}`)
        if (resp.status === 404) {  // 태스크 소멸(앱 재시작 등) — 좀비 폴링 대신 정직 종료(감사 :147)
          forgetLive('apply', policy.id)
          if (!mountedRef.current || genRef.current !== gen) return
          if (resumed) setRun(null) // 복원 중 소멸 → 조용히 초기 상태로(없어진 신청을 오류로 띄우지 않음)
          else setRun({ status: 'error', step: '자동신청 세션이 끊겼어요 — 다시 시도해 주세요.', at: startedAt, taskId: task_id })
          return
        }
        if (!resp.ok) throw new Error(`status ${resp.status}`)
        st = await resp.json()
        failStreak = 0
      } catch {
        failStreak++  // 일시적 실패는 견디고(감사 :160), 연속 5회만 종료
        if (failStreak >= 5) {
          if (!mountedRef.current || genRef.current !== gen) return
          // 네트워크 문제는 태스크 소멸이 아님 — 기억은 유지해 다음 마운트에서 재연결 기회를 남긴다
          setRun({ status: 'error', step: '상태 확인이 계속 실패해요 — 네트워크를 확인하고 다시 시도해 주세요.', at: startedAt, taskId: task_id })
          return
        }
        continue
      }
      if (!mountedRef.current || genRef.current !== gen) return
      // ⚠️ at을 유지해야(감사 :106) 30초 후 '멈춘 듯' 탈출구(공식 신청/처음부터 다시)가 뜬다 — 과거엔 at 누락으로 영영 안 떴다.
      setRun({ status: st.status || 'running', step: st.current_step || st.status || '', shot: st.screenshot_b64 || undefined, at: startedAt, taskId: task_id })
      // 📱 인증 대기로 넘어가는 순간 알림음 + 탭 제목 배지 — 화면을 안 보고 있어도 폰을 집게
      if (isAuthWaitTransition(prevStatus, st.status)) { playAuthCue(); titleBadge('📱 자동신청 — 휴대폰 인증 승인 필요') }
      prevStatus = st.status || ''
      if (['done', 'error', 'completed', 'cancelled'].includes(st.status || '')) {
        forgetLive('apply', policy.id) // 종결 — 복원 대상에서 제거
        // 다른 탭에 가 있으면 탭 제목으로 알림(신청 양식 준비/확인 필요) — 돌아오면 자동 원복
        titleBadge(st.status === 'done' || st.status === 'completed' ? '✅ 신청 양식 준비됨 — 모두봄' : '⚠️ 자동신청 확인 필요 — 모두봄')
        break
      }
    }
  }


  // 진행 중 신청 자동화를 처음 상태로 — 폴링 루프를 끊고(세대 증가), 백엔드 태스크도 취소(로컬 에이전트).
  const reset = () => {
    genRef.current++            // 현재 폴링 루프 무효화(다음 틱에 스스로 빠져나감)
    runningRef.current = false  // 재시작 허용
    forgetLive('apply', policy.id) // 사용자가 처음부터 다시 — 복원 대상에서도 제거
    const tid = run?.taskId
    if (tid && canLocal) {
      fetch(`${getRpaBase()}/api/documents/rpa-cancel/${tid}`, { method: 'POST' }).catch(() => { /* 창 닫으면 자동 정리 */ })
    }
    setRun(null)
  }

  const done = run && ['done', 'error', 'completed', 'cancelled'].includes(run.status)
  // 30초 넘게 진행상태가 안 오면(새 탭에서 본인인증 대기 등) 멈춘 게 아니라는 걸 정직하게 안내
  const stale = !!(run && !done && run.at && Date.now() - run.at > 30000 && tick >= 0)

  return (
    <div className="rounded-2xl border-2 border-sprout-200 bg-sprout-50/50 p-4">
      <p className="text-sm font-bold flex items-center gap-1.5"><Bot className="h-4 w-4 text-sprout-500" /> 에이전트 자동 신청 <span className="chip-sun !py-0 text-[10px]">베타</span></p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed flex items-start gap-1">
        <ShieldCheck className="h-3.5 w-3.5 text-sprout-500 shrink-0 mt-0.5" />
        에이전트가 복지로 로그인→서비스 이동→양식 작성까지 진행해요. <b>카카오 본인인증과 최종 제출은 본인이 직접</b> 하셔야 안전해요.
      </p>

      {!run ? (
        <>
          <RpaInfoForm />
          {/* 📎 자동첨부 미리보기(데스크탑) — 시작 전 '무엇이 자동으로 붙는지' 투명하게 */}
          {canLocal && attachPreview !== null && (
            <p className="mt-2 rounded-xl border border-sprout-100 bg-white/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {attachPreview.length > 0
                ? <>📎 발급/등록해둔 <b className="text-sprout-700">{attachPreview.length}종</b>이 신청 양식에 자동첨부 후보예요: {attachPreview.slice(0, 4).join(' · ')}{attachPreview.length > 4 ? ' 외' : ''} <span>(첨부칸 이름과 맞는 것만 붙어요)</span></>
                : <>📎 자동첨부할 서류가 아직 없어요 — <b>서류 준비 도우미</b>에서 먼저 발급·촬영하면 신청 때 자동으로 붙어요.</>}
            </p>
          )}
          <button onClick={start} className="btn-primary !py-2 mt-3 text-xs"><Bot className="h-4 w-4" /> 에이전트로 신청 시작</button>
        </>
      ) : (
        <div className="mt-3">
          <p className="text-xs flex items-center gap-1.5">
            {run.status === 'error' ? <AlertCircle className="h-4 w-4 text-rose-500" /> : done ? <ShieldCheck className="h-4 w-4 text-success-500" /> : <Loader2 className="h-4 w-4 animate-spin text-sprout-500" />}
            <span className="font-medium flex-1">{run.step}</span>
            {/* 진행 중 [중단] — 멈춘 신청의 복구 수단(로컬 에이전트 취소). 30초 스테일 배너보다 먼저 쓸 수 있게. */}
            {!done && canLocal && <button onClick={reset} className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-100">⏹ 중단</button>}
          </p>
          {stale && (
            <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              진행이 잠시 멈춘 듯해요 — 확장이 연 <b>복지로 탭</b>을 확인해 주세요. 본인인증·'신청하기'처럼
              <b> 직접 눌러야 하는 단계</b>일 수 있어요(그 탭 화면의 안내를 따라주세요).
              <span className="block mt-1">
                <a href={bestApplyUrl(policy.application, policy.name, policy.id)} target="_blank" rel="noopener noreferrer" className="underline font-semibold">공식 페이지에서 직접 신청</a>
                {' · '}<button onClick={reset} className="underline font-semibold">처음부터 다시</button>
              </span>
            </div>
          )}
          {run.shot && (
            <img src={`data:image/jpeg;base64,${run.shot}`} alt="에이전트 진행 화면" className="mt-2 w-full rounded-xl border border-sprout-100" />
          )}
          {done && (run.status === 'done' || run.status === 'completed') && (
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground">브라우저 창에서 본인인증 후 내용을 확인하고 최종 제출해 주세요.</p>
              {/* 같은 창에서 제출까지 끝낸 사용자의 기록 경로 — 복귀 확인(탭 전환 감지)에만 의존하지 않게(감사 갭).
                  사용자가 직접 눌러야만 기록(자동 낙관처리 금지, 정직성). */}
              <div className="mt-2 flex flex-wrap gap-2">
                {recorded ? (
                  <span className="rounded-xl bg-success-50 border border-success-500/30 px-3 py-1.5 text-[11px] font-bold text-success-600">✅ 신청 완료로 기록했어요 — 사후관리에서 챙겨드릴게요</span>
                ) : (
                  <button
                    onClick={() => {
                      if (!isSaved(policy.id)) toggleSaved({ id: policy.id, name: policy.name, category: policy.category })
                      setStatus(policy.id, 'applied'); setRecorded(true)
                    }}
                    className="rounded-xl border-2 border-success-500/40 bg-success-50 px-3 py-1.5 text-[11px] font-bold text-success-600 hover:bg-success-50/70">
                    ✓ 제출까지 마쳤어요 — 신청 완료로 기록
                  </button>
                )}
                <button onClick={() => setView('my')} className="rounded-xl border-2 border-sprout-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-sprout-700 hover:bg-sprout-50">
                  🏠 나의 복지에서 관리
                </button>
              </div>
            </div>
          )}
          {done && run.status !== 'done' && run.status !== 'completed' && (
            /* 오류·중단 종결 — 기존엔 재시도 수단이 없어 막다른 UI였음(시작 버튼이 run 상태에 가려짐) */
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={reset} className="rounded-xl border-2 border-sprout-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-sprout-700 hover:bg-sprout-50">↻ 처음부터 다시</button>
              <a href={bestApplyUrl(policy.application, policy.name, policy.id)} target="_blank" rel="noopener noreferrer"
                className="rounded-xl border-2 border-sky2-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-sky2-700 hover:bg-sky2-50">
                공식 페이지에서 직접 신청
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
