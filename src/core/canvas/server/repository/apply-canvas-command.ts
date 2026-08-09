import "server-only";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import type { CanvasCommand } from "@/core/canvas/domain/types";
import { db } from "@/server/drizzle/db";
import { projects } from "@/server/drizzle/schemas/project-schema";
import {
    type WorkspaceElementRow,
    workspaceElements,
} from "@/server/drizzle/schemas/workspace-element-schema";
import { isOperationNewer } from "./lww";

type CanvasTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ApplyCanvasCommandResult =
    | { kind: "applied" | "stale"; row: WorkspaceElementRow }
    | { kind: "not_found" }
    | { kind: "conflict" }
    | { kind: "project_not_found" };

function newerOperationCondition(command: CanvasCommand) {
    const occurredAt = new Date(command.occurredAt);
    return or(
        lt(workspaceElements.lastOperationAt, occurredAt),
        and(
            eq(workspaceElements.lastOperationAt, occurredAt),
            sql`lower(${workspaceElements.lastOperationId}) < lower(${command.eventId})`,
        ),
    );
}

async function findElementById(
    tx: CanvasTransaction,
    id: string,
): Promise<WorkspaceElementRow | null> {
    const [row] = await tx
        .select()
        .from(workspaceElements)
        .where(eq(workspaceElements.id, id))
        .limit(1)
        .for("update");

    return row ?? null;
}

function classifyExistingRow(
    command: CanvasCommand,
    row: WorkspaceElementRow | null,
): ApplyCanvasCommandResult {
    if (!row) return { kind: "not_found" };
    if (row.projectId !== command.projectId) return { kind: "conflict" };

    const incomingVersion = {
        lastOperationAt: command.occurredAt,
        lastOperationId: command.eventId,
    };
    const currentVersion = {
        lastOperationAt: row.lastOperationAt.toISOString(),
        lastOperationId: row.lastOperationId,
    };

    if (!isOperationNewer(incomingVersion, currentVersion)) {
        return { kind: "stale", row };
    }

    return { kind: "not_found" };
}

function activePayloadConditions() {
    return [
        isNotNull(workspaceElements.type),
        isNotNull(workspaceElements.content),
        isNotNull(workspaceElements.x),
        isNotNull(workspaceElements.y),
        isNotNull(workspaceElements.width),
        isNotNull(workspaceElements.height),
        isNotNull(workspaceElements.createdBy),
        isNotNull(workspaceElements.createdAt),
        isNotNull(workspaceElements.updatedAt),
    ];
}

function hasActivePayload(row: WorkspaceElementRow): boolean {
    return (
        row.type !== null &&
        row.content !== null &&
        row.x !== null &&
        row.y !== null &&
        row.width !== null &&
        row.height !== null &&
        row.createdBy !== null &&
        row.createdAt !== null &&
        row.updatedAt !== null
    );
}

async function applyCreate(
    tx: CanvasTransaction,
    command: Extract<CanvasCommand, { kind: "workspace.element.create" }>,
    actorId: string,
): Promise<ApplyCanvasCommandResult> {
    const now = new Date();
    const operationAt = new Date(command.occurredAt);
    const [row] = await tx
        .insert(workspaceElements)
        .values({
            id: command.element.id,
            projectId: command.projectId,
            type: command.element.type,
            content: command.element.content,
            x: command.element.x,
            y: command.element.y,
            width: command.element.width,
            height: command.element.height,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
            lastOperationAt: operationAt,
            lastOperationId: command.eventId,
            deletedAt: null,
        })
        .onConflictDoUpdate({
            target: workspaceElements.id,
            set: {
                type: command.element.type,
                content: command.element.content,
                x: command.element.x,
                y: command.element.y,
                width: command.element.width,
                height: command.element.height,
                createdBy: actorId,
                createdAt: now,
                updatedAt: now,
                lastOperationAt: operationAt,
                lastOperationId: command.eventId,
                deletedAt: null,
            },
            where: and(
                eq(workspaceElements.projectId, command.projectId),
                newerOperationCondition(command),
            ),
        })
        .returning();

    if (row) return { kind: "applied", row };
    return classifyExistingRow(
        command,
        await findElementById(tx, command.element.id),
    );
}

async function applyUpdate(
    tx: CanvasTransaction,
    command: Extract<
        CanvasCommand,
        {
            kind:
                | "workspace.element.update"
                | "workspace.element.move"
                | "workspace.element.resize";
        }
    >,
    retried = false,
): Promise<ApplyCanvasCommandResult> {
    const now = new Date();
    const operationAt = new Date(command.occurredAt);
    const values =
        command.kind === "workspace.element.update"
            ? { content: command.content }
            : command.kind === "workspace.element.move"
              ? { x: command.x, y: command.y }
              : { width: command.width, height: command.height };

    const [row] = await tx
        .update(workspaceElements)
        .set({
            ...values,
            updatedAt: now,
            deletedAt: null,
            lastOperationAt: operationAt,
            lastOperationId: command.eventId,
        })
        .where(
            and(
                eq(workspaceElements.id, command.elementId),
                eq(workspaceElements.projectId, command.projectId),
                newerOperationCondition(command),
                ...activePayloadConditions(),
            ),
        )
        .returning();

    if (row) return { kind: "applied", row };
    const currentRow = await findElementById(tx, command.elementId);
    const classification = classifyExistingRow(command, currentRow);

    if (
        classification.kind === "not_found" &&
        currentRow !== null &&
        !retried &&
        hasActivePayload(currentRow)
    ) {
        return applyUpdate(tx, command, true);
    }

    return classification;
}

async function applyDelete(
    tx: CanvasTransaction,
    command: Extract<CanvasCommand, { kind: "workspace.element.delete" }>,
): Promise<ApplyCanvasCommandResult> {
    const now = new Date();
    const operationAt = new Date(command.occurredAt);
    const [row] = await tx
        .insert(workspaceElements)
        .values({
            id: command.elementId,
            projectId: command.projectId,
            type: null,
            content: null,
            x: null,
            y: null,
            width: null,
            height: null,
            createdBy: null,
            createdAt: null,
            updatedAt: null,
            lastOperationAt: operationAt,
            lastOperationId: command.eventId,
            deletedAt: now,
        })
        .onConflictDoUpdate({
            target: workspaceElements.id,
            set: {
                deletedAt: now,
                updatedAt: now,
                lastOperationAt: operationAt,
                lastOperationId: command.eventId,
            },
            where: and(
                eq(workspaceElements.projectId, command.projectId),
                newerOperationCondition(command),
            ),
        })
        .returning();

    if (row) return { kind: "applied", row };
    return classifyExistingRow(
        command,
        await findElementById(tx, command.elementId),
    );
}

export async function applyCanvasCommand(
    command: CanvasCommand,
    actorId: string,
    database: typeof db = db,
): Promise<ApplyCanvasCommandResult> {
    return database.transaction(async (tx) => {
        const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, command.projectId))
            .for("update");

        if (!project) return { kind: "project_not_found" };

        switch (command.kind) {
            case "workspace.element.create":
                return applyCreate(tx, command, actorId);
            case "workspace.element.update":
            case "workspace.element.move":
            case "workspace.element.resize":
                return applyUpdate(tx, command);
            case "workspace.element.delete":
                return applyDelete(tx, command);
        }
    });
}
