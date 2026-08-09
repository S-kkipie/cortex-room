import "server-only";
import type { CanvasSnapshot } from "@/core/canvas/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findCanvasSnapshotRows } from "../repository/find-canvas-snapshot-rows";
import { toCanvasSnapshot } from "../repository/utils";

export async function getCanvasSnapshotService(
    projectId: string,
): AsyncAppResult<CanvasSnapshot> {
    try {
        const result = await findCanvasSnapshotRows(projectId);
        if (result.kind === "project_not_found")
            return err(AppErrors.notFound({ targets: ["projectId"] }));

        return ok(toCanvasSnapshot(projectId, result.rows));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
