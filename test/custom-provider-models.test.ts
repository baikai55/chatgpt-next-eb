import {
  extractCustomProviderModelNames,
  getCustomProviderModelsPath,
  getOpenAIPathKind,
  joinCustomProviderUrl,
  resolveOpenAIImagePath,
  shouldProxyCustomProvider,
} from "../app/utils/custom-provider";

describe("custom provider model helpers", () => {
  test("should resolve model list paths by protocol", () => {
    expect(getCustomProviderModelsPath("openai")).toBe("v1/models");
    expect(getCustomProviderModelsPath("anthropic")).toBe("v1/models");
    expect(
      getCustomProviderModelsPath(
        "google",
        "v1/models/{model}:streamGenerateContent",
      ),
    ).toBe("v1/models");
  });

  test("should avoid duplicating version path when joining urls", () => {
    expect(
      joinCustomProviderUrl("https://api.example.com/v1", "v1/models"),
    ).toBe("https://api.example.com/v1/models");
  });

  test("should allow custom providers to opt out of server proxy", () => {
    expect(
      shouldProxyCustomProvider({
        protocol: "openai",
        baseUrl: "https://api.example.com",
      }),
    ).toBe(true);
    expect(
      shouldProxyCustomProvider({
        protocol: "openai",
        baseUrl: "https://api.example.com",
        useProxy: false,
      }),
    ).toBe(false);
  });

  test("should route image inputs to the edits endpoint", () => {
    expect(resolveOpenAIImagePath("v1/images/generations", false)).toBe(
      "v1/images/generations",
    );
    expect(resolveOpenAIImagePath("v1/images/generations", true)).toBe(
      "v1/images/edits",
    );
    expect(
      resolveOpenAIImagePath("v1/images/generations?api-version=1", true),
    ).toBe("v1/images/edits?api-version=1");
    expect(getOpenAIPathKind("v1/images/edits")).toBe("images");
  });

  test("should extract openai-compatible model names", () => {
    expect(
      extractCustomProviderModelNames("openai", {
        data: [{ id: "gpt-4o" }, { id: "gpt-4o" }, { name: "custom-model" }],
      }),
    ).toEqual(["custom-model", "gpt-4o"]);
  });

  test("should extract google model names without the models prefix", () => {
    expect(
      extractCustomProviderModelNames("google", {
        models: [{ name: "models/gemini-1.5-pro" }, { name: "gemini-2.0" }],
      }),
    ).toEqual(["gemini-1.5-pro", "gemini-2.0"]);
  });
});
