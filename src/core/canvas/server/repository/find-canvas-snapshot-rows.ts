import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { projects } from "@/server/drizzle/schemas/project-schema";
import {
    type WorkspaceElementRow,
    workspaceElements,
} from "@/server/drizzle/schemas/workspace-element-schema";

export type CanvasSnapshotRowsResult =
    | { kind: "found"; rows: WorkspaceElementRow[] }
    | { kind: "project_not_found" };

export async function findCanvasSnapshotRows(
    projectId: string,
    database: typeof db = db,
): Promise<CanvasSnapshotRowsResult> {
    return database.transaction(async (tx) => {
        const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .for("update");

        if (!project) return { kind: "project_not_found" };

        const rows = await tx
            .select()
            .from(workspaceElements)
            .where(eq(workspaceElements.projectId, projectId))
            .orderBy(asc(workspaceElements.id));

        return { kind: "found", rows };
    });
}
