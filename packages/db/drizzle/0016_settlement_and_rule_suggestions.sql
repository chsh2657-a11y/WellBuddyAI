ALTER TABLE "tax_invoices" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "settled_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "auto_journal_memory" ADD COLUMN "suggestion_dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_suggestions" ADD COLUMN "settles" jsonb;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_settled_entry_id_journal_entries_id_fk" FOREIGN KEY ("settled_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP TRIGGER tax_invoices_guard ON tax_invoices;
--> statement-breakpoint
CREATE TRIGGER tax_invoices_guard BEFORE INSERT OR UPDATE ON tax_invoices
  FOR EACH ROW EXECUTE FUNCTION guard_same_company('partners:partner_id', 'journal_entries:entry_id', 'journal_entries:settled_entry_id');
