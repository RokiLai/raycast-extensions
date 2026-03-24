// ProviderConfig 描述了一个可调用的 AI 服务需要哪些配置。
// 这些字段大多来自 Raycast 扩展设置，后面发请求时会直接使用。
export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: string;
  temperature?: string;
  requestTimeoutSeconds?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

// ChatMessage 表示一次对话中的单条消息。
// 这里沿用常见的聊天接口格式：system 负责规则，user 是用户输入，assistant 是模型回复。
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ChatResponse 是我们对第三方接口响应结果做的一层统一包装。
// 这样 UI 层不用关心不同返回字段，只需要拿 content 等通用字段即可。
export type ChatResponse = {
  content: string;
  raw: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
