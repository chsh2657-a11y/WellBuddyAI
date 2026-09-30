CREATE TABLE "asset_depreciations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "asset_depreciations_amount_ck" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "asset_depreciations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "depreciation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"entry_id" uuid,
	"total_amount" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depreciation_runs_month_ck" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "depreciation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"accumulated_account_id" uuid NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"department_id" uuid,
	"acquisition_date" date NOT NULL,
	"cost" bigint NOT NULL,
	"residual_value" bigint DEFAULT 0 NOT NULL,
	"useful_life_years" smallint NOT NULL,
	"method" text NOT NULL,
	"prior_accumulated" bigint DEFAULT 0 NOT NULL,
	"disposed_on" date,
	"disposal_proceeds" bigint,
	"disposal_entry_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_cost_ck" CHECK (cost > 0 and residual_value >= 0 and residual_value < cost),
	CONSTRAINT "fixed_assets_life_ck" CHECK (useful_life_years between 1 and 60),
	CONSTRAINT "fixed_assets_method_ck" CHECK (method in ('straight_line', 'declining_balance')),
	CONSTRAINT "fixed_assets_prior_ck" CHECK (prior_accumulated >= 0 and prior_accumulated <= cost)
);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_run_id_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulated_account_id_accounts_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_entry_id_journal_entries_id_fk" FOREIGN KEY ("disposal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depreciations_asset_month_uq" ON "asset_depreciations" USING btree ("asset_id","month");--> statement-breakpoint
CREATE INDEX "asset_depreciations_run_idx" ON "asset_depreciations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_runs_company_month_uq" ON "depreciation_runs" USING btree ("company_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_company_code_uq" ON "fixed_assets" USING btree ("company_id","code");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "asset_depreciations" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "depreciation_runs" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fixed_assets" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로, 다른 회사의 계정·부서·전표·자산을 가리키지 못하게 막는다.
CREATE OR REPLACE FUNCTION guard_fixed_asset() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (SELECT count(*) FROM accounts
          WHERE company_id = NEW.company_id
            AND id IN (NEW.asset_account_id, NEW.accumulated_account_id, NEW.expense_account_id))
       <> (SELECT count(DISTINCT x)
             FROM unnest(ARRAY[NEW.asset_account_id, NEW.accumulated_account_id, NEW.expense_account_id]) x)
    THEN
      RAISE EXCEPTION 'ASSET_ACCOUNT_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM departments WHERE id = NEW.department_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'ASSET_DEPARTMENT_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.disposal_entry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = NEW.disposal_entry_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER fixed_assets_guard
  BEFORE INSERT OR UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION guard_fixed_asset();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_depreciation_run() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = NEW.entry_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER depreciation_runs_guard
  BEFORE INSERT OR UPDATE ON depreciation_runs
  FOR EACH ROW EXECUTE FUNCTION guard_depreciation_run();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_asset_depreciation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM depreciation_runs WHERE id = NEW.run_id AND company_id = NEW.company_id
    ) OR NOT EXISTS (
      SELECT 1 FROM fixed_assets WHERE id = NEW.asset_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER asset_depreciations_guard
  BEFORE INSERT OR UPDATE ON asset_depreciations
  FOR EACH ROW EXECUTE FUNCTION guard_asset_depreciation();
