"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  OPENAI_BASE_URL,
  DEFAULT_MODELS,
  OpenaiPath,
  Azure,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} from "@/app/constant";
import {
  ChatMessageTool,
  useAccessStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
} from "@/app/store";
import { collectModelsWithDefaultModel } from "@/app/utils/model";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  streamWithThink,
} from "@/app/utils/chat";
import {
  getImageGenerationInput,
  resolveImageGenerationSize,
} from "@/app/utils/image-generation";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import { ModelSize, DalleQuality, DalleStyle } from "@/app/typing";

import {
  ChatOptions,
  getHeaders,
  joinBaseUrlPath,
  LLMApi,
  LLMModel,
  LLMUsage,
  MultimodalContent,
  SpeechOptions,
} from "../api";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import type { CustomProvider } from "@/app/store/access";
import {
  getMessageTextContent,
  isVisionModel,
  isDalle3 as _isDalle3,
  getTimeoutMSByModel,
} from "@/app/utils";
import {
  fetch,
  shouldRecoverProxyTask,
  waitForProxyTask,
} from "@/app/utils/stream";
import {
  getCustomProviderProxyPath,
  getOpenAIPathKind,
  resolveCustomProviderChatPath,
  resolveOpenAIImagePath,
  shouldProxyCustomProvider,
} from "@/app/utils/custom-provider";
import { createProxyTaskId } from "@/app/utils/stream";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export interface RequestPayload {
  messages: {
    role: "developer" | "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  model: string;
  temperature: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_p: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface ImageGenerationRequestPayload {
  model: string;
  prompt: string;
  image?: string | string[];
  n: number;
  size: ModelSize;
  response_format?: "url" | "b64_json";
  quality?: DalleQuality;
  style?: DalleStyle;
}

export interface DalleRequestPayload extends ImageGenerationRequestPayload {
  response_format: "url" | "b64_json";
  quality: DalleQuality;
  style: DalleStyle;
}

export interface ResponsesRequestPayload {
  model: string;
  input:
    | string
    | Array<{
        role: "user" | "assistant";
        content: string;
      }>;
  instructions?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
}

type OpenAIRequestPayload =
  | RequestPayload
  | ImageGenerationRequestPayload
  | ResponsesRequestPayload;

function getPromptFromMessages(messages: ChatOptions["messages"]) {
  const lastMessage = messages.slice(-1)?.pop();
  const lastText = lastMessage
    ? getMessageTextContent(lastMessage as any).trim()
    : "";

  return (
    lastText ||
    messages
      .map((message) => getMessageTextContent(message as any).trim())
      .filter(Boolean)
      .join("\n\n")
  );
}

function extractResponsesOutputText(res: any) {
  if (typeof res.output_text === "string") {
    return res.output_text;
  }

  const outputText = res.output
    ?.flatMap((output: any) => output.content ?? [])
    ?.map((content: any) => content.text ?? "")
    ?.filter(Boolean)
    ?.join("");

  return outputText || "";
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = true;
  private customProviderConfig?: CustomProvider;

  constructor(customProviderConfig?: CustomProvider) {
    this.customProviderConfig = customProviderConfig;
  }

  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (this.customProviderConfig) {
      baseUrl = this.customProviderConfig.baseUrl;
    } else {
      const isAzure = path.includes("deployments");
      if (accessStore.useCustomConfig) {
        if (isAzure && !accessStore.isValidAzure()) {
          throw Error(
            "incomplete azure config, please check it in your settings page",
          );
        }

        baseUrl = isAzure ? accessStore.azureUrl : accessStore.openaiUrl;
      }

      if (baseUrl.length === 0) {
        const isApp = !!getClientConfig()?.isApp;
        const apiPath = isAzure ? ApiPath.Azure : ApiPath.OpenAI;
        baseUrl = isApp ? OPENAI_BASE_URL : apiPath;
      }
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith("/")) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    if (
      this.customProviderConfig &&
      shouldProxyCustomProvider(this.customProviderConfig)
    ) {
      return getCustomProviderProxyPath(path);
    }

    // try rebuild url, when using cloudflare ai gateway in client
    return cloudflareAIGatewayUrl(joinBaseUrlPath(baseUrl, path));
  }

  async extractMessage(res: any) {
    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (!url && b64_json) {
        // uploadImage
        url = await uploadImage(base64Image2Blob(b64_json, "image/png"));
      }
      return [
        {
          type: "image_url",
          image_url: {
            url,
          },
        },
      ];
    }
    const responsesOutputText = extractResponsesOutputText(res);
    if (responsesOutputText) {
      return responsesOutputText;
    }
    return res.choices?.at(0)?.message?.content ?? res;
  }

  async speech(options: SpeechOptions): Promise<ArrayBuffer> {
    const requestPayload = {
      model: options.model,
      input: options.input,
      voice: options.voice,
      response_format: options.response_format,
      speed: options.speed,
    };

    console.log("[Request] openai speech payload: ", requestPayload);

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const speechPath = this.path(OpenaiPath.SpeechPath);
      const headers = getHeaders(
        false,
        this.customProviderConfig?.name ?? ServiceProvider.OpenAI,
      );
      const speechPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers,
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const res = await fetch(speechPath, speechPayload);
      clearTimeout(requestTimeoutId);
      return await res.arrayBuffer();
    } catch (e) {
      console.log("[Request] failed to make a speech request", e);
      throw e;
    }
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const isDalle3 = _isDalle3(options.config.model);
    const isO1OrO3 =
      options.config.model.startsWith("o1") ||
      options.config.model.startsWith("o3") ||
      options.config.model.startsWith("o4-mini");
    const isGpt5 = options.config.model.startsWith("gpt-5");
    const customProviderChatPath = resolveCustomProviderChatPath(
      this.customProviderConfig,
      modelConfig.model,
    );
    const customPathKind = this.customProviderConfig
      ? getOpenAIPathKind(customProviderChatPath)
      : "chat";
    const requestKind =
      customPathKind === "responses"
        ? "responses"
        : customPathKind === "images" || isDalle3
        ? "images"
        : "chat";

    let requestPayload: OpenAIRequestPayload;
    let imageGenerationInput: string | string[] | undefined;

    if (requestKind === "images") {
      const prompt = getPromptFromMessages(options.messages);
      imageGenerationInput = await getImageGenerationInput(
        options.messages,
        preProcessImageContent,
      );
      const imagePayload: ImageGenerationRequestPayload = {
        model: options.config.model,
        prompt,
        image: imageGenerationInput,
        n: 1,
        size: resolveImageGenerationSize(
          options.config.model,
          options.config?.size,
        ),
      };

      if (isDalle3) {
        // URLs are only valid for 60 minutes after the image has been generated.
        imagePayload.response_format = "b64_json"; // using b64_json, and save image in CacheStorage
        imagePayload.quality = options.config?.quality ?? "standard";
        imagePayload.style = options.config?.style ?? "vivid";
      }

      requestPayload = imagePayload;
    } else {
      const visionModel = isVisionModel(options.config.model);
      const messages: ChatOptions["messages"] = [];
      for (const v of options.messages) {
        const content = await preProcessImageContent(v.content);
        if (!(isO1OrO3 && v.role === "system"))
          messages.push({ role: v.role, content });
      }

      // O1 not support image, tools (plugin in ChatGPTNextWeb) and system, stream, logprobs, temperature, top_p, n, presence_penalty, frequency_penalty yet.
      if (requestKind === "responses") {
        const instructions = messages
          .filter((message) => message.role === "system")
          .map((message) => getMessageTextContent(message as any).trim())
          .filter(Boolean)
          .join("\n\n");
        const inputMessages: Array<{
          role: "user" | "assistant";
          content: string;
        }> = messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: (message.role === "assistant" ? "assistant" : "user") as
              | "user"
              | "assistant",
            content: getMessageTextContent(message as any).trim(),
          }))
          .filter((message) => message.content.length > 0);

        requestPayload = {
          model: modelConfig.model,
          input: inputMessages.length
            ? inputMessages
            : getPromptFromMessages(options.messages),
          instructions: instructions || undefined,
          stream: options.config.stream,
          temperature: !isO1OrO3 && !isGpt5 ? modelConfig.temperature : 1,
          top_p: !isO1OrO3 ? modelConfig.top_p : 1,
          max_output_tokens: modelConfig.max_tokens,
        };
      } else {
        const chatRequestPayload: RequestPayload = {
          messages,
          stream: options.config.stream,
          model: modelConfig.model,
          temperature: !isO1OrO3 && !isGpt5 ? modelConfig.temperature : 1,
          presence_penalty: !isO1OrO3 ? modelConfig.presence_penalty : 0,
          frequency_penalty: !isO1OrO3 ? modelConfig.frequency_penalty : 0,
          top_p: !isO1OrO3 ? modelConfig.top_p : 1,
          // max_tokens: Math.max(modelConfig.max_tokens, 1024),
          // Please do not ask me why not send max_tokens, no reason, this param is just shit, I dont want to explain anymore.
        };

        if (isGpt5) {
          // Remove max_tokens if present
          delete chatRequestPayload.max_tokens;
          // Add max_completion_tokens (or max_completion_tokens if that's what you meant)
          chatRequestPayload.max_completion_tokens = modelConfig.max_tokens;
        } else if (isO1OrO3) {
          // by default the o1/o3 models will not attempt to produce output that includes markdown formatting
          // manually add "Formatting re-enabled" developer message to encourage markdown inclusion in model responses
          // (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning?tabs=python-secure#markdown-output)
          chatRequestPayload.messages.unshift({
            role: "developer",
            content: "Formatting re-enabled",
          });

          // o1/o3 uses max_completion_tokens to control the number of tokens (https://platform.openai.com/docs/guides/reasoning#controlling-costs)
          chatRequestPayload.max_completion_tokens = modelConfig.max_tokens;
        }

        // add max_tokens to vision model
        if (visionModel && !isO1OrO3 && !isGpt5) {
          chatRequestPayload.max_tokens = Math.max(
            modelConfig.max_tokens,
            4000,
          );
        }

        requestPayload = chatRequestPayload;
      }
    }

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = requestKind !== "images" && !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);
    const requestTimeoutMs = getTimeoutMSByModel(options.config.model, {
      longRunning: requestKind === "images",
    });

    try {
      const headers = getHeaders(false, options.config.providerName);
      let chatPath = "";
      if (modelConfig.providerName === ServiceProvider.Azure) {
        // find model, and get displayName as deployName
        const { models: configModels, customModels: configCustomModels } =
          useAppConfig.getState();
        const {
          defaultModel,
          customModels: accessCustomModels,
          useCustomConfig,
        } = useAccessStore.getState();
        const models = collectModelsWithDefaultModel(
          configModels,
          [configCustomModels, accessCustomModels].join(","),
          defaultModel,
        );
        const model = models.find(
          (model) =>
            model.name === modelConfig.model &&
            model?.provider?.providerName === ServiceProvider.Azure,
        );
        chatPath = this.path(
          (isDalle3 ? Azure.ImagePath : Azure.ChatPath)(
            (model?.displayName ?? model?.name) as string,
            useCustomConfig ? useAccessStore.getState().azureApiVersion : "",
          ),
        );
      } else {
        const defaultPath =
          requestKind === "images" ? OpenaiPath.ImagePath : OpenaiPath.ChatPath;
        const customPath =
          this.customProviderConfig && customPathKind === requestKind
            ? customProviderChatPath
            : undefined;
        const imagePath = resolveOpenAIImagePath(
          customPath || defaultPath,
          !!imageGenerationInput,
        );
        chatPath = this.path(
          requestKind === "chat"
            ? customProviderChatPath || defaultPath
            : requestKind === "images"
            ? imagePath
            : customPath || defaultPath,
        );
      }
      let imageProxyTaskId: string | undefined;
      if (chatPath.startsWith("/api/proxy/") && shouldStream) {
        headers["X-Proxy-Task-ID"] = createProxyTaskId();
      } else if (
        chatPath.startsWith("/api/proxy/") &&
        requestKind === "images"
      ) {
        imageProxyTaskId = createProxyTaskId();
        headers["X-Proxy-Task-ID"] = imageProxyTaskId;
        headers["X-Proxy-Task-Mode"] = "buffered";
      }
      if (shouldStream) {
        if (requestKind === "responses") {
          streamWithThink(
            chatPath,
            requestPayload,
            headers,
            [],
            {},
            controller,
            (text: string) => {
              const json = JSON.parse(text);
              const type = json.type as string | undefined;

              if (
                type === "response.output_text.delta" ||
                type === "response.refusal.delta"
              ) {
                return {
                  isThinking: false,
                  content: json.delta ?? "",
                };
              }

              if (
                type === "response.reasoning_summary_text.delta" ||
                type === "response.reasoning.delta"
              ) {
                return {
                  isThinking: true,
                  content: json.delta ?? "",
                };
              }

              if (typeof json.output_text === "string") {
                return {
                  isThinking: false,
                  content: json.output_text,
                };
              }

              return {
                isThinking: false,
                content: "",
              };
            },
            () => {},
            options,
            requestTimeoutMs,
          );
          return;
        }

        let index = -1;
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        // console.log("getAsTools", tools, funcs);
        streamWithThink(
          chatPath,
          requestPayload,
          headers,
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                index += 1;
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }

            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // reset index value
            index = -1;
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
          requestTimeoutMs,
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers,
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          requestTimeoutMs,
        );

        let res: Response;
        try {
          res = await fetch(chatPath, chatPayload);
        } catch (error) {
          if (!imageProxyTaskId) throw error;
          const body = await waitForProxyTask(
            imageProxyTaskId,
            chatPath,
            requestTimeoutMs,
          );
          res = new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } finally {
          clearTimeout(requestTimeoutId);
        }

        if (imageProxyTaskId && shouldRecoverProxyTask(res.status)) {
          const body = await waitForProxyTask(
            imageProxyTaskId,
            chatPath,
            requestTimeoutMs,
          );
          res = new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        const resJson = await res.json();
        const message = await this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(
            false,
            this.customProviderConfig?.name ?? ServiceProvider.OpenAI,
          ),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(
          false,
          this.customProviderConfig?.name ?? ServiceProvider.OpenAI,
        ),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(
          false,
          this.customProviderConfig?.name ?? ServiceProvider.OpenAI,
        ),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter(
      (m) => m.id.startsWith("gpt-") || m.id.startsWith("chatgpt-"),
    );
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    //由于目前 OpenAI 的 disableListModels 默认为 true，所以当前实际不会运行到这场
    let seq = 1000; //同 Constant.ts 中的排序保持一致
    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      sorted: seq++,
      provider: {
        id: "openai",
        providerName: "OpenAI",
        providerType: "openai",
        sorted: 1,
      },
    }));
  }
}
export { OpenaiPath };
