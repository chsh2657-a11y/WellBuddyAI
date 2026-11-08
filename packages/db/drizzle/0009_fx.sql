CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_currency_ck" CHECK (currency ~ '^[A-Z]{3}$' and currency <> 'KRW'),
	CONSTRAINT "exchange_rates_rate_ck" CHECK (rate > 0)
);
--> statement-breakpoint
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fx_revaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"revaluation_date" date NOT NULL,
	"entry_id" uuid,
	"gain" bigint DEFAULT 0 NOT NULL,
	"loss" bigint DEFAULT 0 NOT NULL,
	"details" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_revaluations_amount_ck" CHECK (gain >= 0 and loss >= 0)
);
--> statement-breakpoint
ALTER TABLE "fx_revaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "foreign_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "exchange_rate" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_revaluations" ADD CONSTRAINT "fx_revaluations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_revaluations" ADD CONSTRAINT "fx_revaluations_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_revaluations" ADD CONSTRAINT "fx_revaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_company_currency_date_uq" ON "exchange_rates" USING btree ("company_id","currency","rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_revaluations_company_date_uq" ON "fx_revaluations" USING btree ("company_id","revaluation_date");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_foreign_ck" CHECK ((currency is null) = (foreign_amount is null) and (exchange_rate is null or currency is not null) and (currency is null or currency ~ '^[A-Z]{3}$') and (exchange_rate is null or exchange_rate > 0));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "exchange_rates" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fx_revaluations" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로 다른 회사의 전표를 가리키지 못하게 막는다.
CREATE OR REPLACE FUNCTION guard_fx_revaluation() RETURNS trigger
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

CREATE TRIGGER fx_revaluations_guard
  BEFORE INSERT OR UPDATE ON fx_revaluations
  FOR EACH ROW EXECUTE FUNCTION guard_fx_revaluation();
