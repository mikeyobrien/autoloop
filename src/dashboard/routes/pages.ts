import type { Hono } from "hono";
import { htmlShell } from "../views/shell.js";
import { ALPINE_JS } from "../views/alpine-vendor.js";

export function pageRoutes(app: Hono): void {
  app.get("/", (c) => c.html(htmlShell()));

  app.get("/static/alpine.min.js", (c) => {
    return new Response(ALPINE_JS, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
