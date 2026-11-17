CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"biz_reg_no" text NOT NULL,
	"representative" text,
	"business_type" text,
	"business_item" text,
	"address" text,
	"is_headquarters" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"biz_reg_no" text NOT NULL,
	"representative" text,
	"business_type" text,
	"business_item" text,
	"address" text,
	"phone" text,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_fiscal_month_ck" CHECK (fiscal_year_start_month between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_role_ck" CHECK (role in ('owner', 'admin', 'accountant', 'approver', 'employee')),
	CONSTRAINT "company_members_status_ck" CHECK (status in ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "company_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"enabled_modules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_role_ck" CHECK (role in ('owner', 'admin', 'accountant', 'approver', 'employee'))
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_company_id_role_pk" PRIMARY KEY("company_id","role"),
	CONSTRAINT "role_permissions_role_ck" CHECK (role in ('owner', 'admin', 'accountant', 'approver', 'employee'))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"method" text,
	"path" text,
	"status_code" integer,
	"ip" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_objects_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"credentials_enc" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_cron" text,
	"last_status" text,
	"last_message" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_places" ADD CONSTRAINT "business_places_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "business_places_company_bizno_uq" ON "business_places" USING btree ("company_id","biz_reg_no");--> statement-breakpoint
CREATE UNIQUE INDEX "company_members_company_user_uq" ON "company_members" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_members_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_company_idx" ON "invitations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_logs_company_created_idx" ON "audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "file_objects_company_idx" ON "file_objects" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_settings_company_channel_uq" ON "integration_settings" USING btree ("company_id","channel");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "business_places" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "companies_select" ON "companies" AS PERMISSIVE FOR SELECT TO "wellbuddy_app" USING (id = current_company_id() or exists (
        select 1 from company_members m
        where m.company_id = companies.id
          and m.user_id = current_app_user_id()
          and m.status = 'active'));--> statement-breakpoint
CREATE POLICY "companies_insert" ON "companies" AS PERMISSIVE FOR INSERT TO "wellbuddy_app" WITH CHECK (current_app_user_id() is not null and id = current_company_id());--> statement-breakpoint
CREATE POLICY "companies_update" ON "companies" AS PERMISSIVE FOR UPDATE TO "wellbuddy_app" USING (id = current_company_id()) WITH CHECK (id = current_company_id());--> statement-breakpoint
CREATE POLICY "company_members_select" ON "company_members" AS PERMISSIVE FOR SELECT TO "wellbuddy_app" USING (company_id = current_company_id() or user_id = current_app_user_id());--> statement-breakpoint
CREATE POLICY "company_members_write" ON "company_members" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_settings" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "audit_logs_select" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "wellbuddy_app" USING (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "audit_logs_insert" ON "audit_logs" AS PERMISSIVE FOR INSERT TO "wellbuddy_app" WITH CHECK (company_id is null or company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "file_objects" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_settings" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());