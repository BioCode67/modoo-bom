/**
 * 🔊 음성 사용법 안내(새싹이 가이드 투어) — 순수 데이터 + 로직. (다국어: ko·en·vi·zh)
 *
 * 왜: 첫 안내(Onboarding)와 새싹이 가이드(SproutGuide)는 전부 '글자'라, 1순위 사용자인
 * 어르신·저시력·저문해 계층이 '이 서비스가 뭔지, 어떻게 쓰는지'를 읽어야만 안다.
 * 통화 상담(VoiceCall)은 복지 Q&A라 '사용법 설명'이 아니다. → 새싹이가 사용법을 **소리로**
 * 차근차근 설명하고, 어르신은 말('다음'·'그만')이나 큰 버튼으로 넘긴다.
 *
 * 다국어(외국인·다문화 사각지대): 통화 상담과 같은 4개 언어(VOICE_LANGS)로 대본·조작 UI·음성
 * 명령을 제공한다. 번역 품질을 과장하지 않는다 — 여기 문구는 고정 번역이고, 실제 복지 매칭은
 * 탐색의 온디바이스 AI 의미 검색이 담당한다(voiceI18n과 동일 원칙).
 *
 * 이 파일은 화면(React)과 분리된 순수 소스 — 낭독 대본과 음성 명령 해석만 담아 vitest로 잠근다.
 */

import type { View } from '@/store/useAppStore'

/** 지원 언어 — 통화 상담(VOICE_LANGS)과 동일 집합. */
export type GuideLang = 'ko' | 'en' | 'vi' | 'zh'
export const GUIDE_LANGS: GuideLang[] = ['ko', 'en', 'vi', 'zh']

/** 가이드 한 단계(언어 반영 완료). say는 TTS로 낭독(화면 자막도 동일), goto는 마무리 이동 대상. */
export interface GuideStep {
  id: string
  title: string
  chip: string
  say: string
  goto?: View
}

// 언어 독립 메타(순서 = 대본 순서) — id·이동 대상만. 번역은 STEP_TEXT가 채운다.
const STEP_META: { id: string; goto?: View }[] = [
  { id: 'intro' },
  { id: 'analyze' },
  { id: 'save' },
  { id: 'apply' },
  { id: 'outro', goto: 'analyze' },
]

interface StepText { title: string; chip: string; say: string }

