#!/usr/bin/env bash
# PostgreSQL에 WellBuddy 롤과 데이터베이스를 만든다 (여러 번 실행해도 안전).
#
#   wellbuddy_owner : 테이블 소유자, 마이그레이션 실행 (DATABASE_URL_OWNER)
#   wellbuddy_app   : 앱 런타임 전용, NOBYPASSRLS + DML 권한만 (DATABASE_URL)
#
# 사용법: scripts/db-setup.sh [데이터베이스 이름...]   (기본: wellbuddy wellbuddy_test)
# 슈퍼유저 접속: PG_SUPERUSER_URL 이 있으면 사용, 없고 root 이면 로컬 postgres 계정으로 접속.
set -euo pipefail

OWNER_PASSWORD="${WELLBUDDY_OWNER_PASSWORD:-wellbuddy_owner}"
APP_PASSWORD="${WELLBUDDY_APP_PASSWORD:-wellbuddy_app}"
DATABASES=("$@")
if [ ${#DATABASES[@]} -eq 0 ]; then
  DATABASES=(wellbuddy wellbuddy_test)
fi

run_psql() {
  local db="$1"
  shift
  if [ -n "${PG_SUPERUSER_URL:-}" ]; then
    local base="${PG_SUPERUSER_URL%/*}"
    psql "${base}/${db}" -v ON_ERROR_STOP=1 -q "$@"
  elif [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- psql -d "$db" -v ON_ERROR_STOP=1 -q "$@"
  else
    psql -d "$db" -v ON_ERROR_STOP=1 -q "$@"
  fi
}

run_psql postgres \
  -v owner_pw="$OWNER_PASSWORD" -v app_pw="$APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE wellbuddy_owner LOGIN PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wellbuddy_owner') \gexec
SELECT format('CREATE ROLE wellbuddy_app LOGIN NOBYPASSRLS PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wellbuddy_app') \gexec
SQL

for db in "${DATABASES[@]}"; do
  run_psql postgres -v db="$db" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER wellbuddy_owner', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL

  run_psql "$db" -v db="$db" <<'SQL'
ALTER SCHEMA public OWNER TO wellbuddy_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wellbuddy_app;
SELECT format('GRANT CONNECT ON DATABASE %I TO wellbuddy_app', :'db') \gexec
ALTER DEFAULT PRIVILEGES FOR ROLE wellbuddy_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wellbuddy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wellbuddy_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wellbuddy_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wellbuddy_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO wellbuddy_app;
SQL
  echo "✔ database '$db' ready"
done
