import type { RequestMessage } from "@/app/client/api";

type ImageContentPreprocessor = (
  content: RequestMessage["content"],
) => Promise<RequestMessage["content"]>;

const keepImageContent: ImageContentPreprocessor = async (content) => content;

export async function getImageGenerationInput(
  messages: RequestMessage[],
  preprocess: ImageContentPreprocessor = keepImageContent,
): Promise<string | string[] | undefined> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) return undefined;

  const content = await preprocess(lastMessage.content);
  if (!Array.isArray(content)) return undefined;

  const images = content
    .filter((part) => part.type === "image_url")
    .map((part) => part.image_url?.url ?? "")
    .filter(Boolean);

  if (images.length === 0) return undefined;
  return images.length === 1 ? images[0] : images;
}
