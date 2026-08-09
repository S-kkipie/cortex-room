import "server-only";
import type { Project } from "@/core/project/domain/types";
import { toProject } from "@/core/project/server/repository/utils";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findProjectForCanvasById } from "../repository/find-project-for-canvas-by-id";

export async function getCanvasProjectService(
    id: string,
): AsyncAppResult<Project> {
    try {
        const row = await findProjectForCanvasById(id);
        if (!row) return err(AppErrors.notFound({ targets: ["projectId"] }));
        return ok(toProject(row));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
