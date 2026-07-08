import {
  extractCustomProviderModelNames,
  getCustomProviderModelsPath,
  joinCustomProviderUrl,
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
    expect(joinCustomProviderUrl("https://api.example.com/v1", "v1/models")).toBe(
      "https://api.example.com/v1/models",
    );
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
