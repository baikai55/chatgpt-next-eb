# Vercel 移动端后台恢复

自定义服务商选择“服务端代理”后，OpenAI 兼容协议的流式请求会生成任务 ID。代理会将完整 SSE 响应暂存 15 分钟；移动端切到其他应用导致连接中断时，页面恢复后会通过任务 ID取回完整结果，不会重新调用模型。

## Vercel 配置

在 Vercel 项目中绑定 Upstash Redis（或 Vercel Marketplace 中兼容的 Redis），并确保自动生成以下任意一组环境变量：

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

或：

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

添加环境变量后需要重新部署。

未配置 Redis 时，Vercel 部署会自动关闭完整恢复功能，普通聊天和已有内容的错误降级仍可正常工作。本地开发环境使用进程内临时缓存。

## 当前范围

- 支持自定义服务商的 OpenAI 兼容协议。
- 仅在选择“服务端代理”且开启流式输出时启用。
- 任务结果保存 15 分钟。
- 浏览器直连无法使用服务端恢复。
