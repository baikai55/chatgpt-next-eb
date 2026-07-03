import { Anthropic, Google, OpenaiPath } from "../constant";

type CustomProviderProtocol = "openai" | "anthropic" | "google";

type CustomProviderLike = {
  protocol: CustomProviderProtocol;
  chatPath?: string;
};

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
