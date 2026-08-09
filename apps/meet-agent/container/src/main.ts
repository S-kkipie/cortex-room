import { createServer } from "node:http";
import { EventBuffer } from "./emit/buffer";
import { createPortalPublisher } from "./emit/portal";
import { createAssemblyAiBridge, createPlaywrightBrowser, MeetSession } from "./meet/session";

const buffer = new EventBuffer();
const publisher = createPortalPublisher({
    apiKey: process.env.PORTAL_API_KEY ?? "",
    channelId: `meeting-${process.env.MEETING_ID ?? "dev"}`,
});

let session: MeetSession | null = null;

async function readJson(req: NodeJS.ReadableStream): Promise<{ meetingId: string; meetUrl: string }> {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body) as { meetingId?: unknown; meetUrl?: unknown };
    if (typeof parsed.meetingId !== "string" || typeof parsed.meetUrl !== "string") {
        throw new Error("meetingId and meetUrl are required");
    }
    return { meetingId: parsed.meetingId, meetUrl: parsed.meetUrl };
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "POST" && url.pathname === "/start") {
        try {
            const { meetingId, meetUrl } = await readJson(req);
            const stt = createAssemblyAiBridge(process.env.ASSEMBLYAI_API_KEY ?? "");
            session = new MeetSession({
                launchBrowser: (urlToJoin, onSample) =>
                    createPlaywrightBrowser(urlToJoin, onSample, (chunk) => stt.sendAudio(chunk)),
                stt,
                buffer,
                publisher,
                now: Date.now,
            });
            await session.start(meetingId, meetUrl);
            res.writeHead(202).end();
        } catch (error) {
            res.writeHead(400, { "content-type": "application/json" }).end(
                JSON.stringify({ error: error instanceof Error ? error.message : "invalid request" }),
            );
        }
        return;
    }
    if (req.method === "POST" && url.pathname === "/stop") {
        if (session) await session.stop("requested");
        res.writeHead(202).end();
        return;
    }
    if (url.pathname === "/state") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: session?.getState() ?? "starting" }));
        return;
    }
    if (url.pathname === "/transcript") {
        const cursor = Number(url.searchParams.get("since") ?? 0);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(buffer.since(cursor)));
        return;
    }
    if (url.pathname === "/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const off = buffer.subscribe((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
        req.on("close", off);
        return;
    }
    res.writeHead(404).end();
});

server.listen(8080);
export { server, buffer, publisher };
