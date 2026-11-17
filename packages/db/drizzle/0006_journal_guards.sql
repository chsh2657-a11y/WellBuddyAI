-- 전표 무결성 규칙을 DB 에서도 한 번 더 지킨다(서비스 코드가 1차 방어, 트리거가 2차 방어).
--  1) 차변 합계 = 대변 합계 = 전표 합계, 줄은 2개 이상 (커밋 시점에 검사)
--  2) 전기(posted)·역분개(reversed)된 전표는 고칠 수 없다. 허용되는 변경은 posted → reversed 전환뿐.
--     기초잔액 전표(type = 'opening')는 전기이월로 다시 계산하므로 예외.
--  3) 마감된 회계기간에는 전표를 추가·수정·삭제할 수 없다.
--  4) 줄은 같은 회사의 전표·계정에만 붙일 수 있다(외래키 검사는 RLS 를 거치지 않으므로 직접 확인).
-- 회사 삭제처럼 다른 트리거(외래키 CASCADE) 안에서 일어나는 삭제는 검사하지 않는다(pg_trigger_depth() > 1).

CREATE OR REPLACE FUNCTION journal_period_locked(p_company_id uuid, p_date date) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM accounting_periods
      WHERE company_id = p_company_id AND is_locked AND p_date BETWEEN start_date AND end_date
    )
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION assert_journal_balanced(p_entry_id uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_total bigint;
    v_count integer;
    v_debit bigint;
    v_credit bigint;
  BEGIN
    SELECT total_amount INTO v_total FROM journal_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
      RETURN; -- 전표가 함께 삭제됨
    END IF;
    SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      INTO v_count, v_debit, v_credit
      FROM journal_lines WHERE entry_id = p_entry_id;
    IF v_count < 2 OR v_debit <> v_credit OR v_debit <> v_total THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED: entry % (lines %, debit %, credit %, total %)',
        p_entry_id, v_count, v_debit, v_credit, v_total
        USING ERRCODE = 'check_violation';
    END IF;
  END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_journal_balance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_TABLE_NAME = 'journal_entries' THEN
      PERFORM assert_journal_balanced(NEW.id);
    ELSE
      IF TG_OP <> 'INSERT' THEN
        PERFORM assert_journal_balanced(OLD.entry_id);
      END IF;
      IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN
        PERFORM assert_journal_balanced(NEW.entry_id);
      END IF;
    END IF;
    RETURN NULL;
  END
  $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_entries_balance_ck
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_lines_balance_ck
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_journal_entry() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    n journal_entries;
    v_reversing boolean := false;
  BEGIN
    IF pg_trigger_depth() > 1 THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'reversed' THEN
      -- posted → reversed 전환: 상태·역분개 연결·수정자 외에는 바뀌면 안 된다
      n := NEW;
      n.status := OLD.status;
      n.reversed_by_id := OLD.reversed_by_id;
      n.updated_at := OLD.updated_at;
      n.updated_by := OLD.updated_by;
      v_reversing := n IS NOT DISTINCT FROM OLD AND NEW.reversed_by_id IS NOT NULL;
    END IF;

    IF TG_OP <> 'INSERT' AND OLD.status IN ('posted', 'reversed') AND OLD.type <> 'opening'
       AND NOT v_reversing THEN
      RAISE EXCEPTION 'JOURNAL_POSTED_IMMUTABLE: entry %', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_reversing THEN
      IF TG_OP <> 'INSERT' AND journal_period_locked(OLD.company_id, OLD.entry_date) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: %', OLD.entry_date USING ERRCODE = 'check_violation';
      END IF;
      IF TG_OP <> 'DELETE' AND journal_period_locked(NEW.company_id, NEW.entry_date) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: %', NEW.entry_date USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM fiscal_years
      WHERE id = NEW.fiscal_year_id AND company_id = NEW.company_id
        AND NEW.entry_date BETWEEN start_date AND end_date
    ) THEN
      RAISE EXCEPTION 'JOURNAL_FISCAL_YEAR_MISMATCH: %', NEW.entry_date
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER journal_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_journal_entry();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_journal_line() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    e record;
    r journal_lines;
  BEGIN
    IF pg_trigger_depth() > 1 THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    FOREACH r IN ARRAY (
      CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW] WHEN 'DELETE' THEN ARRAY[OLD] ELSE ARRAY[OLD, NEW] END
    ) LOOP
      SELECT company_id, status, type, entry_date INTO e FROM journal_entries WHERE id = r.entry_id;
      IF NOT FOUND OR e.company_id <> r.company_id THEN
        RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND: %', r.entry_id USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF e.status IN ('posted', 'reversed') AND e.type <> 'opening' THEN
        RAISE EXCEPTION 'JOURNAL_POSTED_IMMUTABLE: entry %', r.entry_id
          USING ERRCODE = 'check_violation';
      END IF;
      IF journal_period_locked(e.company_id, e.entry_date) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: %', e.entry_date USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM accounts WHERE id = NEW.account_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'JOURNAL_ACCOUNT_NOT_FOUND: %', NEW.account_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER journal_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION guard_journal_line();
