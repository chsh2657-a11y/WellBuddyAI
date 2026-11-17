-- RLS 정책이 참조하는 테넌트 컨텍스트 함수.
-- withTenant() 가 트랜잭션마다 set_config('app.company_id' / 'app.user_id', ..., true) 로 값을 넣는다.
-- 한 번 설정된 커스텀 GUC 는 트랜잭션이 끝나면 NULL 이 아니라 '' 로 돌아가므로 nullif 로 처리한다.
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
