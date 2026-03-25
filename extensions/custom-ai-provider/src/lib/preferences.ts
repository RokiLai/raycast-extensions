import { getPreferenceValues } from "@raycast/api";
import { ProviderConfig } from "./types";

// 这个函数负责把 Raycast 设置里的原始字符串，整理成程序内部统一使用的 ProviderConfig。
// 如果关键字段没填，就返回 undefined，让上层界面决定如何提示用户。
export function getConfiguredProvider(): ProviderConfig | undefined {
  // 这里直接使用 Raycast 根据 package.json 自动生成的 Preferences 类型，
  // 这样设置项一旦有增删改，就不会因为手写类型忘记同步而漂移。
  const preferences = getPreferenceValues<Preferences>();

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
