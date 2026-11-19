import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { exec } from "../exec.ts";
import type { Paths } from "../paths.ts";
import type { Host } from "./types.ts";

const PROVIDER = "openmill";
const NOT_RUNNING = "Start T3 Code";
const MISSING_PROVIDER =
  "Add the openmill Claude provider in T3 Code (run openmill install to see the launch args)";
const REDIRECT_URI = "http://127.0.0.1/openmill";
const DEAD_STATUSES = ["failed", "cancelled", "interrupted"];

const runtimeSchema = z.object({ origin: z.string() });
const pairingSchema = z.object({ credential: z.string() });
const cachedTokenSchema = z.object({
  origin: z.string(),
  token: z.string(),
  expiresAt: z.number(),
});
const failureSchema = z.object({ code: z.string().optional(), message: z.string() });
const toolResultSchema = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
    content: z.array(z.object({ text: z.string().optional() })).optional(),
  }),
});
const capabilitiesSchema = z.object({
  providers: z.array(
    z.object({
      providerInstanceId: z.string(),
      driverKind: z.string(),
      models: z.array(z.object({ id: z.string() })),
    }),
  ),
});
const projectsSchema = z.object({
  projects: z.array(z.object({ id: z.string(), workspaceRoot: z.string() })),
  nextCursor: z.number().nullable(),
});
const threadSchema = z.object({ thread: z.object({ status: z.string() }) });
const launchSchema = z.object({ threadId: z.string() });

class ToolError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

class Unauthorized extends Error {}

export function t3Command(): string {
  const bin = join(homedir(), ".t3", "bin", "t3");

  return existsSync(bin) ? bin : "t3";
}

export function parseRuntimeOrigin(text: string): string {
  return runtimeSchema.parse(JSON.parse(text)).origin;
}

export function threadLink(environmentId: string, threadId: string): string {
  return `https://app.t3.codes/threads/${encodeURIComponent(environmentId.trim())}/${encodeURIComponent(threadId)}`;
}

function userdata(file: string): string {
  return join(process.env.T3CODE_HOME ?? join(homedir(), ".t3"), "userdata", file);
}

async function serverOrigin(): Promise<string> {
  try {
    return parseRuntimeOrigin(await readFile(userdata("server-runtime.json"), "utf8"));
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

async function post(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await post(url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`T3 Code refused ${new URL(url).pathname}: ${await response.text()}`);
  }

  return response.json();
}

// T3 accepts outside MCP clients through OAuth approved with a pairing code, and its own CLI is
// the only way to mint that code without a person in the T3 app.
async function signIn(origin: string): Promise<{ token: string; expiresAt: number }> {
  const code = pairingSchema.parse(
    JSON.parse(
      await exec(
        t3Command(),
        ["auth", "pairing", "create", "--ttl", "5m", "--label", "openmill", "--json"],
        process.cwd(),
      ),
    ),
  ).credential;
  const { client_id: clientId } = z.object({ client_id: z.string() }).parse(
    await postJson(`${origin}/oauth/mcp/register`, {
      client_name: "openmill",
      redirect_uris: [REDIRECT_URI],
    }),
  );
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const resource = `${origin}/mcp`;
  const { redirectTo } = z.object({ redirectTo: z.string() }).parse(
    await postJson(`${origin}/oauth/mcp/decision`, {
      authorization: {
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        state,
        resource,
      },
      decision: { _tag: "pairing-code", access: "full-access", code },
    }),
  );
  const authorizationCode = new URL(redirectTo).searchParams.get("code");

  if (!authorizationCode) {
    throw new Error("T3 Code didn't approve openmill's sign-in");
  }

  const response = await post(`${origin}/oauth/mcp/token`, {
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }),
  });

  if (!response.ok) {
    throw new Error(`T3 Code refused openmill's sign-in: ${await response.text()}`);
  }

  const issued = z
    .object({ access_token: z.string(), expires_in: z.number() })
    .parse(await response.json());

  return { token: issued.access_token, expiresAt: Date.now() + issued.expires_in * 1000 };
}

