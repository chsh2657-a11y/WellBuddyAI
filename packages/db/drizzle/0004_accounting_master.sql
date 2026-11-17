CREATE TABLE "account_memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_memos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"normal_balance" text NOT NULL,
	"requires_partner" boolean DEFAULT false NOT NULL,
	"requires_department" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_ck" CHECK (code ~ '^[0-9]{3,5}$'),
	CONSTRAINT "accounts_normal_balance_ck" CHECK (normal_balance in ('debit', 'credit'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'both' NOT NULL,
	"biz_reg_no" text,
	"representative" text,
	"business_type" text,
	"business_item" text,
	"address" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"bank_name" text,
	"bank_account_enc" text,
	"bank_account_last4" text,
	"bank_holder" text,
	"memo" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_kind_ck" CHECK (kind in ('customer', 'supplier', 'both', 'other'))
);
--> statement-breakpoint
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_memos" ADD CONSTRAINT "account_memos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_memos" ADD CONSTRAINT "account_memos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_memos_account_idx" ON "account_memos" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_code_uq" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_code_uq" ON "departments" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_company_code_uq" ON "partners" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_company_bizno_uq" ON "partners" USING btree ("company_id","biz_reg_no") WHERE biz_reg_no is not null;--> statement-breakpoint
CREATE INDEX "partners_company_name_idx" ON "partners" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_company_code_uq" ON "projects" USING btree ("company_id","code");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_memos" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounts" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "departments" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "partners" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "projects" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());