// 언어별 대본 — 발견→이해→신청→관리. 낭독문엔 이모지·마크다운·URL을 넣지 않는다(TTS 소음 방지).
const STEP_TEXT: Record<GuideLang, StepText[]> = {
  ko: [
    { title: '안녕하세요, 새싹이예요', chip: '소개',
      say: '안녕하세요, 저는 복지 도우미 새싹이예요. 모두봄은 나에게 딱 맞는 복지 혜택을 찾아 드리고, 신청하고 관리하는 것까지 함께 하는 서비스예요. 지금부터 어떻게 쓰는지 소리로 하나씩 알려 드릴게요. 다음이라고 말씀하시거나, 아래 다음 버튼을 눌러 주세요.' },
    { title: '한마디만 하시면 찾아 드려요', chip: '복지 찾기',
      say: '먼저 복지 찾기예요. 나이나 형편을 편하게 한마디만 말씀하시면 돼요. 예를 들어, 일흔두 살인데 혼자 살고 소득이 적어요, 이렇게요. 그러면 제가 오천 개가 넘는 복지 중에서 받으실 수 있는 걸 골라 쉬운 말로 알려 드려요. 한국어가 아니어도 괜찮아요.' },
    { title: '마음에 들면 하트로 담기', chip: '담기',
      say: '찾은 복지 중에 마음에 드는 게 있으면, 하트 모양을 눌러 담아 두세요. 담아 두면 그 복지의 서류와 신청까지 제가 계속 챙겨 드려요. 급하지 않으면 여러 개를 담아 두고 천천히 보셔도 돼요.' },
    { title: '서류와 신청도 함께', chip: '신청',
      say: '담아 둔 복지는 나의 복지 화면에 모여요. 거기서 필요한 서류를 발급받고 신청서까지 준비할 수 있어요. 어려운 본인 확인과 마지막 제출만 직접 해 주시면 돼요. 나머지는 제가 대신 채워 드려요.' },
    { title: '이제 시작해 볼까요?', chip: '시작',
      say: '모두봄은 설치할 필요도, 회원 가입도 없어요. 알려 주신 정보는 서버로 보내지 않고 이 기기 안에서만 쓰여요. 안심하고 쓰셔도 돼요. 자, 이제 함께 복지를 찾아볼까요? 시작이라고 말씀하시거나, 아래 시작 버튼을 눌러 주세요.' },
  ],
  en: [
    { title: "Hello, I'm Saessaki", chip: 'Intro',
      say: "Hello, I'm Saessaki, your welfare helper. Modoobom finds welfare benefits that fit you, and helps you apply and manage them. I'll explain how to use it, step by step, out loud. Say next, or tap the Next button below." },
    { title: 'Just say one sentence', chip: 'Find',
      say: "First, finding welfare. Just tell me your age or situation in one short sentence. For example: I'm seventy-two, living alone, with a low income. Then I'll pick the benefits you can receive from over five thousand programs, and explain them in plain words. It doesn't have to be Korean." },
    { title: 'Tap the heart to save', chip: 'Save',
      say: "When you see a benefit you like, tap the heart to save it. Once saved, I'll keep helping you with its documents and application. If you're not in a hurry, save several and look at them slowly." },
    { title: 'Documents and applying, together', chip: 'Apply',
      say: "Saved benefits gather in the My Welfare screen. There you can issue the documents you need and prepare the application. You only handle the tricky identity check and the final submit yourself. I fill in the rest for you." },
    { title: 'Shall we start?', chip: 'Start',
      say: "Modoobom needs no installation and no sign up. What you tell me is not sent to any server; it stays on this device. You can use it with peace of mind. Shall we go and find your benefits now? Say start, or tap the Start button below." },
  ],
  vi: [
    { title: 'Xin chào, tôi là Saessaki', chip: 'Giới thiệu',
      say: 'Xin chào, tôi là Saessaki, trợ lý phúc lợi của bạn. Modoobom tìm các phúc lợi phù hợp với bạn, và giúp bạn đăng ký cũng như quản lý. Tôi sẽ hướng dẫn cách dùng, từng bước, bằng giọng nói. Hãy nói tiếp theo, hoặc nhấn nút Tiếp bên dưới.' },
    { title: 'Chỉ cần nói một câu', chip: 'Tìm',
      say: 'Trước tiên là tìm phúc lợi. Bạn chỉ cần nói một câu ngắn về tuổi hoặc hoàn cảnh của mình. Ví dụ: Tôi bảy mươi hai tuổi, sống một mình, thu nhập thấp. Tôi sẽ chọn những phúc lợi bạn có thể nhận trong số hơn năm nghìn chương trình, và giải thích bằng lời đơn giản. Không nhất thiết phải bằng tiếng Hàn.' },
    { title: 'Nhấn trái tim để lưu', chip: 'Lưu',
      say: 'Khi thấy phúc lợi bạn thích, hãy nhấn hình trái tim để lưu lại. Sau khi lưu, tôi sẽ tiếp tục giúp bạn về giấy tờ và đăng ký. Nếu không vội, bạn có thể lưu nhiều mục và xem từ từ.' },
    { title: 'Giấy tờ và đăng ký, cùng nhau', chip: 'Đăng ký',
      say: 'Các phúc lợi đã lưu sẽ tập hợp ở màn hình Phúc lợi của tôi. Ở đó bạn có thể cấp các giấy tờ cần thiết và chuẩn bị đơn đăng ký. Bạn chỉ cần tự làm phần xác minh danh tính và bước gửi cuối cùng. Phần còn lại tôi điền giúp bạn.' },
    { title: 'Bắt đầu nhé?', chip: 'Bắt đầu',
      say: 'Modoobom không cần cài đặt và không cần đăng ký. Những gì bạn nói không được gửi đến máy chủ nào; chúng chỉ ở trên thiết bị này. Bạn có thể yên tâm sử dụng. Bây giờ chúng ta cùng đi tìm phúc lợi nhé? Hãy nói bắt đầu, hoặc nhấn nút Bắt đầu bên dưới.' },
  ],
  zh: [
    { title: '您好，我是小芽', chip: '介绍',
      say: '您好，我是福利助手小芽。모두봄会为您找到合适的福利，并帮助您申请和管理。我会用声音一步步告诉您如何使用。请说下一步，或点击下面的下一步按钮。' },
    { title: '只需一句话', chip: '查找',
      say: '首先是查找福利。您只需用一句话告诉我您的年龄或情况。比如：我七十二岁，独居，收入不高。然后我会从五千多个项目中挑出您能领取的福利，并用简单的话解释给您。不用韩语也可以。' },
    { title: '点爱心收藏', chip: '收藏',
      say: '看到喜欢的福利时，点一下爱心就能收藏。收藏后，我会继续帮您准备材料和申请。如果不着急，可以先收藏几个，慢慢看。' },
    { title: '材料和申请，一起搞定', chip: '申请',
      say: '收藏的福利会集中在我的福利页面。在那里您可以开具所需的证明材料，并准备申请表。只有较难的身份验证和最后的提交需要您亲自完成，其余的由我帮您填写。' },
    { title: '开始吧？', chip: '开始',
      say: '모두봄无需安装，也无需注册。您告诉我的信息不会发送到任何服务器，只保存在这台设备上。您可以放心使用。现在我们一起去找福利好吗？请说开始，或点击下面的开始按钮。' },
  ],
}

