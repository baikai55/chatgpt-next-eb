import { Anthropic, Google, OpenaiPath } from "../constant";
import { getClientConfig } from "../config/client";

type CustomProviderProtocol = "openai" | "anthropic" | "google";

type CustomProviderLike = {
  protocol: CustomProviderProtocol;
  baseUrl?: string;
  chatPath?: string;
};

const CUSTOM_PROVIDER_PROXY_PATH = "/api/proxy";
const HTTP_URL_REGEXP = /^https?:\/\//i;

export const OPENAI_PATH_PRESETS: { label: string; value: string }[] = [
  {
    label: "Chat Completions - /v1/chat/completions",
    value: OpenaiPath.ChatPath,
  },
  {
    label: "Responses - /v1/responses",
    value: "v1/responses",
  },
  {
    label: "Images - /v1/images/generations",
    value: OpenaiPath.ImagePath,
  },
];

export type OpenAIPathKind = "chat" | "responses" | "images";

export function getOpenAIPathKind(path?: string): OpenAIPathKind {
  const normalizedPath = (path || "")
    .trim()
    .replace(/^\/+/, "")
    .split("?")[0]
    .toLowerCase();

  if (normalizedPath === "v1/responses") {
    return "responses";
  }

  if (normalizedPath === "v1/images/generations") {
    return "images";
  }

  return "chat";
}

export function getDefaultCustomProviderChatPath(
  protocol: CustomProviderProtocol,
  model: string = "{model}",
) {
  switch (protocol) {
    case "anthropic":
      return Anthropic.ChatPath;
    case "google":
      return Google.ChatPath(model);
    default:
      return OpenaiPath.ChatPath;
  }
}

export function resolveCustomProviderChatPath(
  provider?: CustomProviderLike,
  model: string = "{model}",
) {
  if (!provider) return undefined;

  const chatPath =
    provider.chatPath?.trim() ||
    getDefaultCustomProviderChatPath(provider.protocol, model);

  return provider.protocol === "google"
    ? chatPath.replaceAll("{model}", model)
    : chatPath;
}

export function normalizeCustomProviderBaseUrl(baseUrl: string = "") {
  let normalizedBaseUrl = baseUrl.trim();

  if (normalizedBaseUrl.endsWith("/")) {
    normalizedBaseUrl = normalizedBaseUrl.replace(/\/+$/, "");
  }

  if (
    normalizedBaseUrl &&
    !normalizedBaseUrl.startsWith("/") &&
    !HTTP_URL_REGEXP.test(normalizedBaseUrl)
  ) {
    normalizedBaseUrl = `https://${normalizedBaseUrl}`;
  }

  return normalizedBaseUrl;
}

export function shouldProxyCustomProvider(provider?: CustomProviderLike) {
  if (!provider) return false;
  if (getClientConfig()?.isApp) return false;

  return HTTP_URL_REGEXP.test(normalizeCustomProviderBaseUrl(provider.baseUrl));
}

export function getCustomProviderProxyPath(path: string) {
  return `${CUSTOM_PROVIDER_PROXY_PATH}/${path.replace(/^\/+/, "")}`;
}
