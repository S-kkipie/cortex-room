import { sql } from "drizzle-orm";
import {
    check,
    doublePrecision,
    foreignKey,
    index,
    pgEnum,
    pgTable,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "./project-schema";

export const workspaceElementType = pgEnum("workspace_element_type", [
    "STICKY",
    "TEXT",
    "CARD",
    "HEADING",
]);

/**
 * Permanent canvas state. Deleted rows retain their operation version and may
 * retain payload fields when they can be used to apply a later update.
 */
export const workspaceElements = pgTable(
    "workspace_elements",
    {
        id: text("id").primaryKey(),
        projectId: text("project_id").notNull(),
        type: workspaceElementType("type"),
        content: text("content"),
        x: doublePrecision("x"),
        y: doublePrecision("y"),
        width: doublePrecision("width"),
        height: doublePrecision("height"),
        createdBy: text("created_by"),
        createdAt: timestamp("created_at", {
            precision: 3,
            withTimezone: true,
        }),
        updatedAt: timestamp("updated_at", {
            precision: 3,
            withTimezone: true,
        }),
        lastOperationAt: timestamp("last_operation_at", {
            precision: 3,
            withTimezone: true,
        }).notNull(),
        lastOperationId: text("last_operation_id").notNull(),
        deletedAt: timestamp("deleted_at", {
            precision: 3,
            withTimezone: true,
        }),
    },
    (table) => [
        foreignKey({
            columns: [table.projectId],
            foreignColumns: [projects.id],
            name: "workspace_elements_project_id_projects_id_fk",
        }).onDelete("cascade"),
        index("workspace_elements_project_id_idx").on(table.projectId),
        check(
            "workspace_elements_active_payload_check",
            sql`${table.deletedAt} IS NOT NULL OR (
                ${table.type} IS NOT NULL AND
                ${table.content} IS NOT NULL AND
                ${table.x} IS NOT NULL AND
                ${table.y} IS NOT NULL AND
                ${table.width} IS NOT NULL AND
                ${table.height} IS NOT NULL AND
                ${table.createdBy} IS NOT NULL AND
                ${table.createdAt} IS NOT NULL AND
                ${table.updatedAt} IS NOT NULL
            )`,
        ),
        check(
            "workspace_elements_active_dimensions_check",
            sql`${table.deletedAt} IS NOT NULL OR (
                ${table.width} > 0 AND ${table.height} > 0
            )`,
        ),
    ],
);

export type WorkspaceElementRow = typeof workspaceElements.$inferSelect;
export type NewWorkspaceElementRow = typeof workspaceElements.$inferInsert;