/** 선택 언어의 단계 목록(메타+번역 병합). 미지원 코드는 한국어로 폴백. */
export function guideSteps(lang: GuideLang = 'ko'): GuideStep[] {
  const text = STEP_TEXT[lang] || STEP_TEXT.ko
  return STEP_META.map((m, i) => ({ ...m, ...(text[i] || STEP_TEXT.ko[i]) }))
}

/** 한국어 정본(하위호환·기본값). */
export const GUIDE_STEPS: GuideStep[] = guideSteps('ko')

/** 조작 UI 문자열(언어별) — 버튼·자막 안내까지 자국어로(외국인 딥퍼널). */
export interface GuideUi {
  dialogLabel: string
  kicker: string
  step: string // "{n} / {m}" 앞에 붙는 라벨은 숫자라 생략 — 여기선 진행 접두 미사용
  replay: string
  soundOn: string
  soundOff: string
  voice: string
  listening: string
  prev: string
  next: string
  start: string
  micHint: string
  noTts: string
  noVoice: string
  close: string
  langLabel: string
}

export const GUIDE_UI: Record<GuideLang, GuideUi> = {
  ko: {
    dialogLabel: '음성 사용법 안내', kicker: '새싹이 · 소리로 듣는 사용법', step: '단계',
    replay: '다시 듣기', soundOn: '소리 켜짐', soundOff: '소리 꺼짐', voice: '말로', listening: '듣는 중…',
    prev: '이전', next: '다음', start: '복지 찾으러 가기',
    micHint: '“말로”를 누르고 “다음”·“이전”·“다시”·“그만” 이라고 하셔도 돼요.',
    noTts: '이 브라우저는 소리 안내를 지원하지 않아요 — 위 글로 안내해 드릴게요.',
    noVoice: '이 기기에 이 언어 음성이 없어 자막으로 안내해요.',
    close: '닫기', langLabel: '언어',
  },
  en: {
    dialogLabel: 'Voice guide', kicker: 'Saessaki · listen to how it works', step: 'Step',
    replay: 'Play again', soundOn: 'Sound on', soundOff: 'Sound off', voice: 'Voice', listening: 'Listening…',
    prev: 'Back', next: 'Next', start: 'Find my benefits',
    micHint: 'Tap “Voice” and say “next”, “back”, “again”, or “stop”.',
    noTts: 'This browser does not support voice — the text above will guide you.',
    noVoice: 'No voice for this language on this device — showing subtitles.',
    close: 'Close', langLabel: 'Language',
  },
  vi: {
    dialogLabel: 'Hướng dẫn bằng giọng nói', kicker: 'Saessaki · nghe cách sử dụng', step: 'Bước',
    replay: 'Nghe lại', soundOn: 'Bật tiếng', soundOff: 'Tắt tiếng', voice: 'Giọng nói', listening: 'Đang nghe…',
    prev: 'Quay lại', next: 'Tiếp', start: 'Đi tìm phúc lợi',
    micHint: 'Nhấn “Giọng nói” và nói “tiếp theo”, “quay lại”, “lặp lại” hoặc “dừng”.',
    noTts: 'Trình duyệt này không hỗ trợ giọng nói — nội dung phía trên sẽ hướng dẫn bạn.',
    noVoice: 'Thiết bị không có giọng đọc cho ngôn ngữ này — hiển thị phụ đề.',
    close: 'Đóng', langLabel: 'Ngôn ngữ',
  },
  zh: {
    dialogLabel: '语音使用说明', kicker: '小芽 · 用声音听懂怎么用', step: '步骤',
    replay: '再听一次', soundOn: '声音开', soundOff: '声音关', voice: '语音', listening: '正在听…',
    prev: '上一步', next: '下一步', start: '去找福利',
    micHint: '点击“语音”后说“下一步”“上一步”“重复”或“停止”。',
    noTts: '此浏览器不支持语音 — 请看上方文字说明。',
    noVoice: '此设备没有该语言的语音 — 改用字幕。',
    close: '关闭', langLabel: '语言',
  },
}

