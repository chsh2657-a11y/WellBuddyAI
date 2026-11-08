CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"spec" text,
	"unit" text DEFAULT 'EA' NOT NULL,
	"barcode" text,
	"vat_type" text DEFAULT 'taxable' NOT NULL,
	"sales_price" bigint,
	"purchase_price" bigint,
	"sales_account_id" uuid,
	"purchase_account_id" uuid,
	"safety_stock" numeric(15, 3),
	"track_lot" boolean DEFAULT false NOT NULL,
	"track_serial" boolean DEFAULT false NOT NULL,
	"memo" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_kind_ck" CHECK (kind in ('goods', 'product', 'material', 'service')),
	CONSTRAINT "items_vat_type_ck" CHECK (vat_type in ('taxable', 'zero_rated', 'exempt')),
	CONSTRAINT "items_price_ck" CHECK (coalesce(sales_price, 0) >= 0 and coalesce(purchase_price, 0) >= 0),
	CONSTRAINT "items_service_ck" CHECK (kind <> 'service' or (not track_lot and not track_serial and safety_stock is null))
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "partner_item_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"sales_price" bigint,
	"purchase_price" bigint,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_item_prices_ck" CHECK ((sales_price is not null or purchase_price is not null) and coalesce(sales_price, 0) >= 0 and coalesce(purchase_price, 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "partner_item_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"memo" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sales_account_id_accounts_id_fk" FOREIGN KEY ("sales_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_account_id_accounts_id_fk" FOREIGN KEY ("purchase_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_item_prices" ADD CONSTRAINT "partner_item_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_item_prices" ADD CONSTRAINT "partner_item_prices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_item_prices" ADD CONSTRAINT "partner_item_prices_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_company_code_uq" ON "items" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "items_company_barcode_uq" ON "items" USING btree ("company_id","barcode") WHERE barcode is not null;--> statement-breakpoint
CREATE INDEX "items_company_name_idx" ON "items" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_item_prices_uq" ON "partner_item_prices" USING btree ("company_id","partner_id","item_id");--> statement-breakpoint
CREATE INDEX "partner_item_prices_item_idx" ON "partner_item_prices" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_company_code_uq" ON "warehouses" USING btree ("company_id","code");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "partner_item_prices" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "warehouses" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE TRIGGER items_guard BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('accounts:sales_account_id', 'accounts:purchase_account_id');--> statement-breakpoint
CREATE TRIGGER partner_item_prices_guard BEFORE INSERT OR UPDATE ON partner_item_prices
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'items:item_id');
