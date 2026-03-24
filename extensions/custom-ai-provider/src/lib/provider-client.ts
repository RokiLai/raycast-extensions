import { ChatMessage, ChatResponse, ProviderConfig } from "./types";

// 默认超时 30 秒，避免第三方接口长时间无响应时界面一直卡住。
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// 用户可以在设置里额外填写请求头，这个函数负责把文本解析成对象。
// 支持两种写法：JSON 对象，或者每行一个 key:value。
function parseExtraHeaders(raw?: string): Record<string, string> {
  if (!raw?.trim()) {
    return {};
  }

  const value = raw.trim();

  // 如果是 JSON 格式，就直接解析并把所有值强制转成字符串。
  if (value.startsWith("{")) {
    const parsed = JSON.parse(value) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, headerValue]) => [
        key,
        String(headerValue),
      ]),
    );
  }

  // 如果不是 JSON，就按“每行一个请求头”的方式解析。
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // 每一行都必须包含冒号，否则无法拆成 header 名和 header 值。
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`Invalid header line: ${line}`);
      }

      const key = line.slice(0, separatorIndex).trim();
      const headerValue = line.slice(separatorIndex + 1).trim();
      return [key, headerValue] as const;
    });

  return Object.fromEntries(entries);
}

// 把设置里输入的 temperature 文本转成数字。
// 如果没填就返回 undefined，这样请求体里可以不带这个字段。
function parseTemperature(value?: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("Temperature must be a number");
  }

  return parsed;
}

// 把“秒”为单位的超时设置转换成“毫秒”。
// 如果用户没有配置，则回退到默认值 30 秒。
function parseRequestTimeoutMs(value?: string): number {
  if (!value?.trim()) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const timeoutSeconds = Number(value);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("Request Timeout must be a positive number");
  }

  return Math.round(timeoutSeconds * 1000);
}

// 第三方接口报错时，响应体格式可能是 JSON，也可能只是纯文本。
// 这个函数的职责是尽量把原始错误信息整理成更适合展示给用户的一句话。
function formatProviderError(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    return "The provider returned an empty error response.";
  }

  try {
    // 这里优先兼容常见的 OpenAI 风格错误结构。
    const payload = JSON.parse(trimmed) as {
      error?: {
        message?: string;
        type?: string;
        code?: string | number;
      };
      message?: string;
    };

    const message = payload.error?.message ?? payload.message;
    const code = payload.error?.code;
    const type = payload.error?.type;

    if (message) {
      // 如果 error 里还带 type / code，就顺手拼进去，帮助排查问题。
      const details = [type, code].filter(Boolean).join(" / ");
      return details ? `${message} (${details})` : message;
    }
  } catch {
    // Fall back to plain text below.
  }

  // 如果不是 JSON，就把多余换行压成一行，并在太长时做截断。
  const singleLine = trimmed.replace(/\s+/g, " ");
  return singleLine.length > 240
    ? `${singleLine.slice(0, 239)}...`
    : singleLine;
}

// 这是统一的“向第三方 AI 发聊天请求”的函数。
// 上层只需要传 provider 配置和 prompt，不用重复关心 headers、超时和错误处理。
export async function chatWithProvider(params: {
  provider: ProviderConfig;
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  messages?: ChatMessage[];
  signal?: AbortSignal;
}): Promise<ChatResponse> {
  const {
    provider,
    model,
    systemPrompt,
    userPrompt,
    messages: incomingMessages,
    signal,
  } = params;

  // 调用方既可以直接传完整消息数组，也可以只传 systemPrompt + userPrompt。
  // 如果没有传 messages，这里就帮它拼出最基本的一轮对话结构。
  const messages: ChatMessage[] =
    incomingMessages && incomingMessages.length > 0
      ? incomingMessages
      : [
          ...(systemPrompt?.trim()
            ? [{ role: "system" as const, content: systemPrompt.trim() }]
            : []),
          { role: "user", content: userPrompt.trim() },
        ];

  // 这是最终发给第三方服务的请求头。
  // Authorization 默认使用 Bearer token，同时允许用户用 extraHeaders 覆盖或追加。
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...parseExtraHeaders(provider.extraHeaders),
  };

  // 这里把“主动取消请求”和“超时自动取消”合并成一个 signal。
  // 这样 fetch 只需要监听一个中断源。
  const timeoutSignal = AbortSignal.timeout(
    parseRequestTimeoutMs(provider.requestTimeoutSeconds),
  );
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    // 按照常见聊天接口的 body 结构发 POST 请求。
    response = await fetch(provider.baseUrl.trim(), {
      method: "POST",
      headers,
      signal: requestSignal,
      body: JSON.stringify({
        model: model?.trim() || provider.model,
        messages,
        temperature: parseTemperature(provider.temperature),
        stream: false,
      }),
    });
  } catch (error) {
    // fetch 抛出的不同错误类型，在这里统一翻译成更容易理解的提示。
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "The request timed out. Increase Request Timeout or try again.",
      );
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The request was canceled.");
    }

    throw error;
  }

  // 先读取原始文本，后面不管成功还是失败都可能用得上。
  const raw = await response.text();

  // HTTP 状态码不是 2xx 时，拼出更清晰的错误信息抛给上层。
  if (!response.ok) {
    throw new Error(
      `Provider request failed (${response.status}): ${formatProviderError(raw)}`,
    );
  }

  // 这里按 OpenAI 风格响应结构读取 choices[0].message.content。
  const payload = JSON.parse(raw) as {
    model?: string;
    usage?: ChatResponse["usage"];
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();

  // 就算状态码成功，如果正文里拿不到真正的回复内容，也视为失败。
  if (!content) {
    throw new Error("Provider returned an empty response");
  }

  // 返回统一格式的结果，供 UI 层展示和后续排查。
  return {
    content,
    raw,
    model: payload.model,
    usage: payload.usage,
  };
}