/** UI 문자열 — 미지원 코드는 한국어 폴백. */
export function guideUi(lang: GuideLang = 'ko'): GuideUi {
  return GUIDE_UI[lang] || GUIDE_UI.ko
}

/** 음성 명령 종류 — 화면(컴포넌트)이 이 결과로 단계 이동/종료를 결정한다. */
export type GuideCommand = 'next' | 'prev' | 'repeat' | 'stop' | 'start'

// 각 명령의 트리거 표현(공백 제거·소문자 정규화 후 부분일치). 4개 언어의 실제 발화를 관용한다.
// 순서 주의: 강한 종료/반복을 앞에 둬, '다시 시작' 같은 겹침에서 의도치 않은 이동을 막는다.
const COMMAND_TRIGGERS: [GuideCommand, string[]][] = [
  ['stop', [
    '그만', '멈춰', '멈춤', '중지', '종료', '끝낼', '끝내', '끝날', '그만할', '닫아', '닫기', '나갈', '나가기',
    'stop', 'quit', 'exit', 'cancel',
    'dừng', 'thoát', 'hủy',
    '停', '退出', '结束', '取消',
  ]],
  ['repeat', [
    '다시', '한번더', '한번만더', '또말', '또읽', '재생', '못들었',
    'again', 'repeat', 'onemore',
    'lặplại', 'nhắclại', 'nghelại',
    '再说', '重复', '再听', '再念',
  ]],
  ['prev', [
    '이전', '뒤로', '전으로', '앞에', '되돌', '돌아가',
    'back', 'previous', 'goback',
    'quaylại', 'trước', 'trướcđó',
    '上一', '返回', '后退',
  ]],
  ['start', [
    '시작', '해볼', '찾으러', '찾아볼', '찾아줘', '고고', '레츠고',
    'start', 'begin', 'letsgo', 'findmy',
    'bắtđầu', 'đithôi', 'tìmphúc',
    '开始', '出发', '去找',
  ]],
  ['next', [
    '다음', '넘겨', '넘어가', '계속', '진행', '다음이요', '다음거', '넥스트',
    'next', 'continue', 'goon', 'forward',
    'tiếptheo', 'tiếptục', 'đitiếp', 'tiếp',
    '下一', '继续', '往下', '下步',
  ]],
]

/**
 * 발화 텍스트 → 가이드 명령. 인식 못하면 null(무시).
 * 공백 제거 + 소문자화 후 트리거 부분일치. 4개 언어 트리거를 한 곳에서 판정한다
 * (선택 언어의 STT가 그 언어 단어를 돌려주므로, 언어별 분기 없이도 정확).
 */
export function matchGuideCommand(text: string): GuideCommand | null {
  // 공백과 아포스트로피 제거("let's go" → letsgo) 후 소문자 정규화(베트남어·중국어 문자는 보존)
  const norm = (text || '').toLowerCase().replace(/[\s'‘’]/g, '')
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
