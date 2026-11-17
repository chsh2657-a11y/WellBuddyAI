#!/usr/bin/env bash
# Docker 없이 로컬에 설치된 PostgreSQL 16 과 Redis 를 띄우고 DB·롤을 준비한다.
# (Docker 가 있으면 대신: docker compose -f infra/docker-compose.yml up -d)
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v pg_ctlcluster >/dev/null 2>&1; then
  if ! pg_lsclusters -h | awk '{print $4}' | grep -q online; then
    pg_ctlcluster 16 main start
  fi
fi
for _ in $(seq 1 30); do
  pg_isready -q -h localhost && break
  sleep 1
done
pg_isready -h localhost

if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --save '' --appendonly no >/dev/null
fi
redis-cli ping

scripts/db-setup.sh "$@"
