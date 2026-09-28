# WellBuddyAI

중소기업 경리를 위한 **자동화 회계 ERP** (웹 SaaS + 모바일 앱).

이카운트 ERP의 기본 기능(회계·영업·구매·재고·생산·인사·급여·그룹웨어)을 기준으로 하고, 다음 기능을 더한다.

- 은행·카드·홈택스 증빙 자동수집과 AI 자동분개
- 전자결재
- 급여·4대보험 자동계산
- 위치 기반 자동출근 앱

- 조사 결과 및 개발계획: [docs/development-plan.md](docs/development-plan.md)
- 개발 목표 체크리스트(진행 순서): [docs/CHECKLIST.md](docs/CHECKLIST.md)

## 로컬 개발 시작

```bash
pnpm install
cp .env.example .env

# PostgreSQL 16 · Redis 준비 (둘 중 하나)
docker compose -f infra/docker-compose.yml up -d   # Docker 사용
scripts/dev-services.sh                              # Docker 없이 로컬 설치본 사용

pnpm db:migrate   # 마이그레이션 (wellbuddy_owner 롤)
pnpm db:seed      # 데모 계정: demo@wellbuddy.local / demo1234!
pnpm test         # 단위·통합 테스트 (wellbuddy_test DB 사용)
```
