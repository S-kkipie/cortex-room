"use server";

import { redirect } from "next/navigation";
import { createProjectService } from "@/core/project/server/services/create-project-service";
import { requireAuth } from "@/server/auth/require-auth";

/**
 * Create a new meeting room (canvas) for the signed-in user and jump straight
 * into its canvas. A room IS a project under the hood; this is the intuitive
 * entry point that replaces the starter projects table.
 */
export async function createRoomAction(formData: FormData): Promise<void> {
    const { user } = await requireAuth("/canvas");
    const name =
        String(formData.get("name") ?? "").trim() || "Reunión sin título";
    const result = await createProjectService(user.id, { name });
    if (!result.ok) throw new Error("No se pudo crear la reunión");
    redirect(`/projects/${result.data.id}/canvas`);
}
