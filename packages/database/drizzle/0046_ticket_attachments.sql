CREATE TABLE "ticket_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"message_id" text,
	"uploader_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachment_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_message_id_ticket_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ticket_message"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_attachment_ticket_idx" ON "ticket_attachment" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX "ticket_attachment_message_idx" ON "ticket_attachment" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "ticket_attachment_uploader_idx" ON "ticket_attachment" USING btree ("uploader_id");
