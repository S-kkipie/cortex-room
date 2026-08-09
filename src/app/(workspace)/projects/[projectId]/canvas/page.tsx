import { notFound } from "next/navigation";
import { CanvasShell } from "@/core/canvas/client/ui/canvas-shell";
import { getCanvasProjectService } from "@/core/canvas/server/services/get-canvas-project-service";
import { requireAuth } from "@/server/auth/require-auth";
import { AgentControl } from "./agent-control";

export default async function CanvasPage({
    params,
}: {
    params: Promise<{ projectId: string }>;
}) {
    const { projectId } = await params;
    const { user } = await requireAuth(`/projects/${projectId}/canvas`);
    const result = await getCanvasProjectService(projectId);

    if (!result.ok) {
        if (result.error.type === "NotFoundError") notFound();
        throw new Error("Unable to load the canvas");
    }

    return (
        <div className="relative h-svh">
            <CanvasShell
                projectId={projectId}
                userId={user.id}
                projectName={result.data.name}
                userLabel={user.name?.trim() || user.email}
            />
            <AgentControl projectId={projectId} />
        </div>
    );
}