async function rpc(origin: string, bearer: string, tool: string, args: object) {
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const send = (body: object, session?: string) =>
    post(`${origin}/mcp`, {
      headers: session ? { ...headers, "mcp-session-id": session } : headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
  const init = await send({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "openmill", version: "1" },
    },
  });

  if (init.status === 401) {
    throw new Unauthorized();
  }

  const session = init.headers.get("mcp-session-id") ?? undefined;

  await send({ method: "notifications/initialized" }, session);

  const response = await send(
    { id: 2, method: "tools/call", params: { name: tool, arguments: args } },
    session,
  );
  const reply: unknown = await response.json();

  if (session) {
    await fetch(`${origin}/mcp`, {
      method: "DELETE",
      headers: { authorization: headers.authorization, "mcp-session-id": session },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {});
  }

  const { result } = toolResultSchema.parse(reply);

  if (result.isError) {
    const text = result.content?.find((part) => part.text)?.text ?? `${tool} failed`;
    const failure = text.startsWith("{") ? failureSchema.safeParse(JSON.parse(text)) : undefined;

    throw new ToolError(failure?.data?.message ?? text, failure?.data?.code);
  }

  return result.structuredContent;
}

export function createT3Host(paths: Paths): Host {
  async function token(origin: string, fresh: boolean): Promise<string> {
    if (!fresh) {
      const cached = cachedTokenSchema.safeParse(
        JSON.parse(await readFile(paths.t3Token, "utf8").catch(() => "null")),
      );

      if (cached.success && cached.data.origin === origin && cached.data.expiresAt > Date.now()) {
        return cached.data.token;
      }
    }

    const issued = await signIn(origin);

    await writeFile(paths.t3Token, JSON.stringify({ origin, ...issued }), { mode: 0o600 });

    return issued.token;
  }

  async function call(tool: string, args: object = {}): Promise<unknown> {
    const origin = await serverOrigin();

    try {
      return await rpc(origin, await token(origin, false), tool, args);
    } catch (error) {
      if (!(error instanceof Unauthorized)) {
        throw error;
      }

      return rpc(origin, await token(origin, true), tool, args);
    }
  }

  async function provider() {
    const { providers } = capabilitiesSchema.parse(await call("orchestrator_capabilities"));

    return providers.find(
      (entry) => entry.providerInstanceId === PROVIDER && entry.driverKind === "claudeAgent",
    );
  }

  async function projectFor(repoPath: string): Promise<string> {
    const root = await realpath(repoPath);
    let cursor: number | null = 0;

    while (cursor !== null) {
      const page = projectsSchema.parse(await call("t3_project_list", { cursor, limit: 100 }));

      for (const project of page.projects) {
        if ((await realpath(project.workspaceRoot).catch(() => project.workspaceRoot)) === root) {
          return project.id;
        }
      }

      cursor = page.nextCursor;
    }

    throw new Error(`Add ${repoPath} as a project in T3 Code`);
  }

  return {
    async ready() {
      try {
        return (await provider()) ? { ok: true } : { ok: false, reason: MISSING_PROVIDER };
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }
    },

    async start(input) {
      const projectId = await projectFor(input.repoPath);
      const model = input.model ?? (await provider())?.models[0]?.id;

      return launchSchema.parse(
        await call("t3_thread_launch", {
          projectId,
          title: input.title,
          message: input.prompt,
          runtimeMode: input.permissionMode === "bypass" ? "full-access" : "auto",
          workspaceStrategy: { type: "existing_worktree", worktreePath: input.worktreePath },
          modelSelection: {
            instanceId: PROVIDER,
            model,
            options: [{ id: "effort", value: input.effort }],
          },
        }),
      );
    },

    async send(threadId, message) {
      await call("t3_thread_send", { threadId, message, mode: "queue" });
    },

    async status(threadId) {
      try {
        const { thread } = threadSchema.parse(await call("t3_thread_read", { threadId, limit: 1 }));

        return { alive: !DEAD_STATUSES.includes(thread.status) };
      } catch (error) {
        if (error instanceof ToolError && error.code === "thread_not_found") {
          return { alive: false };
        }

        throw error;
      }
    },

    async stop(threadId) {
      await call("t3_thread_interrupt", { threadId, stop: true });
    },

    async link(threadId) {
      return threadLink(await readFile(userdata("environment-id"), "utf8"), threadId);
    },
  };
}
