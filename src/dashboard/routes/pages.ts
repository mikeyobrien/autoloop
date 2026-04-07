import { basename } from "node:path";
import type { Hono } from "hono";
import { ALPINE_JS } from "../views/alpine-vendor.js";
import { htmlShell } from "../views/shell.js";

export function pageRoutes(app: Hono, projectDir: string): void {
  const projectName = basename(projectDir);
  app.get("/", (c) => c.html(htmlShell(projectName)));

  app.get("/static/alpine.min.js", (_c) => {
    return new Response(ALPINE_JS, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
