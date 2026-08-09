import { defineConfig } from "@portalsdk/config";

export default defineConfig({
    channels: {
        "room-*": { anonymous: false },
    },
});
