// 정부 사이트의 '인증 완료되었습니다' 같은 정보성 alert만 자동 통과(확인 자동).
// document_start + MAIN 월드로 페이지 스크립트보다 먼저 실행돼 확실히 가로챈다.
// ⚠️ 오류/경고 등 다른 alert는 그대로 보여준다(인증완료 패턴만 무음 처리). confirm은 건드리지 않음.
(function () {
  try {
    var _alert = window.alert
    window.alert = function (msg) {
      try {
        var s = String(msg == null ? '' : msg)
        if (/인증[\s]*(완료|되었)|완료되었습니다|정상적으로[\s]*처리/.test(s)) return // 자동 확인
      } catch (e) { /* noop */ }
      return _alert.apply(window, arguments)
    }
  } catch (e) { /* noop */ }
})()
