CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"department_id" uuid,
	"period_no" smallint NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_line_uq" UNIQUE NULLS NOT DISTINCT("company_id","fiscal_year_id","account_id","department_id","period_no"),
	CONSTRAINT "budgets_period_ck" CHECK (period_no between 1 and 12),
	CONSTRAINT "budgets_amount_ck" CHECK (amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "budgets" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로 다른 회사의 회계연도·계정·부서를 가리키지 못하게 막는다.
CREATE OR REPLACE FUNCTION guard_budget() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM fiscal_years WHERE id = NEW.fiscal_year_id AND company_id = NEW.company_id)
       OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND company_id = NEW.company_id)
       OR (NEW.department_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM departments WHERE id = NEW.department_id AND company_id = NEW.company_id
       ))
    THEN
      RAISE EXCEPTION 'BUDGET_REFERENCE_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER budgets_guard
  BEFORE INSERT OR UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION guard_budget();
