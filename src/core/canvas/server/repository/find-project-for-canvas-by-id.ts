import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import {
    type ProjectRow,
    projects,
} from "@/server/drizzle/schemas/project-schema";

export async function findProjectForCanvasById(
    id: string,
): Promise<ProjectRow | null> {
    const [row] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

    return row ?? null;
}
