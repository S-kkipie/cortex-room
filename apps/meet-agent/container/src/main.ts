import { createServer } from "node:http";
import { EventBuffer } from "./emit/buffer";
import { createPortalPublisher } from "./emit/portal";
import { MeetSession } from "./meet/session";
// Real Playwright + AssemblyAI deps are constructed in Task 10 and passed here.

const buffer = new EventBuffer();
const publisher = createPortalPublisher({
    apiKey: process.env.PORTAL_API_KEY ?? "",
    channelId: `meeting-${process.env.MEETING_ID ?? "dev"}`,
});

// session built with real deps in Task 10:
let session: MeetSession | null = null;

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (req.method === "POST" && url.pathname === "/start") {
        // parse body { meetingId, meetUrl }, construct + session.start(...)
        res.writeHead(202).end();
        return;
    }
    if (req.method === "POST" && url.pathname === "/stop") {
        const activeSession = session as MeetSession | null;
        if (activeSession) await activeSession.stop("requested");
        res.writeHead(202).end();
        return;
    }
    if (url.pathname === "/state") {
        const activeSession = session as MeetSession | null;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: activeSession?.getState() ?? "starting" }));
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
