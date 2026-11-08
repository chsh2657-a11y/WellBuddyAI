-- 감사로그는 추가만 가능하다 (앱 롤의 수정·삭제 권한 회수).
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM wellbuddy_app;
--> statement-breakpoint

-- 초대 수락: 초대받은 사람은 아직 그 회사 구성원이 아니므로 RLS 로는 초대를 읽을 수 없다.
-- 토큰 해시를 아는 경우에만 해당 초대 1건을 돌려주는 SECURITY DEFINER 함수를 둔다.
CREATE OR REPLACE FUNCTION find_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  company_name text,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.company_id, c.name, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
  FROM invitations i
  JOIN companies c ON c.id = i.company_id
  WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION find_invitation_by_token_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION find_invitation_by_token_hash(text) TO wellbuddy_app;
