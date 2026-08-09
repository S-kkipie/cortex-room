import "server-only";
import type {
    CanvasCommand,
    CanvasMutationResult,
} from "@/core/canvas/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { applyCanvasCommand } from "../repository/apply-canvas-command";
import { toCanvasRecord } from "../repository/utils";
import { isOperationTimestampAcceptable } from "./operation-time";

export async function applyCanvasCommandService(
    actorId: string,
    projectId: string,
    command: CanvasCommand,
    routeElementId?: string,
): AsyncAppResult<CanvasMutationResult> {
    if (command.projectId !== projectId) {
        return err(AppErrors.invalidBody({ targets: ["projectId"] }));
    }

    if (!isOperationTimestampAcceptable(command.occurredAt)) {
        return err(AppErrors.invalidBody({ targets: ["occurredAt"] }));
    }

    if (
        routeElementId !== undefined &&
        (command.kind === "workspace.element.create" ||
            command.elementId !== routeElementId)
    ) {
        return err(AppErrors.invalidBody({ targets: ["elementId"] }));
    }

    try {
        const result = await applyCanvasCommand(command, actorId);
        if (result.kind === "conflict") {
            return err(AppErrors.conflict({ targets: ["elementId"] }));
        }
        if (result.kind === "project_not_found") {
            return err(AppErrors.notFound({ targets: ["projectId"] }));
        }
        if (result.kind === "not_found") {
            return err(AppErrors.notFound({ targets: ["elementId"] }));
        }

        return ok({
            applied: result.kind === "applied",
            record: toCanvasRecord(result.row),
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
