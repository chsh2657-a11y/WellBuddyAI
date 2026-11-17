CREATE TABLE "note_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"action" text NOT NULL,
	"event_date" date NOT NULL,
	"entry_id" uuid,
	"from_status" text,
	"to_status" text NOT NULL,
	"detail" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_events_action_ck" CHECK (action in ('register', 'settle', 'discount', 'endorse', 'dishonor'))
);
--> statement-breakpoint
ALTER TABLE "note_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note_no" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"bank" text,
	"status" text DEFAULT 'holding' NOT NULL,
	"status_date" date,
	"endorsed_to_partner_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_amount_ck" CHECK (amount > 0 and due_date >= issue_date),
	CONSTRAINT "notes_kind_ck" CHECK (kind in ('receivable', 'payable')),
	CONSTRAINT "notes_status_ck" CHECK (status in ('holding', 'settled', 'discounted', 'endorsed', 'dishonored'))
);
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_events" ADD CONSTRAINT "note_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_endorsed_to_partner_id_partners_id_fk" FOREIGN KEY ("endorsed_to_partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_events_note_idx" ON "note_events" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_company_kind_no_uq" ON "notes" USING btree ("company_id","kind","note_no");--> statement-breakpoint
CREATE INDEX "notes_company_due_idx" ON "notes" USING btree ("company_id","due_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "note_events" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notes" AS PERMISSIVE FOR ALL TO "wellbuddy_app" USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());--> statement-breakpoint

-- FK 검사는 RLS 를 거치지 않으므로 다른 회사의 거래처·어음·전표를 가리키지 못하게 막는다.
CREATE OR REPLACE FUNCTION guard_note() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM partners WHERE id = NEW.partner_id AND company_id = NEW.company_id)
       OR (NEW.endorsed_to_partner_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM partners WHERE id = NEW.endorsed_to_partner_id AND company_id = NEW.company_id
       ))
    THEN
      RAISE EXCEPTION 'PARTNER_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER notes_guard
  BEFORE INSERT OR UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION guard_note();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_note_event() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM notes WHERE id = NEW.note_id AND company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'NOTE_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = NEW.entry_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint

CREATE TRIGGER note_events_guard
  BEFORE INSERT OR UPDATE ON note_events
  FOR EACH ROW EXECUTE FUNCTION guard_note_event();
