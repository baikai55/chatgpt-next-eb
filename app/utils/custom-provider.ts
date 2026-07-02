import { Anthropic, Google, OpenaiPath } from "../constant";

type CustomProviderProtocol = "openai" | "anthropic" | "google";

type CustomProviderLike = {
  protocol: CustomProviderProtocol;
  chatPath?: string;
};

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
