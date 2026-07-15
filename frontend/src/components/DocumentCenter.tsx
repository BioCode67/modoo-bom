import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, Bot, Loader2, CheckCircle2, AlertCircle, Check, Undo2 } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { docLink, isRpaSupported, isCertIssuable, certKind, CERT_WALLET } from '@/lib/officialLinks'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { detectExtension, issueViaExtension, issueManyViaExtension, getExtensionTrace, onExtensionStatus, sameDocName } from '@/lib/extension'
import { setPendingReturn } from '@/lib/returnPrompt'
import { RpaInfoForm } from '@/components/RpaInfoForm'
import { RemoteRpaSetup } from '@/components/RemoteRpaSetup'
import { cn } from '@/lib/utils'

// 저장 경로를 사람이 읽게 축약 — '…/모두봄서류/주민등록등본_홍길동_2026-07-15_1430.pdf'
const shortPath = (p: string) => { const seg = p.split(/[\\/]/).filter(Boolean); return seg.length > 2 ? `…/${seg.slice(-2).join('/')}` : p }

type RpaState = { status: string; step: string; at?: number; taskId?: string; saved?: boolean; downloadToken?: string; shot?: string; stepsTail?: string[]; savedPath?: string } | null

export function DocumentCenter() {
  const { tracked, profile, rpaInfo, toggleDocDone, isDocDone } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa   // RPA 가능한 로컬 에이전트
  const [ext, setExt] = useState(false)              // 크롬 확장(브라우저 내 자동화)
  const backend = localAgent || ext                  // 둘 중 하나면 자동발급 노출
  const [rpa, setRpa] = useState<Record<string, RpaState>>({})
  const [diagCopied, setDiagCopied] = useState(false)
  // '서류가 어디 저장되는지 모르겠다'(실사용 피드백) — 로컬 에이전트(내 PC)일 때만 탐색기 열기 제공
  const rpaBase = getRpaBase()
  const isLocalAgentBase = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(rpaBase)
    || (rpaBase === '' && typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))
  const [folderMsg, setFolderMsg] = useState('')
  const openFolder = async () => {
    try {
      const r = await fetch(`${getRpaBase()}/api/documents/open-folder`, { method: 'POST' }).then((x) => x.json())
      setFolderMsg(r.opened ? '' : `저장 위치: ${r.path || ''}`)
    } catch {
      setFolderMsg('폴더 열기는 데스크탑 앱에서만 돼요 — 카드에 적힌 경로에서 파일을 찾아주세요.')
    }
  }
  // 언마운트 후 폴링이 계속 setState/fetch 하지 않도록 하는 가드('나의 복지'를 떠나면 중단)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // 인증정보 폼(이 컴포넌트 소유)으로 스크롤/포커스할 때 전역 id 대신 ref로 스코프 —
  // 정책 상세 드로어의 RpaInfoForm과 id가 겹쳐 '엉뚱한 폼'으로 점프하던 것 방지.
  const rpaFormRef = useRef<HTMLDivElement>(null)

  // 확장 감지 + 진행상태 구독(확장은 서류명별 status를 푸시)
  // ⚠️ 확장은 서류명을 정규화(resolveDoc)해 보내므로 퍼지매칭으로 기존 카드 키에 연결(불일치 시 '시작 중' 멈춤 방지)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000) // 무응답 감지용 리렌더
    const off = onExtensionStatus((s) => {
      if (!s.docName) return
      setRpa((prev) => {
        // 확장은 서류명을 정규화(resolveDoc)해 보내므로, 표기가 다른 여러 카드('주민등록등본',
        // '청년 주민등록등본' 등)가 같은 정규명으로 매칭될 수 있음 → 매칭되는 카드 전부 갱신
        // (첫 카드만 갱신하면 나머지가 '대기열…'에 영구히 멈춤)
        const keys = Object.keys(prev).filter((k) => sameDocName(k, s.docName))
        const entry = { status: s.status, step: s.step, at: Date.now() }
        const targets = keys.length ? keys : [s.docName!]
        return { ...prev, ...Object.fromEntries(targets.map((k) => [k, entry])) }
      })
    })
    return () => { clearInterval(t); off() }
  }, [])

  // 담은 정책들의 필요 서류 → 어떤 복지들에 필요한지까지 집계 (공통 서류 우선 준비)
  const docNeeds = useMemo(() => {
    const map = getPolicyMap()
    const m = new Map<string, string[]>()
    tracked.forEach((t) => map[t.policyId]?.required_docs.forEach((d) => {
      const arr = m.get(d) ?? []
      const nm = map[t.policyId]?.name
      if (nm && !arr.includes(nm)) arr.push(nm)
      m.set(d, arr)
    }))
    // 여러 복지에 공통으로 필요한 서류를 위로 정렬
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [tracked])

  if (docNeeds.length === 0) return null
  // 발급 완료로 표시한 서류는 뒤로(진행 기억 — 남은 서류가 먼저 보이게, 정렬은 안정적으로 유지)
  const docs = [...docNeeds.map(([d]) => d)].sort((a, b) => Number(isDocDone(a)) - Number(isDocDone(b)))
  const needText = (doc: string) => {
    const ns = docNeeds.find(([d]) => d === doc)?.[1] ?? []
    if (ns.length === 0) return '' // 이름 없는 정책만 있을 때 'undefined에 필요' 렌더 방지
    return ns.length > 1 ? `${ns[0]} 외 ${ns.length - 1}곳에 필요` : `${ns[0]}에 필요`
  }

  const startRpa = async (doc: string) => {
    // 본인인증 자동입력엔 실명·생년월일·휴대폰이 필요 — 비어 있으면 시작 전에 안내하고
    // 사용자를 '첫 빈 칸'으로 바로 데려간다(스크롤+포커스) → 어디에 뭘 넣는지 헤매지 않게.
    if (!rpaInfo.name?.trim() || !rpaInfo.birth_date?.trim() || !rpaInfo.phone?.trim()) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '실명·생년월일·휴대폰만 넣으면 본인인증 화면까지 자동으로 채워드려요. 아래 칸에 입력해 주세요 👇 (내 기기에만 저장)', at: Date.now() } }))
      const missingIdx = !rpaInfo.name?.trim() ? 0 : !rpaInfo.birth_date?.trim() ? 1 : 2 // 이름·생년월일·휴대폰 순
      setTimeout(() => {
        const root = rpaFormRef.current // 전역 id가 아니라 '이 컴포넌트의' 폼으로 스코프
        if (!root) return
        root.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(root.querySelectorAll('input')[missingIdx] as HTMLInputElement | undefined)?.focus({ preventScroll: true })
      }, 80)
      return
    }
    setRpa((s) => ({ ...s, [doc]: { status: 'running', step: '시작 중…', at: Date.now() } }))
    // 채널 라우팅: 로컬 백엔드는 15종 지원(officialLinks.LOCAL_RPA_DOCS) — 로컬이 못 하는 서류는 확장으로(있으면), 둘 다 안 되면 정직한 안내
    const localOk = isRpaSupported(doc, 'local')
    if ((!localAgent || !localOk) && ext) {
      const r = await issueViaExtension(doc, {
        // 본인인증엔 실명(rpaInfo.name)이 필요 — 프로필 이름(데모 페르소나일 수 있음)은 폴백
        user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        auth_provider: rpaInfo.auth_provider || 'kakao', // 선택한 인증수단(PASS 등)을 확장에도 전달
      })
      if (!r.ok) setRpa((s) => ({ ...s, [doc]: { status: 'error', step: r.error || '확장이 이 서류를 지원하지 않아요.', at: Date.now() } }))
      return
    }
    if (localAgent && !localOk) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '이 서류는 로컬 에이전트가 자동발급을 지원하지 않아요 — 옆의 발급 버튼으로 공식 사이트에서 직접 발급하세요.', at: Date.now() } }))
      return
    }
    try {
      const res = await fetch(`${getRpaBase()}/api/documents/rpa-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_name: doc, user_name: rpaInfo.name || profile?.name || '사용자',
          birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
          sido: rpaInfo.sido, sigungu: rpaInfo.sigungu,
          auth_provider: rpaInfo.auth_provider || 'kakao', // 어르신은 통신사 PASS가 많음
        }),
      })
      if (!res.ok) {
        // 503(이용자 많음/RPA 비활성)은 서버의 안내 문구를 그대로 — 옆의 '전자발급' 링크로 폴백하면 됨
        const detail = await res.json().then((d) => d?.detail).catch(() => '')
        throw new Error(detail || (res.status === 503 ? '지금은 자동 발급이 어려워요 — 옆의 전자발급으로 진행해 주세요.' : '지원하지 않는 서류'))
      }
      const issued = await res.json()
      const task_id = issued.task_id
      const downloadToken = issued.download_token || ''  // 시작자에게만 반환되는 다운로드 인가 토큰
      // ⚠️ 폴링 상한을 백엔드 대기창(로그인 8분·전자서명 대기 등) 이상으로 — 어르신 본인인증이 90초를
      //    넘겨도 UI가 완료 전에 멈추지 않게(과거 60회=90초라 인증이 느리면 발급돼도 '진행 중'에 영구 정지, 감사 확정).
      for (let i = 0; i < 1200; i++) { // 최대 ~30분
        await new Promise((r) => setTimeout(r, 1500))
        if (!mountedRef.current) return // 뷰를 떠나면 폴링 중단(언마운트 후 setState/fetch 방지)
        // ?t= 토큰: 스크린샷 포함 응답 인가(백엔드 게이트) — 시작자만 진행 화면을 볼 수 있게
        const st = await fetch(`${getRpaBase()}/api/documents/rpa-status/${task_id}${downloadToken ? `?t=${encodeURIComponent(downloadToken)}` : ''}`).then((r) => r.json())
        if (!mountedRef.current) return
        // 발급 완료 시 result.saved_path가 있으면 문서를 사용자에게 돌려줄 수 있음(다운로드 버튼 노출)
        setRpa((s) => ({ ...s, [doc]: {
          status: st.status, step: st.current_step || '', at: s[doc]?.at, taskId: task_id, downloadToken,
          saved: !!(st.result && st.result.saved_path),
          savedPath: (st.result && st.result.saved_path) || undefined,
          // 진행 실화면(토큰 인가 시 응답에 포함) + 최근 단계 로그 — '멈춘 것처럼 보임' 해소(실사용 피드백)
          shot: st.screenshot_b64 || undefined,
          stepsTail: Array.isArray(st.steps) ? st.steps.slice(-3).map((x: { time?: string; msg?: string }) => `${x.time || ''} ${String(x.msg || '').split('\n')[0]}`.trim()) : undefined,
        } }))
        if (st.status === 'done' || st.status === 'error' || st.status === 'completed') break
      }
    } catch (e) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: e instanceof Error ? e.message : '실패' } }))
    }
  }

  // 🚀 연쇄 자동발급 — 지원 서류 전부를 한 흐름으로(정부24는 한 번 로그인으로 이어짐)
  // 이미 '발급 완료'로 표시한 서류는 재발급 대상에서 제외.
  const rpaDocs = docs.filter((d) => isRpaSupported(d) && !isDocDone(d))
  // 로컬 백엔드(데스크탑앱)가 실제로 발급 가능한 서류만 — 로컬 여정에 넣을 대상(확장은 rpaDocs 전체)
  const rpaDocsLocal = rpaDocs.filter((d) => isRpaSupported(d, 'local'))
  // 연쇄 발급 대상: 확장 있으면 전체(13종), 없고 로컬 에이전트면 로컬 지원분(15종)
  const chainDocs = ext ? rpaDocs : rpaDocsLocal
  const certAll = docs.filter((d) => isCertIssuable(d)) // 무설치 전자발급(전자증명서) 가능 서류
  const certDocs = certAll.filter((d) => !isDocDone(d)) // 그중 아직 발급 안 한 서류 — 배너 CTA가 순서대로 안내

  // 무설치 전자발급 시작 — 새 탭은 <a>가 사용자 제스처 안에서 직접 열고, 여기선
  // ① 폼 첫 칸에 붙여넣을 이름을 클립보드에 준비 ② 복귀 시 '발급하셨나요?' 확인 대기만 건다
  const openIssue = (doc: string) => {
    setPendingReturn({ kind: 'doc', doc })
    const nm = (rpaInfo.name || profile?.name || '').trim()
    if (nm) navigator.clipboard?.writeText(nm).catch(() => { /* 미지원 환경 무시 */ })
  }
  // 로컬 백엔드(데스크탑앱) 연쇄 발급 — 한 번 카카오 인증으로 서류들을 순차 발급(orchestrator journey).
  const runJourneyViaBackend = async (docList: string[]) => {
    const res = await fetch(`${getRpaBase()}/api/journey/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_names: docList, user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        auth_provider: rpaInfo.auth_provider || 'kakao',
        sido: rpaInfo.sido, sigungu: rpaInfo.sigungu, // 연쇄발급에서도 주민등록 주소 자동정정
      }),
    })
    if (!res.ok) {
      const detail = await res.json().then((d) => d?.detail).catch(() => '')
      throw new Error(detail || '연쇄 발급을 시작하지 못했어요.')
    }
    const started = await res.json()
    const journey_id = started.journey_id
    const jtok = started.download_token || ''  // 스크린샷/경로 열람 인가 토큰(시작자에게만)
    // 지원목록 밖 서류는 여정에서 제외되므로, 서버가 실제로 받은 서류만 추적한다(나머지 카드가 스피너로 영구고정되지 않게).
    const accepted: string[] = Array.isArray(started.docs) ? started.docs : docList
    const dropped = docList.filter((d) => !accepted.includes(d))
    if (dropped.length) {
      setRpa((s) => ({ ...s, ...Object.fromEntries(dropped.map((d) => [d, { status: 'error', step: '이 서류는 자동발급 대상이 아니에요 — 옆의 발급 버튼으로 진행해 주세요.', at: Date.now() }])) }))
    }
    const tq = jtok ? `?t=${encodeURIComponent(jtok)}` : ''
    // 폴링 상한을 백엔드 대기창 이상으로 — 각 서류 인증이 느려도 UI가 완료 전에 멈추지 않게(스텝당 최대 30분/여정)
    for (let i = 0; i < 1400; i++) { // 최대 ~35분(다서류 순차 발급 + 각 인증 대기)
      await new Promise((r) => setTimeout(r, 1500))
      if (!mountedRef.current) return
      const j = await fetch(`${getRpaBase()}/api/journey/status/${journey_id}${tq}`).then((r) => r.json())
      setRpa((s) => {
        const next = { ...s }
        for (const step of (j.steps || [])) {
          const isCur = j.current === step.name
          const msg = isCur && j.current_message ? j.current_message
            : step.status === 'running' ? '진행 중…'
            // 실발급 신호(saved_path)가 있어야 '발급 완료' — 없으면 완료로 오보하지 않음(감사 확정 정직성, 아이콘 amber와 동일 기준)
            : (step.status === 'done' || step.status === 'completed')
              ? (step.saved_path ? '발급 완료' : '발급 미완료 — 화면에서 확인해 주세요')
            : step.status === 'error' ? (step.error || '실패') : '대기 중…'
          // 발급 완료 단계는 taskId+토큰을 실어 '발급 문서 받기' 버튼이 뜨게(서버 RPA/원격에서 PDF 회수)
          next[step.name] = { status: step.status, step: msg, at: s[step.name]?.at, saved: !!step.saved_path, savedPath: step.saved_path || undefined, taskId: step.task_id, downloadToken: step.download_token }
        }
        return next
      })
      if (j.status === 'completed' || j.status === 'error') break
    }
  }

  const startAll = async () => {
    if (!rpaInfo.name?.trim() || !rpaInfo.birth_date?.trim() || !rpaInfo.phone?.trim()) {
      setRpa((s) => ({ ...s, [chainDocs[0]]: { status: 'error', step: '아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요.', at: Date.now() } }))
      return
    }
    const userInfo = {
      user_name: rpaInfo.name || profile?.name || '사용자',
      birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
      auth_provider: rpaInfo.auth_provider || 'kakao', // 확장 연쇄발급에도 인증수단 전달
    }
    setRpa((s) => ({ ...s, ...Object.fromEntries(chainDocs.map((d) => [d, { status: 'running', step: '대기열에 추가됨…', at: Date.now() }])) }))
    // 로컬 에이전트(데스크탑앱) 우선 — 확장이 없거나 로컬만 있을 때 백엔드 여정으로 연쇄 발급.
    if (localAgent && !ext) {
      try {
        await runJourneyViaBackend(chainDocs)
      } catch (e) {
        setRpa((s) => ({ ...s, [chainDocs[0]]: { status: 'error', step: e instanceof Error ? e.message : '연쇄 발급 실패', at: Date.now() } }))
      }
      return
    }
    const r = await issueManyViaExtension(rpaDocs, userInfo)
    if (!r.ok) { setRpa((s) => ({ ...s, [rpaDocs[0]]: { status: 'error', step: r.error || '연쇄 발급을 시작하지 못했어요.', at: Date.now() } })); return }
    // 확장이 표기변형을 정규화·디듑해 실제 큐에 들어간 목록(r.docs)만 진행 대상 — 나머지 카드는
    // 중복(같은 서류)이므로 '동일 서류로 함께 발급됨'으로 표시(영구 '대기열…' 방지)
    if (r.docs && r.docs.length) {
      setRpa((s) => {
        const next = { ...s }
        for (const d of rpaDocs) {
          if (!r.docs!.some((rd) => sameDocName(rd, d))) next[d] = { status: 'running', step: '같은 서류로 함께 발급돼요…', at: Date.now() }
        }
        return next
      })
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2"><FileText className="h-5 w-5 text-sky2-500" /> 서류 준비 도우미</h2>
        {backend ? (
          <span className="chip-sprout"><Bot className="h-3.5 w-3.5" /> 자동발급 가능</span>
        ) : certDocs.length > 0 ? (
          <span className="chip-sprout">📄 무설치 전자발급</span>
        ) : (
          <span className="chip-sky">공식 사이트 바로가기</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        담은 복지에 필요한 서류 {docs.length}종이에요. {backend ? '에이전트로 자동 발급하거나 발급처로 바로 이동하세요.' : '설치 없이 전자증명서로 발급하거나 발급처로 바로 이동하세요.'}
        {backend && <span className="block mt-0.5 text-xs">🔒 카카오 본인인증은 보안을 위해 본인이 직접 진행해요.</span>}
      </p>

      {/* ⭐ 무설치 전자발급(전자증명서) — 권장 기본 경로. 확장·서버 없이 정부 공식 유통망으로 발급·제출.
          CTA는 남은 첫 서류의 민원 딥링크로 직결 — 발급 후 돌아와 완료 표시하면 다음 서류를 이어서 안내
          (정부24 로그인 세션이 유지되므로 확장의 '한 번 인증으로 이어서'를 무설치로 재현). */}
      {!ext && certDocs.length > 0 && (
        <div className="mt-3 rounded-2xl border-2 border-sprout-200 bg-gradient-to-br from-sprout-50 to-emerald-50 p-3.5">
          <p className="text-sm font-extrabold flex items-center gap-1.5">📄 설치 없이 <span className="gradient-text">전자증명서</span>로 발급하기 <span className="chip-sprout !py-0.5 text-[10px]">권장</span></p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            남은 <b>{certDocs.length}종</b>{certAll.length > certDocs.length && <> (총 {certAll.length}종 중 {certAll.length - certDocs.length}종 발급 완료)</>}은
            프로그램 설치 없이 정부24·건보공단 등 <b>공식 사이트에서 전자문서로 바로</b> 발급돼요.
            정부24 발급 화면이라면 <b>'수령방법'에서 [전자문서지갑]을 선택</b> — 복지로·주민센터에 <b>종이 없이 전자제출</b>까지 돼요(정부 공식 방식).
            <b> 본인인증만 직접</b> 하시면 됩니다 · 🔒 개인정보는 서버로 안 나가요.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={docLink(certDocs[0]).url} target="_blank" rel="noopener noreferrer"
              onClick={() => openIssue(certDocs[0])}
              className="btn-primary !px-3 !py-2 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 지금 「{certDocs[0]}」 전자발급 시작
            </a>
            {certDocs.length > 1 && (
              <span className="text-[11px] text-muted-foreground">
                발급 후 돌아오면 다음 서류를 이어서 안내해요(같은 사이트 서류는 한 번 로그인으로 이어져요)
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <a href={CERT_WALLET.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground/80 hover:underline">
              전자문서지갑이 뭔가요? →
            </a>
            <a
              href="https://github.com/BioCode67/modoo-bom/tree/main/extension#설치-개발자-모드--데모"
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground/80 hover:underline"
            >
              고급: 크롬 확장으로 자동화도 가능해요 →
            </a>
          </div>
        </div>
      )}
      {/* 백엔드(로컬 에이전트·확장·옵트인 원격 서버)가 없을 때만: 설치 없이 '내 서버'로 자동발급 옵트인(고급) */}
      {!backend && <div className="mt-3"><RemoteRpaSetup /></div>}
      {backend && <div ref={rpaFormRef}><RpaInfoForm /></div>}
      {/* 옵트인 원격 서버로 연결된 경우: 내 정보가 서버를 거친다는 안내 유지(정직성) */}
      {localAgent && caps?.rpaRemote && (
        <p className="mt-2 text-xs text-amber-700">🔒 내 서버로 자동발급 중 — 이름·생년월일·연락처가 지정 서버를 거쳐요(본인인증은 내 폰에서).</p>
      )}

      {/* 🚀 연쇄 자동발급 — 확장이 있고 지원 서류가 2개 이상일 때 */}
      {/* 연쇄 자동발급 — 확장(전체) 또는 로컬 에이전트(데스크탑앱, 로컬 지원분)로 한 번 인증에 이어서 발급 */}
      {(ext || localAgent) && chainDocs.length > 1 && (
        <button onClick={startAll} className="btn-primary w-full mt-3 !py-2.5 text-sm">
          🚀 필요한 서류 {chainDocs.length}종 전부 자동발급 (한 번 인증으로 이어서)
        </button>
      )}

      {/* 🔍 진단 복사 — 발급이 멈추거나 오류일 때만 노출(완료는 제외 — 성공 후에도 뜨면 오해) */}
      {ext && Object.values(rpa).some((s) => s && (s.status === 'error' || (!['done', 'completed'].includes(s.status) && s.at && Date.now() - s.at > 30000))) && (
        <button
          onClick={async () => {
            const t = await getExtensionTrace()
            if (t) { try { await navigator.clipboard.writeText(t); setDiagCopied(true); setTimeout(() => setDiagCopied(false), 3000) } catch { /* noop */ } }
          }}
          className="btn-secondary w-full mt-2 !py-2 text-xs"
        >
          {diagCopied ? '✅ 진단이 복사됐어요 — 개발자에게 붙여넣어 주세요' : '🔍 진단 복사 (발급이 안 될 때 눌러 신고)'}
        </button>
      )}

      {folderMsg && <p className="mt-2 text-xs text-amber-700">{folderMsg}</p>}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((doc) => {
          const link = docLink(doc)
          // 확장 있으면 13종, 로컬 백엔드만이면 로컬 지원 15종만 '자동' 표시(과대 표시 시 클릭 오류 — 감사 실측)
          const supported = ext ? isRpaSupported(doc) : isRpaSupported(doc, 'local')
          const kind = certKind(doc) // 'wallet'=전자증명서(지갑 유통) · 'online'=온라인 발급 · undefined=오프라인/본인준비
          const done = isDocDone(doc)
          const st = rpa[doc]
          // 30초 넘게 진행상태가 안 오면(새 탭에서 사용자 조작 대기 등) 웹에서도 정직하게 안내
          const stale = !!(st && !['done', 'completed', 'error'].includes(st.status) && st.at && Date.now() - st.at > 30000 && tick >= 0)
          return (
            <div key={doc} className={cn('card-cute p-4 flex items-center gap-3', done && 'opacity-75')}>
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', done ? 'bg-success-50 text-success-500' : 'bg-sky2-100 text-sky2-700')}>
                {done ? <CheckCircle2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('font-bold text-sm truncate', done && 'line-through decoration-success-500/60')}>{doc}</p>
                {done ? (
                  <p className="text-xs text-success-600 font-semibold">발급 완료로 표시했어요</p>
                ) : st ? (
                  <>
                  {/* 자동발급 진행/완료/오류를 스크린리더가 즉시 읽도록 라이브 영역으로 */}
                  <p className="text-xs flex items-center gap-1 mt-0.5" role="status" aria-live="polite">
                    {st.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      // 발급까지 진행됐지만 문서 저장을 확정 못 한 'done'(saved 없음)은 초록 성공이 아니라 주의(amber)로 — 과장 방지
                      : (st.status === 'done' || st.status === 'completed') && !st.saved ? <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      : st.status === 'done' || st.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                      : <Loader2 className="h-3.5 w-3.5 animate-spin text-sky2-500" />}
                    <span className="text-muted-foreground truncate">{st.step || st.status}</span>
                  </p>
                  {/* 최근 단계 로그 — 지금까지 무엇을 했는지 한눈에(진행상황 불투명 피드백) */}
                  {st.stepsTail && st.stepsTail.length > 1 && !['done', 'completed'].includes(st.status) && (
                    <ul className="mt-1 space-y-0.5">
                      {st.stepsTail.slice(0, -1).map((line, li) => (
                        <li key={li} className="text-[10px] text-muted-foreground/70 truncate">· {line}</li>
                      ))}
                    </ul>
                  )}
                  {/* 진행 실화면(토큰 인가) — 에이전트가 지금 보고 있는 정부 페이지를 그대로(멈춤 오인 해소) */}
                  {st.shot && !['done', 'completed', 'error'].includes(st.status) && (
                    <img src={`data:image/jpeg;base64,${st.shot}`} alt="발급 진행 화면"
                      className="mt-1.5 w-full max-h-44 object-cover object-top rounded-lg border border-sprout-100" />
                  )}
                  {/* 발급 완료 + 서버에 문서 저장됨 → 내 브라우저로 바로 받기(확장 없이 인증만 하면 내 손에). 토큰(?t=)으로 인가 */}
                  {(st.status === 'done' || st.status === 'completed') && st.saved && st.taskId && st.downloadToken && (
                    <a
                      href={`${getRpaBase()}/api/documents/rpa-file/${st.taskId}?t=${encodeURIComponent(st.downloadToken)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="btn-primary !px-3 !py-1.5 mt-1.5 text-xs inline-flex"
                    >
                      <FileText className="h-3.5 w-3.5" /> 발급 문서 받기 (PDF)
                    </a>
                  )}
                  {/* 어디 저장됐는지 명시 — 파일명까지(알기 쉬운 이름: 서류명_이름_날짜) */}
                  {(st.status === 'done' || st.status === 'completed') && st.savedPath && (
                    <p className="mt-1.5 rounded-lg bg-sprout-50 px-2 py-1.5 text-[11px] leading-relaxed text-sprout-800 break-all">
                      🗂 <b>{shortPath(st.savedPath)}</b>
                      {isLocalAgentBase && (
                        <button onClick={openFolder} className="ml-1.5 underline font-semibold shrink-0">저장 폴더 열기</button>
                      )}
                    </p>
                  )}
                  {stale && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {ext
                        ? <>진행이 잠시 멈춘 듯해요 — 확장이 연 <b>정부 사이트 탭</b>을 확인해 주세요(본인인증 등 직접 눌러야 하는 단계일 수 있어요). 안 되면 </>
                        : <>자동발급이 지연되고 있어요. 안 되면 </>}
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">공식 사이트에서 직접 발급</a>하세요.
                    </p>
                  )}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-sprout-700 font-semibold truncate">{needText(doc)}</p>
                    <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                      {kind === 'wallet' && <span className="chip-sprout !py-0 !px-1.5 text-[9px] shrink-0">무설치 전자발급</span>}
                      {kind === 'online' && <span className="chip-sky !py-0 !px-1.5 text-[9px] shrink-0">온라인 발급</span>}
                      <span className="truncate">{link.label}</span>
                    </p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5 items-center">
                {!done && backend && supported && (
                  <button onClick={() => startRpa(doc)} disabled={st?.status === 'running'} className="btn-primary !px-3 !py-2 text-xs">
                    <Bot className="h-4 w-4" /> 자동
                  </button>
                )}
                {/* 전자증명서 발급 가능한 서류는 '전자발급'으로 강조(무설치 기본 경로) —
                    클릭 시 이름 클립보드 준비 + 복귀 확인 대기(발급 완료를 앱이 기억하게) */}
                {/* '본인 준비/지참' 서류는 발급처가 없다 — 포털 홈으로 보내는 가짜 '발급' 버튼 대신 정직한 칩(감사 확정) */}
                {!done && /본인 (준비|지참)/.test(link.label) ? (
                  <span className="rounded-xl border-2 border-sprout-100 bg-sprout-50/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    본인 준비물
                  </span>
                ) : !done && (
                  <a
                    href={link.url} target="_blank" rel="noopener noreferrer"
                    onClick={kind ? () => openIssue(doc) : undefined}
                    className={kind === 'wallet' && !backend ? 'btn-primary !px-3 !py-2 text-xs' : 'btn-secondary !px-3 !py-2 text-xs'}
                  >
                    <ExternalLink className="h-4 w-4" /> {kind === 'wallet' ? '전자발급' : '발급'}
                  </a>
                )}
                <button
                  onClick={() => toggleDocDone(doc)}
                  aria-pressed={done}
                  aria-label={done ? `${doc} 발급 완료 표시 취소` : `${doc} 발급 완료로 표시`}
                  title={done ? '완료 표시 취소' : '발급 완료로 표시'}
                  className={cn('rounded-xl border-2 p-2 transition-colors',
                    done ? 'border-success-500/40 bg-success-50 text-success-600 hover:bg-success-50/60' : 'border-sprout-100 bg-white text-muted-foreground hover:border-sprout-300 hover:text-sprout-700')}
                >
                  {done ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
