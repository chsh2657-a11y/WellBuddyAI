CREATE TABLE "auto_journal_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"deductible" boolean,
	"partner_id" uuid,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auto_journal_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"keywords" text,
	"partner_id" uuid,
	"min_amount" bigint,
	"max_amount" bigint,
	"account_id" uuid NOT NULL,
	"assign_partner_id" uuid,
	"deductible" boolean,
	"department_id" uuid,
	"project_id" uuid,
	"memo" text,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_journal_rules_amount_ck" CHECK (min_amount is null or max_amount is null or min_amount <= max_amount)
);
--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auto_journal_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"threshold" real DEFAULT 0.9 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_journal_settings_threshold_ck" CHECK (threshold between 0.5 and 1)
);
--> statement-breakpoint
ALTER TABLE "auto_journal_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_kind" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	"item_kind" text NOT NULL,
	"account_id" uuid,
	"deductible" boolean,
	"partner_id" uuid,
	"department_id" uuid,
	"project_id" uuid,
	"memo" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"reason" text,
	"rule_id" uuid,
	"edited" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_suggestions_method_ck" CHECK (method in ('rule', 'history', 'ai', 'default', 'manual', 'none')),
	CONSTRAINT "evidence_suggestions_confidence_ck" CHECK (confidence between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ADD CONSTRAINT "auto_journal_memory_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ADD CONSTRAINT "auto_journal_memory_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ADD CONSTRAINT "auto_journal_memory_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_assign_partner_id_partners_id_fk" FOREIGN KEY ("assign_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_rules" ADD CONSTRAINT "auto_journal_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_journal_settings" ADD CONSTRAINT "auto_journal_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD CONSTRAINT "evidence_suggestions_rule_id_auto_journal_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."auto_journal_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_journal_memory_uq" ON "auto_journal_memory" USING btree ("company_id","kind","key","account_id");--> statement-breakpoint
CREATE INDEX "auto_journal_rules_company_priority_idx" ON "auto_journal_rules" USING btree ("company_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_suggestions_uq" ON "evidence_suggestions" USING btree ("company_id","evidence_kind","evidence_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auto_journal_memory" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auto_journal_rules" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auto_journal_settings" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evidence_suggestions" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- 다른 회사의 계정·거래처·부서·프로젝트·규칙을 가리키지 못하게 막는다
CREATE TRIGGER auto_journal_rules_guard BEFORE INSERT OR UPDATE ON auto_journal_rules
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:account_id', 'partners:partner_id', 'partners:assign_partner_id', 'departments:department_id', 'projects:project_id');
--> statement-breakpoint
CREATE TRIGGER auto_journal_memory_guard BEFORE INSERT OR UPDATE ON auto_journal_memory
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:account_id', 'partners:partner_id');
--> statement-breakpoint
CREATE TRIGGER evidence_suggestions_guard BEFORE INSERT OR UPDATE ON evidence_suggestions
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:account_id', 'partners:partner_id', 'departments:department_id', 'projects:project_id', 'auto_journal_rules:rule_id');
