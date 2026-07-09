import {
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_LONG_TASK,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
} from "../app/constant";
import { getTimeoutMSByModel, isLongRunningGenerationModel } from "../app/utils";

describe("request timeout by model", () => {
  it("keeps regular chat models at the default timeout", () => {
    expect(getTimeoutMSByModel("gpt-4o-mini")).toBe(REQUEST_TIMEOUT_MS);
  });

  it("keeps reasoning models on the thinking timeout", () => {
    expect(getTimeoutMSByModel("deepseek-r1")).toBe(
      REQUEST_TIMEOUT_MS_FOR_THINKING,
    );
  });

  it("uses the long task timeout for image generation models on chat endpoints", () => {
    expect(isLongRunningGenerationModel("gpt-4o-image")).toBe(true);
    expect(getTimeoutMSByModel("gpt-4o-image")).toBe(
      REQUEST_TIMEOUT_MS_FOR_LONG_TASK,
    );
    expect(getTimeoutMSByModel("imagen-4")).toBe(
      REQUEST_TIMEOUT_MS_FOR_LONG_TASK,
    );
  });

  it("uses the long task timeout for explicit image endpoint requests", () => {
    expect(getTimeoutMSByModel("custom-model", { longRunning: true })).toBe(
      REQUEST_TIMEOUT_MS_FOR_LONG_TASK,
    );
  });
});
