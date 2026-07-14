const TASK_TTL_SECONDS = 15 * 60;
const TASK_KEY_PREFIX = "nextchat:proxy-task:";

export type ProxyTask = {
  status: "pending" | "complete" | "error";
  contentType: string;
  body?: string;
  error?: string;
  updatedAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __proxyTaskStore?: Map<string, ProxyTask>;
};
const memoryTasks = (globalStore.__proxyTaskStore ??= new Map<
  string,
  ProxyTask
>());

function getRedisConfig() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

async function redisCommand(command: Array<string | number>) {
  const config = getRedisConfig();
  if (!config) {
    if (process.env.VERCEL) {
      throw new Error("Vercel KV or Upstash Redis is not configured");
    }
    return undefined;
  }
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Redis request failed: ${response.status}`);
  return (await response.json()) as { result?: string | null; error?: string };
}

async function saveTask(id: string, task: ProxyTask) {
  const result = await redisCommand([
    "SET",
    TASK_KEY_PREFIX + id,
    JSON.stringify(task),
    "EX",
    TASK_TTL_SECONDS,
  ]);
  if (!result) memoryTasks.set(id, task);
}

export async function createProxyTask(id: string, contentType: string) {
  await saveTask(id, {
    status: "pending",
    contentType,
    updatedAt: Date.now(),
  });
}

export async function completeProxyTask(id: string, body: string) {
  const task = await getProxyTask(id);
  if (!task) return;
  await saveTask(id, {
    ...task,
    status: "complete",
    body,
    updatedAt: Date.now(),
  });
}

export async function failProxyTask(id: string, error: unknown) {
  const task = await getProxyTask(id);
  if (!task) return;
  await saveTask(id, {
    ...task,
    status: "error",
    error: error instanceof Error ? error.message : String(error),
    updatedAt: Date.now(),
  });
}

export async function getProxyTask(id: string) {
  const result = await redisCommand(["GET", TASK_KEY_PREFIX + id]);
  if (!result) return memoryTasks.get(id);
  if (!result.result) return undefined;
  return JSON.parse(result.result) as ProxyTask;
}
