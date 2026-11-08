CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"move_date" date NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"qty" numeric(15, 3) NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"costing" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_line_id" uuid,
	"lot_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_costing_ck" CHECK (costing in ('fixed', 'average', 'none')),
	CONSTRAINT "stock_moves_qty_ck" CHECK (qty <> 0)
);
--> statement-breakpoint
ALTER TABLE "stock_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trade_doc_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"spec" text,
	"unit" text NOT NULL,
	"qty" numeric(15, 3) NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"supply" bigint DEFAULT 0 NOT NULL,
	"vat" bigint DEFAULT 0 NOT NULL,
	"warehouse_id" uuid,
	"source_line_id" uuid,
	"lot_no" text,
	"memo" text,
	CONSTRAINT "trade_doc_lines_qty_ck" CHECK (qty > 0),
	CONSTRAINT "trade_doc_lines_amount_ck" CHECK (unit_price >= 0 and supply >= 0 and vat >= 0)
);
--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trade_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"doc_no" text NOT NULL,
	"doc_date" date NOT NULL,
	"partner_id" uuid,
	"warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"source_doc_id" uuid,
	"status" text NOT NULL,
	"evidence_type" text,
	"supply_total" bigint DEFAULT 0 NOT NULL,
	"vat_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"due_date" date,
	"memo" text,
	"entry_id" uuid,
	"cost_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_docs_kind_ck" CHECK (kind in ('quote', 'sales_order', 'shipment', 'sale', 'sales_return', 'purchase_order', 'receipt', 'purchase', 'purchase_return', 'transfer', 'adjustment', 'opening')),
	CONSTRAINT "trade_docs_status_ck" CHECK (status in ('open', 'closed', 'posted', 'cancelled')),
	CONSTRAINT "trade_docs_total_ck" CHECK (total = supply_total + vat_total)
);
--> statement-breakpoint
ALTER TABLE "trade_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_doc_id_trade_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."trade_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_doc_line_id_trade_doc_lines_id_fk" FOREIGN KEY ("doc_line_id") REFERENCES "public"."trade_doc_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_doc_id_trade_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."trade_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_source_line_id_trade_doc_lines_id_fk" FOREIGN KEY ("source_line_id") REFERENCES "public"."trade_doc_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_source_doc_id_trade_docs_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."trade_docs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_cost_entry_id_journal_entries_id_fk" FOREIGN KEY ("cost_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_moves_item_idx" ON "stock_moves" USING btree ("company_id","item_id","move_date");--> statement-breakpoint
CREATE INDEX "stock_moves_doc_idx" ON "stock_moves" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "trade_doc_lines_doc_idx" ON "trade_doc_lines" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "trade_doc_lines_source_idx" ON "trade_doc_lines" USING btree ("source_line_id");--> statement-breakpoint
CREATE INDEX "trade_doc_lines_item_idx" ON "trade_doc_lines" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_docs_company_no_uq" ON "trade_docs" USING btree ("company_id","doc_no");--> statement-breakpoint
CREATE INDEX "trade_docs_company_kind_date_idx" ON "trade_docs" USING btree ("company_id","kind","doc_date");--> statement-breakpoint
CREATE INDEX "trade_docs_source_idx" ON "trade_docs" USING btree ("source_doc_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_moves" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "trade_doc_lines" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "trade_docs" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE TRIGGER trade_docs_guard BEFORE INSERT OR UPDATE ON trade_docs
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'warehouses:warehouse_id', 'warehouses:to_warehouse_id', 'trade_docs:source_doc_id', 'journal_entries:entry_id', 'journal_entries:cost_entry_id');--> statement-breakpoint
CREATE TRIGGER trade_doc_lines_guard BEFORE INSERT OR UPDATE ON trade_doc_lines
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('trade_docs:doc_id', 'items:item_id', 'warehouses:warehouse_id', 'trade_doc_lines:source_line_id');--> statement-breakpoint
CREATE TRIGGER stock_moves_guard BEFORE INSERT OR UPDATE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('items:item_id', 'warehouses:warehouse_id', 'trade_docs:doc_id', 'trade_doc_lines:doc_line_id');
