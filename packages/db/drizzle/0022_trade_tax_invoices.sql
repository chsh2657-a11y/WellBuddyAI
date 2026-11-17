ALTER TABLE "tax_invoice_issues" ADD COLUMN "trade_doc_id" uuid;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD COLUMN "tax_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "tax_invoice_issues" ADD CONSTRAINT "tax_invoice_issues_trade_doc_id_trade_docs_id_fk" FOREIGN KEY ("trade_doc_id") REFERENCES "public"."trade_docs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_tax_invoice_id_tax_invoices_id_fk" FOREIGN KEY ("tax_invoice_id") REFERENCES "public"."tax_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_issues_trade_doc_uq" ON "tax_invoice_issues" USING btree ("company_id","trade_doc_id") WHERE trade_doc_id is not null and status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "trade_docs_tax_invoice_idx" ON "trade_docs" USING btree ("tax_invoice_id");--> statement-breakpoint
DROP TRIGGER trade_docs_guard ON trade_docs;
--> statement-breakpoint
CREATE TRIGGER trade_docs_guard BEFORE INSERT OR UPDATE ON trade_docs
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'warehouses:warehouse_id', 'warehouses:to_warehouse_id', 'trade_docs:source_doc_id', 'journal_entries:entry_id', 'journal_entries:cost_entry_id', 'tax_invoices:tax_invoice_id');--> statement-breakpoint
DROP TRIGGER tax_invoice_issues_guard ON tax_invoice_issues;
--> statement-breakpoint
CREATE TRIGGER tax_invoice_issues_guard BEFORE INSERT OR UPDATE ON tax_invoice_issues
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('tax_invoices:tax_invoice_id', 'trade_docs:trade_doc_id');
