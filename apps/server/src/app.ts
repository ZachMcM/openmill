import { isConfigKey, parseConfigValue } from "@openmill/core";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import {
  addRequestSchema,
  configSetSchema,
  hookRequestSchema,
  jobListQuerySchema,
  jobQuerySchema,
  notifierTestSchema,
} from "./api.ts";
import { ApiError } from "./errors.ts";
import type { Mill } from "./mill.ts";
import { maskUrl, notifierEntrySchema } from "./notifier-store.ts";
import type { NotifierEntry } from "./notifier/types.ts";

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function validate<Target extends "json" | "query", T extends z.ZodType>(target: Target, schema: T) {
  return validator(target, (value, c) => {
    const parsed = schema.safeParse(value);

    return parsed.success
      ? (parsed.data as z.infer<T>)
      : c.json({ error: issues(parsed.error) }, 400);
  });
}

function masked(entries: NotifierEntry[]) {
  return { notifiers: entries.map((entry) => ({ ...entry, url: maskUrl(entry.url) })) };
}

export interface AppOptions {
  version: string;
  onShutdown: () => void;
}

export function createApp(mill: Mill, { version, onShutdown }: AppOptions) {
  return new Hono()
    .onError((error, c) =>
      c.json({ error: error.message }, error instanceof ApiError ? error.status : 500),
    )
    .get("/status", (c) => c.json({ ...mill.status(), version }))
    .post("/shutdown", (c) => {
      setImmediate(onShutdown);

      return c.json({ ok: true });
    })
    .post("/jobs", validate("json", addRequestSchema), async (c) =>
      c.json({ jobs: await mill.add(c.req.valid("json")) }),
    )
    .get("/jobs", validate("query", jobListQuerySchema), async (c) =>
      c.json(await mill.list(c.req.valid("query"))),
    )
    .get("/jobs/:id", validate("query", jobQuerySchema), async (c) => {
      const job = await mill.resolve(c.req.param("id"), c.req.valid("query").repo);

      return c.json(await mill.show(job));
    })
    .post("/jobs/:id/open", validate("query", jobQuerySchema), async (c) => {
      const job = await mill.resolve(c.req.param("id"), c.req.valid("query").repo);

      await mill.open(job);

      return c.json({ ok: true });
    })
    .post("/jobs/:id/cancel", validate("query", jobQuerySchema), async (c) => {
      const job = await mill.resolve(c.req.param("id"), c.req.valid("query").repo);

      return c.json({ state: await mill.cancel(job) });
    })
    .post("/clean", async (c) => c.json({ closed: await mill.clean() }))
    .post("/hooks/:event", validate("json", hookRequestSchema), async (c) => {
      const { runId, payload } = c.req.valid("json");

      return c.json({ output: await mill.hook(runId, c.req.param("event"), payload) });
    })
    .post("/jobs/:id/requeue", validate("query", jobQuerySchema), async (c) => {
      const job = await mill.resolve(c.req.param("id"), c.req.valid("query").repo);

      return c.json({ state: await mill.requeue(job) });
    })
    .get("/config", (c) => c.json({ config: mill.getConfig() }))
    .put("/config/:key", validate("json", configSetSchema), async (c) => {
      const key = c.req.param("key");
      const { value } = c.req.valid("json");

      if (!isConfigKey(key)) {
        throw new ApiError(400, `unknown config key ${key}`);
      }

      const parsed = parseConfigValue(key, value);

      if (!parsed.ok) {
        throw new ApiError(400, parsed.error);
      }

      return c.json(await mill.setConfig(key, parsed.value));
    })
    .delete("/config/:key", async (c) => {
      const key = c.req.param("key");

      if (!isConfigKey(key)) {
        throw new ApiError(400, `unknown config key ${key}`);
      }

      return c.json(await mill.setConfig(key, undefined));
    })
    .get("/notifiers", (c) => c.json(masked(mill.listNotifiers())))
    .post("/notifiers", validate("json", notifierEntrySchema), async (c) =>
      c.json(masked(await mill.addNotifier(c.req.valid("json")))),
    )
    .delete("/notifiers/:name", async (c) =>
      c.json(masked(await mill.removeNotifier(c.req.param("name")))),
    )
    .post("/notifiers/test", validate("json", notifierTestSchema), async (c) =>
      c.json({ results: await mill.testNotifiers(c.req.valid("json").name) }),
    );
}

export type AppType = ReturnType<typeof createApp>;
