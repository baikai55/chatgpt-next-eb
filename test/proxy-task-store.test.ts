import {
  completeProxyTask,
  createProxyTask,
  getProxyTask,
} from "../app/api/proxy-task-store";

describe("proxy task store", () => {
  it("stores a buffered response after a long-running task completes", async () => {
    const taskId = `buffered-image-${Date.now()}`;

    await createProxyTask(taskId, "");
    expect(await getProxyTask(taskId)).toMatchObject({ status: "pending" });

    await completeProxyTask(
      taskId,
      JSON.stringify({ data: [{ b64_json: "image-result" }] }),
      "application/json",
    );

    expect(await getProxyTask(taskId)).toMatchObject({
      status: "complete",
      contentType: "application/json",
      body: JSON.stringify({ data: [{ b64_json: "image-result" }] }),
    });
  });
});
