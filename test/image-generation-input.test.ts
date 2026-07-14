import { getImageGenerationInput } from "../app/utils/image-generation";

describe("image generation input", () => {
  test("uses only the latest message image", async () => {
    const image = await getImageGenerationInput([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,old" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "edit this image" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,new" },
          },
        ],
      },
    ]);

    expect(image).toBe("data:image/png;base64,new");
  });

  test("keeps multiple images as an array", async () => {
    const image = await getImageGenerationInput([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "https://example.com/1.png" },
          },
          {
            type: "image_url",
            image_url: { url: "https://example.com/2.png" },
          },
        ],
      },
    ]);

    expect(image).toEqual([
      "https://example.com/1.png",
      "https://example.com/2.png",
    ]);
  });

  test("omits image input when the latest message has no image", async () => {
    const image = await getImageGenerationInput([
      { role: "user", content: "draw a landscape" },
    ]);

    expect(image).toBeUndefined();
  });
});
