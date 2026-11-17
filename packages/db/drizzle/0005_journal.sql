CREATE TABLE "accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"period_no" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "accounting_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_range_ck" CHECK (start_date <= end_date)
);
--> statement-breakpoint
ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_counters" (
	"company_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"last_no" integer NOT NULL,
	CONSTRAINT "journal_counters_company_id_entry_date_pk" PRIMARY KEY("company_id","entry_date")
);
--> statement-breakpoint
ALTER TABLE "journal_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"entry_no" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"vat_type" text,
	"evidence_type" text,
	"supply_amount" bigint,
	"vat_amount" bigint,
	"vat_deductible" boolean,
	"vat_partner_id" uuid,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"reversal_of_id" uuid,
	"reversed_by_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_type_ck" CHECK (type in ('general','sales','purchase','receipt','payment','opening','closing')),
	CONSTRAINT "journal_entries_status_ck" CHECK (status in ('draft','pending','posted','reversed'))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"partner_id" uuid,
	"department_id" uuid,
	"project_id" uuid,
	"memo" text,
	CONSTRAINT "journal_lines_amount_ck" CHECK (debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0)))
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_counters" ADD CONSTRAINT "journal_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_vat_partner_id_partners_id_fk" FOREIGN KEY ("vat_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_periods_year_no_uq" ON "accounting_periods" USING btree ("fiscal_year_id","period_no");--> statement-breakpoint
CREATE INDEX "accounting_periods_company_range_idx" ON "accounting_periods" USING btree ("company_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_years_company_start_uq" ON "fiscal_years" USING btree ("company_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_attachments_entry_file_uq" ON "journal_attachments" USING btree ("entry_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_date_no_uq" ON "journal_entries" USING btree ("company_id","entry_date","entry_no");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date_idx" ON "journal_entries" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_fiscal_year_idx" ON "journal_entries" USING btree ("fiscal_year_id","status");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_company_account_idx" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_company_partner_idx" ON "journal_lines" USING btree ("company_id","partner_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounting_periods" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_years" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_attachments" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_counters" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_entries" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_lines" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());