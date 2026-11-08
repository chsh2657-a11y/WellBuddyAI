ALTER TABLE "companies" ADD COLUMN "journal_approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD COLUMN "carried_forward_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_opening_uq" ON "journal_entries" USING btree ("fiscal_year_id") WHERE type = 'opening';