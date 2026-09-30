CREATE TABLE "cash_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"direction" text NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"partner_id" uuid,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_plans_amount_ck" CHECK (amount > 0),
	CONSTRAINT "cash_plans_direction_ck" CHECK (direction in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "cash_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_plans" ADD CONSTRAINT "cash_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_plans" ADD CONSTRAINT "cash_plans_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_plans_company_date_idx" ON "cash_plans" USING btree ("company_id","plan_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_plans" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로 다른 회사의 거래처를 가리키지 못하게 막는다.
CREATE OR REPLACE FUNCTION guard_cash_plan() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.partner_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM partners WHERE id = NEW.partner_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'PARTNER_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER cash_plans_guard
  BEFORE INSERT OR UPDATE ON cash_plans
  FOR EACH ROW EXECUTE FUNCTION guard_cash_plan();
