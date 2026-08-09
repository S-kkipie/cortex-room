import {
    allow,
    defineConfig,
    defineMiddleware,
    retract,
} from "@portalsdk/config";
import type { CanvasPortalMessage } from "./src/core/canvas/domain/types";

const retractCanvasTransientMessages = defineMiddleware<CanvasPortalMessage>(
    "publish",
    (context) => {
        if (!context.message.content.ephemeral) return allow();
        context.defer(async () => retract("Transient canvas event"));
        return allow();
    },
);

export default defineConfig({
    channels: {
        "room-*": {
            anonymous: false,
            access: "open",
            onPublish: [retractCanvasTransientMessages],
        },
    },
});
