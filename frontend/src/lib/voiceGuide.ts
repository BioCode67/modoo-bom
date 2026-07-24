/**
 * 🔊 음성 사용법 안내(새싹이 가이드 투어) — 순수 데이터 + 로직.
 *
 * 왜: 첫 안내(Onboarding)와 새싹이 가이드(SproutGuide)는 전부 '글자'라, 1순위 사용자인
 * 어르신·저시력·저문해 계층이 '이 서비스가 뭔지, 어떻게 쓰는지'를 읽어야만 안다.
 * 통화 상담(VoiceCall)은 복지 Q&A라 '사용법 설명'이 아니다. → 새싹이가 사용법을 **소리로**
 * 차근차근 설명하고, 어르신은 말('다음'·'그만')이나 큰 버튼으로 넘긴다.
 *
 * 이 파일은 화면(React)과 분리된 순수 소스 — 낭독 대본과 음성 명령 해석만 담아 vitest로 잠근다.
 */

import type { View } from '@/store/useAppStore'

/** 가이드 한 단계. say는 TTS로 낭독(화면 자막도 동일 문장), view는 마무리 이동 대상(마지막 단계). */
export interface GuideStep {
  /** 안정적 식별자 */
  id: string
  /** 카드 상단 짧은 제목 */
  title: string
  /** 진행 표시용 아주 짧은 라벨(칩) */
  chip: string
  /** 소리로 읽고 자막으로도 보여줄 본문 — 이모지·마크다운 없이 '말로 자연스러운' 문장 */
  say: string
  /** 이 단계 '시작' 시 이동할 화면(마지막 단계에만 지정 — 투어를 끝내고 실제 사용으로 연결) */
  goto?: View
}

/**
 * 대본 — 발견→이해→신청→관리의 큰 흐름을 5단계로. 새싹이 1인칭·존댓말·쉬운 말.
 * (문장 안에 이모지/URL/마크다운을 넣지 않는다 — 그대로 TTS에 들어가도 소음이 없게.)
 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'intro',
    title: '안녕하세요, 새싹이예요',
    chip: '소개',
    say: '안녕하세요, 저는 복지 도우미 새싹이예요. 모두봄은 나에게 딱 맞는 복지 혜택을 찾아 드리고, 신청하고 관리하는 것까지 함께 하는 서비스예요. 지금부터 어떻게 쓰는지 소리로 하나씩 알려 드릴게요. 다음이라고 말씀하시거나, 아래 다음 버튼을 눌러 주세요.',
  },
  {
    id: 'analyze',
    title: '한마디만 하시면 찾아 드려요',
    chip: '복지 찾기',
    say: '먼저 복지 찾기예요. 나이나 형편을 편하게 한마디만 말씀하시면 돼요. 예를 들어, 일흔두 살인데 혼자 살고 소득이 적어요, 이렇게요. 그러면 제가 오천 개가 넘는 복지 중에서 받으실 수 있는 걸 골라 쉬운 말로 알려 드려요. 한국어가 아니어도 괜찮아요.',
  },
  {
    id: 'save',
    title: '마음에 들면 하트로 담기',
    chip: '담기',
    say: '찾은 복지 중에 마음에 드는 게 있으면, 하트 모양을 눌러 담아 두세요. 담아 두면 그 복지의 서류와 신청까지 제가 계속 챙겨 드려요. 급하지 않으면 여러 개를 담아 두고 천천히 보셔도 돼요.',
  },
  {
    id: 'apply',
    title: '서류와 신청도 함께',
    chip: '신청',
    say: '담아 둔 복지는 나의 복지 화면에 모여요. 거기서 필요한 서류를 발급받고 신청서까지 준비할 수 있어요. 어려운 본인 확인과 마지막 제출만 직접 해 주시면 돼요. 나머지는 제가 대신 채워 드려요.',
  },
  {
    id: 'outro',
    title: '이제 시작해 볼까요?',
    chip: '시작',
    say: '모두봄은 설치할 필요도, 회원 가입도 없어요. 알려 주신 정보는 서버로 보내지 않고 이 기기 안에서만 쓰여요. 안심하고 쓰셔도 돼요. 자, 이제 함께 복지를 찾아볼까요? 시작이라고 말씀하시거나, 아래 시작 버튼을 눌러 주세요.',
    goto: 'analyze',
  },
]

/** 음성 명령 종류 — 화면(컴포넌트)이 이 결과로 단계 이동/종료를 결정한다. */
export type GuideCommand = 'next' | 'prev' | 'repeat' | 'stop' | 'start'

// 각 명령의 트리거 표현(공백 제거·소문자 정규화 후 부분일치). 어르신의 다양한 실제 발화를 관용한다.
// 순서 주의: 더 강한 종료/반복을 앞에 둬, '다시 시작' 같은 겹침에서 의도치 않은 이동을 막는다.
const COMMAND_TRIGGERS: [GuideCommand, string[]][] = [
  ['stop', ['그만', '멈춰', '멈춤', '중지', '종료', '끝낼', '끝내', '끝날', '그만할', '닫아', '닫기', '나갈', '나가기']],
  ['repeat', ['다시', '한번더', '한번만더', '또말', '또읽', '재생', '못들었']],
  ['prev', ['이전', '뒤로', '전으로', '앞에', '되돌', '돌아가']],
  ['start', ['시작', '해볼', '찾으러', '찾아볼', '찾아줘', '고고', '레츠고']],
  ['next', ['다음', '넘겨', '넘어가', '계속', '진행', '다음이요', '다음거', '넥스트']],
]

/**
 * 발화 텍스트 → 가이드 명령. 인식 못하면 null(무시).
 * 공백 제거 + 소문자화 후 트리거 부분일치. '다음'과 '다시'는 서로 부분집합이 아니라 안전.
 */
export function matchGuideCommand(text: string): GuideCommand | null {
  const norm = (text || '').toLowerCase().replace(/\s+/g, '')
  if (!norm) return null
  for (const [cmd, triggers] of COMMAND_TRIGGERS) {
    if (triggers.some((t) => norm.includes(t))) return cmd
  }
  return null
}

/** 명령을 현재 단계에 적용해 다음 단계 인덱스를 계산. 'stop'/'start'는 종료 신호(-1)로 위임. */
export function applyGuideCommand(cmd: GuideCommand, index: number, total: number = GUIDE_STEPS.length): number {
  switch (cmd) {
    case 'next':
      // 마지막에서 '다음'은 시작(종료) 신호로 — 막다른 단계 방지
      return index >= total - 1 ? -1 : index + 1
    case 'prev':
      return Math.max(0, index - 1)
    case 'repeat':
      return index // 같은 단계 재낭독(호출부가 재생 트리거)
    case 'stop':
    case 'start':
      return -1 // 투어 종료(컴포넌트가 start면 goto로 이동)
  }
}
