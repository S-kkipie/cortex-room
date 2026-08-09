export const CANVAS_PORTAL_CHANNEL_PREFIX = "room-";

export function canvasPortalChannelId(projectId: string): string {
    return `${CANVAS_PORTAL_CHANNEL_PREFIX}${projectId}`;
}
