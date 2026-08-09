import { Elysia } from "elysia";
import { createCanvasElementRoute } from "./routes/create-canvas-element.route";
import { deleteCanvasElementRoute } from "./routes/delete-canvas-element.route";
import { getCanvasElementsRoute } from "./routes/get-canvas-elements.route";
import { getPortalTokenRoute } from "./routes/get-portal-token.route";
import { updateCanvasElementRoute } from "./routes/update-canvas-element.route";

export const canvasRouter = new Elysia({ prefix: "/canvas" })
    .use(getCanvasElementsRoute)
    .use(createCanvasElementRoute)
    .use(updateCanvasElementRoute)
    .use(deleteCanvasElementRoute);

export const canvasPortalRouter = new Elysia({ prefix: "/portal" }).use(
    getPortalTokenRoute,
);
