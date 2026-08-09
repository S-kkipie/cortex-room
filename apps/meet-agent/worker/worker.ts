// Container is supplied by the Workers runtime; the installed workers-types package only exposes its interface globally.
// @ts-expect-error Container's runtime export is not declared by this workers-types version.
import { Container } from "cloudflare:workers";

export type RouteDeps = {
    forward(meetingId: string, req: Request): Promise<Response>;
    authToken: string;
};

const MEETING_RE = /^\/meetings\/([^/]+)(\/(start|stop|transcript|stream))?$/;

export async function routeRequest(req: Request, deps: RouteDeps): Promise<Response> {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${deps.authToken}`) return new Response("unauthorized", { status: 401 });

    const url = new URL(req.url);
    const m = url.pathname.match(MEETING_RE);
    if (!m) return new Response("not found", { status: 404 });
    const meetingId = m[1];
    url.pathname = m[2] ?? "/state";
    const forwarded = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
    });
    return deps.forward(meetingId, forwarded);
}

export class MeetingAgent extends Container {
    defaultPort = 8080;
    sleepAfter = "5m";

    // SQLite persistence via this.ctx.storage.sql — appendSegment/listSegments
    // implemented against the container's forwarded events in Task 10.
}

export default {
    async fetch(req: Request, env: { MEETING_AGENT: DurableObjectNamespace; AUTH_TOKEN: string }): Promise<Response> {
        return routeRequest(req, {
            authToken: env.AUTH_TOKEN,
            forward: (meetingId, r) => {
                const id = env.MEETING_AGENT.idFromName(meetingId);
                return env.MEETING_AGENT.get(id).fetch(r);
            },
        });
    },
};
