ALTER TABLE "trade_doc_lines" DROP CONSTRAINT "trade_doc_lines_qty_ck";--> statement-breakpoint
ALTER TABLE "trade_doc_lines" ADD CONSTRAINT "trade_doc_lines_qty_ck" CHECK (qty <> 0);--> statement-breakpoint
ALTER TABLE "trade_docs" ADD CONSTRAINT "trade_docs_transfer_ck" CHECK (kind <> 'transfer' or (to_warehouse_id is not null and to_warehouse_id <> warehouse_id));