#!/usr/bin/env bash
# postgres 컨테이너 최초 기동 시 실행: WellBuddy 롤·DB 생성
set -euo pipefail
PG_SUPERUSER_URL="postgresql://${POSTGRES_USER}@/postgres" bash /opt/wellbuddy/db-setup.sh wellbuddy wellbuddy_test
