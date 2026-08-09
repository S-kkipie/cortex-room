CREATE TYPE "public"."workspace_element_type" AS ENUM('STICKY', 'TEXT', 'CARD', 'HEADING');--> statement-breakpoint
CREATE TABLE "workspace_elements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" "workspace_element_type",
	"content" text,
	"x" double precision,
	"y" double precision,
	"width" double precision,
	"height" double precision,
	"created_by" text,
	"created_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone,
	"last_operation_at" timestamp (3) with time zone NOT NULL,
	"last_operation_id" text NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "workspace_elements_active_payload_check" CHECK ("workspace_elements"."deleted_at" IS NOT NULL OR (
                "workspace_elements"."type" IS NOT NULL AND
                "workspace_elements"."content" IS NOT NULL AND
                "workspace_elements"."x" IS NOT NULL AND
                "workspace_elements"."y" IS NOT NULL AND
                "workspace_elements"."width" IS NOT NULL AND
                "workspace_elements"."height" IS NOT NULL AND
                "workspace_elements"."created_by" IS NOT NULL AND
                "workspace_elements"."created_at" IS NOT NULL AND
                "workspace_elements"."updated_at" IS NOT NULL
            )),
	CONSTRAINT "workspace_elements_active_dimensions_check" CHECK ("workspace_elements"."deleted_at" IS NOT NULL OR (
                "workspace_elements"."width" > 0 AND "workspace_elements"."height" > 0
            ))
);
--> statement-breakpoint
ALTER TABLE "workspace_elements" ADD CONSTRAINT "workspace_elements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_elements_project_id_idx" ON "workspace_elements" USING btree ("project_id");