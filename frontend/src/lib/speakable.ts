/**
 * 챗 답변 텍스트 → 음성 낭독용 정제.
 *
 * agentReply의 텍스트는 화면용 마크다운(**굵게**·글머리 •·이모지·링크 라벨)이 섞여 있어
 * 그대로 TTS에 넣으면 "별표별표 기초연금 별표별표" 같은 소음이 낭독된다.
 * 통화 상담(VoiceCall)은 이 함수로 정제한 문장만 읽는다.
 */
export function speakableText(md: string): string {
  return (md || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **굵게** → 굵게
    .replace(/^[•·▪-]\s*/gm, '') // 글머리 기호 제거
    .replace(/https?:\/\/\S+/g, '') // URL은 낭독하지 않음(화면에서 확인)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu, '') // 이모지·화살표
    .replace(/[#>`_~]/g, '')
    .replace(/\n{2,}/g, '. ') // 문단 경계 → 마침표(줄바꿈 치환을 공백 축약보다 먼저 — \s가 \n을 삼키지 않게)
    .replace(/\n/g, ', ')
    .replace(/ {2,}/g, ' ')
    .trim()
}
