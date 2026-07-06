"""공통 유틸리티"""
import json
import re


def sanitize_text(text: str) -> str:
    """lone surrogate(깨진 유니코드)를 제거해 JSON 직렬화 오류를 방지."""
    return re.sub(r"[\ud800-\udfff]", "�", text)


def safe_json_dumps(obj, **kwargs) -> str:
    """ensure_ascii=False로 직렬화하되, lone surrogate가 있으면 sanitize 후 재시도."""
    try:
        return json.dumps(obj, ensure_ascii=False, **kwargs)
    except (ValueError, UnicodeEncodeError):
        text = json.dumps(obj, ensure_ascii=True, **kwargs)
        return sanitize_text(text)


def _require_dict(obj):
    """최상위가 객체(dict)가 아니면(예: LLM이 배열 [..]만 반환) ValueError.
    → 호출부의 except가 규칙기반 폴백을 타게 해, .get() AttributeError로 분석이 죽는 걸 막는다."""
    if not isinstance(obj, dict):
        raise ValueError(f"JSON 최상위가 객체(dict)가 아님: {type(obj).__name__}")
    return obj


def extract_json(text: str) -> dict:
    """
    Claude가 ```json ... ``` 마크다운으로 감싸거나 앞뒤에 설명 텍스트를
    붙여서 반환할 때도 안전하게 JSON 파싱. 항상 dict를 반환(아니면 ValueError).
    """
    # 1) 마크다운 코드블록 추출 시도
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        return _require_dict(json.loads(match.group(1).strip()))

    # 2) 첫 번째 { ... } 또는 [ ... ] 블록 추출
    text = text.strip()
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = text.find(start_char)
        if start == -1:
            continue
        depth = 0
        in_string = False
        escape = False
        for i, ch in enumerate(text[start:], start):
            if escape:
                escape = False
                continue
            if ch == '\\' and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
            if not in_string:
                if ch == start_char:
                    depth += 1
                elif ch == end_char:
                    depth -= 1
                    if depth == 0:
                        return _require_dict(json.loads(text[start:i + 1]))
        break

    # 3) 최후 시도 — 전체 텍스트 파싱
    return _require_dict(json.loads(text))
