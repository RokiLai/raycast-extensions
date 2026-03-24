import { getPreferenceValues } from "@raycast/api";
import { ProviderConfig } from "./types";

// 这里定义的是 Raycast 设置页里会读到的原始字段类型。
// 注意这些值一开始都是字符串，因为设置面板返回的就是文本输入结果。
type TranslatorPreferences = {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: string;
  temperature?: string;
  requestTimeoutSeconds?: string;
};

// 这个函数负责把 Raycast 设置里的原始字符串，整理成程序内部统一使用的 ProviderConfig。
// 如果关键字段没填，就返回 undefined，让上层界面决定如何提示用户。
export function getConfiguredProvider(): ProviderConfig | undefined {
  const preferences = getPreferenceValues<TranslatorPreferences>();

  // trim() 的作用是去掉首尾空格，避免用户不小心多输入空格导致校验失败。
  const providerName = preferences.providerName.trim();
  const baseUrl = preferences.baseUrl.trim();
  const apiKey = preferences.apiKey.trim();
  const model = preferences.model.trim();

  // 这里的含义是：只要有一个必填项为空，就视为“尚未完成配置”。
  if (!providerName || !baseUrl || !apiKey || !model) {
    return undefined;
  }

  // 这里主动校验 URL 格式。
  // 如果 baseUrl 非法，会直接抛错；上层命令会把这个错误转成更友好的配置提示。
  new URL(baseUrl);

  // 这个项目目前没有把配置持久化到数据库里，所以这里临时生成时间戳，
  // 只是为了补齐 ProviderConfig 需要的 createdAt / updatedAt 字段。
  const now = new Date().toISOString();

  return {
    id: "settings-provider",
    name: providerName,
    baseUrl,
    apiKey,
    model,
    extraHeaders: preferences.extraHeaders?.trim() ?? "",
    temperature: preferences.temperature?.trim() ?? "",
    requestTimeoutSeconds: preferences.requestTimeoutSeconds?.trim() ?? "",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}
