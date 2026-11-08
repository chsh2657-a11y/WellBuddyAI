# 테스트·체험용 이미지: API·워커·웹·DB 초기화가 이 이미지 하나를 명령만 바꿔 같이 쓴다.
#   docker compose up -d --build   (compose.yaml, 안내: docs/TESTING.md)
# 운영 배포용으로 줄인 이미지가 아니다(개발 의존성 포함).
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# 웹의 /api 프록시 주소(next.config.ts rewrites)는 빌드할 때 정해진다: compose 안의 API 컨테이너
ARG API_URL=http://api:4000
ENV API_URL=${API_URL}
RUN pnpm build

EXPOSE 3000 4000
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
