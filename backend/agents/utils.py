"""공통 유틸리티"""
import json
import re


def extract_json(text: str) -> dict:
    """
    Claude가 ```json ... ``` 마크다운으로 감싸거나 앞뒤에 설명 텍스트를
    붙여서 반환할 때도 안전하게 JSON 파싱.
    """
    # 1) 마크다운 코드블록 추출 시도
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        return json.loads(match.group(1).strip())

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
                        return json.loads(text[start:i + 1])
        break

    # 3) 최후 시도 — 전체 텍스트 파싱
    return json.loads(text)
