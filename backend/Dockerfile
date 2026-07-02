FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render 등 PaaS는 $PORT 를 주입한다(없으면 8000). shell 형태로 확장.
# RPA는 클라우드에서 자동 비활성(rpa/config.py) → 브라우저(chromium) 미설치로 이미지 경량 유지.
# 저메모리(512MB)에서는 RAG_LIGHT=1 로 BM25 검색을 써 sentence-transformers 미로드(OOM 방지).
EXPOSE 8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
