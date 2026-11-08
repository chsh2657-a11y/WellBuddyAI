-- 예약 수집(P2-16): 워커는 특정 회사 컨텍스트 없이 예약된 수집 설정을 찾아야 한다.
-- RLS 로는 다른 회사 행을 읽을 수 없으므로, 켜져 있고 주기가 정해진 채널의
-- 회사·채널·공급자·주기·마지막 실행 시각만 돌려주는 SECURITY DEFINER 함수를 둔다(자격증명은 주지 않음).
CREATE OR REPLACE FUNCTION scheduled_collections()
RETURNS TABLE (
  company_id uuid,
  channel text,
  provider text,
  schedule_cron text,
  last_run_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.company_id, s.channel, s.provider, s.schedule_cron, s.last_run_at
  FROM integration_settings s
  WHERE s.enabled AND s.schedule_cron IS NOT NULL
  ORDER BY s.company_id, s.channel
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION scheduled_collections() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION scheduled_collections() TO wellbuddy_app;
