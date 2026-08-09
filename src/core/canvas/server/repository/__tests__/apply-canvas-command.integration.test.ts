import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { db as applicationDb } from "@/server/drizzle/db";
import * as schema from "@/server/drizzle/schemas";
import { user } from "@/server/drizzle/schemas/auth-schema";
import { projects } from "@/server/drizzle/schemas/project-schema";
import { applyCanvasCommand } from "../apply-canvas-command";
import { findCanvasSnapshotRows } from "../find-canvas-snapshot-rows";

const databaseUrl = process.env.CANVAS_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
type CanvasDatabase = typeof applicationDb;

function timestamp(offsetMs: number): string {
    return new Date(Date.now() + offsetMs).toISOString();
}

integration("canvas persistence against PostgreSQL", () => {
    let pool: Pool;
    let testDb: CanvasDatabase;
    const userId = randomUUID();
    const projectId = randomUUID();
    const elementId = randomUUID();

    beforeAll(async () => {
        pool = new Pool({
            connectionString: databaseUrl,
            ssl: { rejectUnauthorized: false },
        });
        testDb = drizzle({
            connection: {
                connectionString: databaseUrl,
                ssl: { rejectUnauthorized: false },
            },
            schema,
            casing: "snake_case",
        });

        await migrate(testDb, { migrationsFolder: "./drizzle" });
        await testDb.insert(user).values({
            id: userId,
            name: "Canvas integration test",
            email: `${userId}@example.test`,
        });
        await testDb.insert(projects).values({
            id: projectId,
            userId,
            name: "Canvas integration test project",
        });
    });

    afterAll(async () => {
        await testDb.delete(user).where(eq(user.id, userId));
        await pool.end();
    });

    it("persists create, rejects stale update, and retains delete tombstones", async () => {
        const createResult = await applyCanvasCommand(
            {
                kind: "workspace.element.create",
                eventId: randomUUID(),
                projectId,
                occurredAt: timestamp(-3_000),
                element: {
                    id: elementId,
                    type: "STICKY",
                    content: "persisted",
                    x: 10,
                    y: 20,
                    width: 240,
                    height: 160,
                },
            },
            userId,
            testDb,
        );
        expect(createResult.kind).toBe("applied");

        const staleResult = await applyCanvasCommand(
            {
                kind: "workspace.element.update",
                eventId: randomUUID(),
                projectId,
                occurredAt: timestamp(-4_000),
                elementId,
                content: "stale",
            },
            userId,
            testDb,
        );
        expect(staleResult.kind).toBe("stale");

        const deleteResult = await applyCanvasCommand(
            {
                kind: "workspace.element.delete",
                eventId: randomUUID(),
                projectId,
                occurredAt: timestamp(-1_000),
                elementId,
            },
            userId,
            testDb,
        );
        expect(deleteResult.kind).toBe("applied");

        const snapshot = await findCanvasSnapshotRows(projectId, testDb);
        expect(snapshot.kind).toBe("found");
        if (snapshot.kind === "found") {
            expect(snapshot.rows).toHaveLength(1);
            expect(snapshot.rows[0]?.deletedAt).not.toBeNull();
        }
    });
});
