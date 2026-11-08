CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"alias" text NOT NULL,
	"account_no_enc" text NOT NULL,
	"account_no_masked" text NOT NULL,
	"account_no_index" text NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"tx_date" date NOT NULL,
	"tx_time" time,
	"description" text NOT NULL,
	"counterparty" text,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"withdrawal" bigint DEFAULT 0 NOT NULL,
	"balance" bigint,
	"memo" text,
	"source" text NOT NULL,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"collection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_amount_ck" CHECK (deposit >= 0 and withdrawal >= 0 and ((deposit > 0) <> (withdrawal > 0))),
	CONSTRAINT "bank_transactions_status_ck" CHECK (status in ('pending', 'review', 'posted', 'ignored', 'matched'))
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"approved_date" date NOT NULL,
	"approved_time" time,
	"merchant_name" text NOT NULL,
	"merchant_biz_no" text,
	"amount" bigint NOT NULL,
	"vat_amount" bigint,
	"approval_no" text NOT NULL,
	"installment_months" integer,
	"cancelled" boolean DEFAULT false NOT NULL,
	"category" text,
	"source" text NOT NULL,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"collection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_transactions_amount_ck" CHECK (amount > 0),
	CONSTRAINT "card_transactions_status_ck" CHECK (status in ('pending', 'review', 'posted', 'ignored', 'matched'))
);
--> statement-breakpoint
ALTER TABLE "card_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"tx_date" date NOT NULL,
	"approval_no" text NOT NULL,
	"biz_no" text,
	"name" text NOT NULL,
	"supply_amount" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"total_amount" bigint NOT NULL,
	"usage" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"partner_id" uuid,
	"source" text NOT NULL,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"collection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_receipts_direction_ck" CHECK (direction in ('sales', 'purchase')),
	CONSTRAINT "cash_receipts_status_ck" CHECK (status in ('pending', 'review', 'posted', 'ignored', 'matched'))
);
--> statement-breakpoint
ALTER TABLE "cash_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "collection_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "corporate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"card_company" text NOT NULL,
	"alias" text NOT NULL,
	"card_no_enc" text NOT NULL,
	"card_no_masked" text NOT NULL,
	"card_no_index" text NOT NULL,
	"holder_name" text,
	"ledger_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporate_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"file_id" uuid,
	"tx_date" date,
	"merchant_name" text,
	"biz_no" text,
	"total_amount" bigint,
	"vat_amount" bigint,
	"ocr_provider" text,
	"ocr_result" jsonb,
	"confidence" real,
	"biz_no_status" text,
	"card_transaction_id" uuid,
	"uploaded_by" uuid,
	"source" text NOT NULL,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"collection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_status_ck" CHECK (status in ('pending', 'review', 'posted', 'ignored', 'matched'))
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"approval_no" text NOT NULL,
	"issue_date" date NOT NULL,
	"supplier_biz_no" text NOT NULL,
	"supplier_name" text NOT NULL,
	"buyer_biz_no" text NOT NULL,
	"buyer_name" text NOT NULL,
	"supply_amount" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"total_amount" bigint NOT NULL,
	"item_summary" text,
	"partner_id" uuid,
	"source" text NOT NULL,
	"dedupe_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"collection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_invoices_direction_ck" CHECK (direction in ('sales', 'purchase')),
	CONSTRAINT "tax_invoices_kind_ck" CHECK (kind in ('tax', 'zero', 'exempt')),
	CONSTRAINT "tax_invoices_amount_ck" CHECK (total_amount = supply_amount + vat_amount),
	CONSTRAINT "tax_invoices_status_ck" CHECK (status in ('pending', 'review', 'posted', 'ignored', 'matched'))
);
--> statement-breakpoint
ALTER TABLE "tax_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_card_id_corporate_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."corporate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_cards" ADD CONSTRAINT "corporate_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_cards" ADD CONSTRAINT "corporate_cards_ledger_account_id_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_card_transaction_id_card_transactions_id_fk" FOREIGN KEY ("card_transaction_id") REFERENCES "public"."card_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_company_no_uq" ON "bank_accounts" USING btree ("company_id","account_no_index");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_dedupe_uq" ON "bank_transactions" USING btree ("company_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_date_idx" ON "bank_transactions" USING btree ("bank_account_id","tx_date");--> statement-breakpoint
CREATE UNIQUE INDEX "card_transactions_dedupe_uq" ON "card_transactions" USING btree ("company_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "card_transactions_card_date_idx" ON "card_transactions" USING btree ("card_id","approved_date");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_receipts_dedupe_uq" ON "cash_receipts" USING btree ("company_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "cash_receipts_company_date_idx" ON "cash_receipts" USING btree ("company_id","tx_date");--> statement-breakpoint
CREATE INDEX "collection_runs_company_started_idx" ON "collection_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_cards_company_no_uq" ON "corporate_cards" USING btree ("company_id","card_no_index");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_dedupe_uq" ON "receipts" USING btree ("company_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "receipts_company_date_idx" ON "receipts" USING btree ("company_id","tx_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoices_dedupe_uq" ON "tax_invoices" USING btree ("company_id","dedupe_hash");--> statement-breakpoint
CREATE INDEX "tax_invoices_company_date_idx" ON "tax_invoices" USING btree ("company_id","issue_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_accounts" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_transactions" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "card_transactions" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_receipts" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "collection_runs" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "corporate_cards" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipts" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_invoices" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로, 참조하는 행이 같은 회사 것인지 확인한다.
-- 인자는 '참조테이블:컬럼' 목록이다(값이 null 이면 건너뛴다).
CREATE OR REPLACE FUNCTION guard_same_company() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    arg text;
    ref_table text;
    ref_column text;
    ref_id uuid;
    found boolean;
  BEGIN
    FOREACH arg IN ARRAY TG_ARGV LOOP
      ref_table := split_part(arg, ':', 1);
      ref_column := split_part(arg, ':', 2);
      ref_id := (to_jsonb(NEW) ->> ref_column)::uuid;
      CONTINUE WHEN ref_id IS NULL;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND company_id = $2)', ref_table)
        INTO found USING ref_id, NEW.company_id;
      IF NOT found THEN
        RAISE EXCEPTION 'REFERENCE_NOT_FOUND: %.%', TG_TABLE_NAME, ref_column
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END LOOP;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER bank_accounts_guard BEFORE INSERT OR UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:ledger_account_id');
--> statement-breakpoint
CREATE TRIGGER corporate_cards_guard BEFORE INSERT OR UPDATE ON corporate_cards
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:ledger_account_id');
--> statement-breakpoint
CREATE TRIGGER bank_transactions_guard BEFORE INSERT OR UPDATE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('bank_accounts:bank_account_id', 'journal_entries:entry_id');
--> statement-breakpoint
CREATE TRIGGER card_transactions_guard BEFORE INSERT OR UPDATE ON card_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('corporate_cards:card_id', 'journal_entries:entry_id');
--> statement-breakpoint
CREATE TRIGGER tax_invoices_guard BEFORE INSERT OR UPDATE ON tax_invoices
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'journal_entries:entry_id');
--> statement-breakpoint
CREATE TRIGGER cash_receipts_guard BEFORE INSERT OR UPDATE ON cash_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'journal_entries:entry_id');
--> statement-breakpoint
CREATE TRIGGER receipts_guard BEFORE INSERT OR UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('file_objects:file_id', 'card_transactions:card_transaction_id', 'journal_entries:entry_id');
