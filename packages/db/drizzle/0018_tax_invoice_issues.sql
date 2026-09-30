CREATE TABLE "tax_invoice_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"mgt_key" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"issue_date" date NOT NULL,
	"buyer_biz_no" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_ceo_name" text,
	"buyer_email" text,
	"item_name" text NOT NULL,
	"supply_amount" bigint NOT NULL,
	"vat_amount" bigint NOT NULL,
	"total_amount" bigint NOT NULL,
	"approval_no" text,
	"message" text,
	"tax_invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_invoice_issues_status_ck" CHECK (status in ('issued', 'sent', 'cancelled', 'failed')),
	CONSTRAINT "tax_invoice_issues_kind_ck" CHECK (kind in ('tax', 'zero', 'exempt')),
	CONSTRAINT "tax_invoice_issues_amount_ck" CHECK (total_amount = supply_amount + vat_amount)
);
--> statement-breakpoint
ALTER TABLE "tax_invoice_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_invoice_issues" ADD CONSTRAINT "tax_invoice_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_issues" ADD CONSTRAINT "tax_invoice_issues_tax_invoice_id_tax_invoices_id_fk" FOREIGN KEY ("tax_invoice_id") REFERENCES "public"."tax_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_issues" ADD CONSTRAINT "tax_invoice_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_issues_company_mgt_key_uq" ON "tax_invoice_issues" USING btree ("company_id","mgt_key");--> statement-breakpoint
CREATE INDEX "tax_invoice_issues_company_date_idx" ON "tax_invoice_issues" USING btree ("company_id","issue_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_invoice_issues" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE TRIGGER tax_invoice_issues_guard BEFORE INSERT OR UPDATE ON tax_invoice_issues
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('tax_invoices:tax_invoice_id');
