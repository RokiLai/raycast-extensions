import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  Toast,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { chatWithProvider } from "./lib/provider-client";
import { ProviderConfig } from "./lib/types";
import {
  buildTranslationPrompt,
  parseBilingualTranslation,
  TRANSLATION_SYSTEM_PROMPT,
} from "./lib/translator";
import { getConfiguredProvider } from "./lib/preferences";

// Raycast 允许命令在启动时接收上下文。
// 这里我们只关心一种上下文：从别的命令传进来的 selectedText。
type TranslatorLaunchContext = {
  selectedText?: string;
};

// 这个函数负责安全地读取 provider 配置。
// 如果配置读取过程抛错，就把错误内容包装成 configError，交给 UI 统一展示。
function resolveProviderConfig(): {
  provider?: ProviderConfig;
  configError?: string;
} {
  try {
    return { provider: getConfiguredProvider() };
  } catch (error) {
    return {
      configError:
        error instanceof Error ? error.message : "Invalid provider settings",
    };
  }
}

// 把当前翻译状态渲染成 Markdown 文本，供右侧详情面板显示。
// 这里把“空状态、成功状态、加载中、报错”都统一组织成一份 markdown。
function renderTranslatorMarkdown(params: {
  provider?: ProviderConfig;
  sourceText: string;
  translatedText: string;
  isTranslating: boolean;
  lastError?: string;
  configError?: string;
}) {
  const {
    provider,
    sourceText,
    translatedText,
    isTranslating,
    lastError,
    configError,
  } = params;

  // 没有 provider 时，优先展示配置错误；否则提示用户先去配置。
  if (!provider) {
    return configError
      ? `# Provider configuration error\n\n${configError}`
      : "# Configure a provider first";
  }

  // 把模型返回的文本尽量拆成中英双语，便于分别展示和复制。
  const { chinese, english } = parseBilingualTranslation(translatedText);
  const sections: string[] = [];

  // 初始状态下，如果既没有输入也没有结果，就展示最基础的操作提示。
  if (!sourceText.trim() && !translatedText.trim()) {
    sections.push(
      "Type text in the search bar above and press Enter to translate.",
    );
  } else {
    // 如果能成功拆出中英两段，就分区显示；否则按单段翻译结果展示。
    if (chinese || english) {
      sections.push(`## Chinese\n\n${chinese || "-"}`);
      sections.push(`## English\n\n${english || "-"}`);
    } else if (translatedText.trim()) {
      sections.push(`## Translation\n\n${translatedText}`);
    }
  }

  // 翻译进行中时，在详情区追加一条状态提示。
  if (isTranslating) {
    sections.push("Translating...");
  }

  // 请求报错时，把错误原文包进代码块，便于阅读和复制。
  if (lastError) {
    sections.push(`\`\`\`\n${lastError}\n\`\`\``);
  }

  return sections.join("\n\n---\n\n");
}

// 这是 Raycast 命令的主组件。
// 它负责管理输入文本、请求状态、翻译结果，以及界面上的所有交互行为。
export default function Command(
  props: LaunchProps<{ launchContext?: TranslatorLaunchContext }>,
) {
  // requestIdRef 用来标记“当前最新的一次请求”。
  // 如果较早发出的请求后来才返回，我们可以用它来忽略过期结果，避免界面被旧数据覆盖。
  const requestIdRef = useRef(0);

  // abortControllerRef 保存当前请求的取消器。
  // 当用户再次发起翻译时，我们会先取消上一次尚未完成的请求。
  const abortControllerRef = useRef<AbortController | null>(null);

  // 如果命令是从“翻译选中文本”跳转过来的，这里会拿到初始文本。
  const initialSelectedText = props.launchContext?.selectedText?.trim() ?? "";

  // 用这个标记避免初始自动翻译被重复触发。
  const hasAutoTranslatedRef = useRef(false);

  // sourceText 是搜索框里正在编辑的文本。
  const [sourceText, setSourceText] = useState(initialSelectedText);

  // activeSourceText 记录“真正已提交翻译”的文本。
  // 这样即使用户继续修改输入框，也不会影响当前结果对应的原文。
  const [activeSourceText, setActiveSourceText] = useState("");

  // translatedText 存储模型返回的翻译结果。
  const [translatedText, setTranslatedText] = useState("");

  // lastError 存储最近一次请求失败的错误信息，展示在详情面板里。
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // isTranslating 用来控制加载状态和提示文案。
  const [isTranslating, setIsTranslating] = useState(false);

  // 配置读取只需要在组件初始化时做一次，所以放进 useMemo。
  const { provider: selectedProvider, configError } = useMemo(
    () => resolveProviderConfig(),
    [],
  );

  // 为了支持“单独复制中文/英文”，这里先把结果拆成两个字段。
  const { chinese, english } = parseBilingualTranslation(translatedText);

  // 把当前所有状态整理成 markdown，供详情面板复用。
  const translatorMarkdown = renderTranslatorMarkdown({
    provider: selectedProvider,
    sourceText: activeSourceText,
    translatedText,
    isTranslating,
    lastError,
    configError,
  });

  // 真正执行翻译请求的核心函数。
  // overrideSourceText 用于“外部传入文本后立即翻译”的场景；不传时就默认使用输入框里的内容。
  async function handleTranslate(overrideSourceText?: string) {
    const trimmedSourceText = (overrideSourceText ?? sourceText).trim();

    // 没配置 provider 时，不继续发请求，而是直接提示用户先去设置。
    if (!selectedProvider) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Provider not found",
        message:
          "Open the extension settings and configure your provider first.",
      });
      return;
    }

    // 输入为空时直接拦截，避免发出无意义请求。
    if (!trimmedSourceText) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Text is empty",
        message: "Enter text before translating.",
      });
      return;
    }

    // 每次新请求都生成新的 requestId，并取消旧请求。
    // 这是处理“用户连续多次点击翻译”时最重要的防抖保护。
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 请求开始前，先更新界面状态，清空旧结果和旧错误。
    setActiveSourceText(trimmedSourceText);
    setTranslatedText("");
    setLastError(undefined);
    setIsTranslating(true);

    try {
      // 这里调用底层 provider-client，把拼好的翻译提示词发给第三方 AI。
      const result = await chatWithProvider({
        provider: selectedProvider,
        userPrompt: buildTranslationPrompt(trimmedSourceText),
        signal: abortController.signal,
      });

      // 如果当前结果已经不是最新请求，就直接丢弃，避免旧结果覆盖新结果。
      if (requestId !== requestIdRef.current) {
        return;
      }

      setTranslatedText(result.content);
    } catch (error) {
      // 同理，如果错误属于过期请求，也不再更新界面。
      if (requestId !== requestIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      // 用户主动取消请求时，不需要再额外弹失败提示。
      if (message === "The request was canceled.") {
        return;
      }

      setLastError(message);
      await showToast({
        style: Toast.Style.Failure,
        title: "Request failed",
        message,
      });
    } finally {
      // 只有“当前仍是最新请求”时，才收尾清理 loading 状态。
      if (requestId === requestIdRef.current) {
        abortControllerRef.current = null;
        setIsTranslating(false);
      }
    }
  }

  // 如果命令启动时就带了 selectedText，这里会自动触发一次翻译。
  // hasAutoTranslatedRef 的作用是防止 React 重新渲染时重复发请求。
  useEffect(() => {
    if (!initialSelectedText || hasAutoTranslatedRef.current) {
      return;
    }

    hasAutoTranslatedRef.current = true;
    void handleTranslate(initialSelectedText);
  }, [initialSelectedText, selectedProvider]);

  // 统一处理复制动作。
  // 传入不同内容和标签，就能复用到“复制全部 / 复制中文 / 复制英文”三个按钮。
  async function handleCopyText(value: string, label: string) {
    if (!value.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: `No ${label.toLowerCase()} yet`,
        message: "Translate something first.",
      });
      return;
    }

    await Clipboard.copy(value);
    await showToast({
      style: Toast.Style.Success,
      title: `${label} copied`,
    });
  }

  // 清空当前输入、结果和错误，回到初始状态。
  function handleClear() {
    setSourceText("");
    setActiveSourceText("");
    setTranslatedText("");
    setLastError(undefined);
  }

  // 这里开始渲染整个列表界面。
  // Raycast 的 List 同时承担“输入框 + 列表项 + 右侧详情面板”的职责。
  return (
    <List
      filtering={false}
      isShowingDetail
      navigationTitle="AI Translator"
      selectedItemId="translation"
      searchText={sourceText}
      onSearchTextChange={setSourceText}
      searchBarPlaceholder="Type text to translate into Chinese and English"
    >
      {/* 如果没有可用 provider，就显示空状态页面，引导用户先去配置。 */}
      {!selectedProvider ? (
        <List.EmptyView
          icon={Icon.Message}
          title={
            configError
              ? "Provider Configuration Error"
              : "Provider Not Configured"
          }
          description={
            configError
              ? "Open the extension settings and fix the provider configuration."
              : "Open the extension settings, fill in your provider info, and then come back here to start translating."
          }
        />
      ) : (
        <>
          {/* 这是主结果项，右侧详情区会展示翻译内容和错误信息。 */}
          <List.Item
            id="translation"
            title={selectedProvider.model}
            subtitle={selectedProvider.name}
            accessories={[{ tag: "Dual" }]}
            detail={<List.Item.Detail markdown={translatorMarkdown} />}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  {/* 手动触发翻译。默认快捷键是回车。 */}
                  <Action
                    title="Translate"
                    icon={Icon.ArrowRight}
                    shortcut={Keyboard.Shortcut.Common.Open}
                    onAction={() => {
                      void handleTranslate();
                    }}
                  />
                  {/* 复制完整翻译结果。 */}
                  <Action
                    title="Copy Translation"
                    icon={Icon.Clipboard}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                    onAction={() => {
                      void handleCopyText(translatedText, "Translation");
                    }}
                  />
                  {/* 只复制中文部分。 */}
                  <Action
                    title="Copy Chinese"
                    icon={Icon.Text}
                    onAction={() => {
                      void handleCopyText(chinese ?? "", "Chinese");
                    }}
                  />
                  {/* 只复制英文部分。 */}
                  <Action
                    title="Copy English"
                    icon={Icon.Text}
                    onAction={() => {
                      void handleCopyText(english ?? "", "English");
                    }}
                  />
                  {/* 清空当前界面状态。 */}
                  <Action
                    title="Clear"
                    icon={Icon.XMarkCircle}
                    shortcut={Keyboard.Shortcut.Common.New}
                    onAction={handleClear}
                  />
                  {/* 直接跳到扩展设置，方便修改 provider。 */}
                  <Action
                    title="Open Settings"
                    icon={Icon.Gear}
                    onAction={() => {
                      void openExtensionPreferences();
                    }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
          {/* 下面这组列表项主要是“把当前配置展示出来”，方便用户确认自己正在使用什么设置。 */}
          <List.Section title="Config">
            <List.Item
              id="provider"
              title="Provider"
              subtitle={selectedProvider.name}
              detail={<List.Item.Detail markdown={translatorMarkdown} />}
            />
            <List.Item
              id="model"
              title="Model"
              subtitle={selectedProvider.model}
              detail={<List.Item.Detail markdown={translatorMarkdown} />}
            />
            <List.Item
              id="system-prompt"
              title="System Prompt"
              subtitle={TRANSLATION_SYSTEM_PROMPT}
              detail={<List.Item.Detail markdown={translatorMarkdown} />}
            />
          </List.Section>
        </>
      )}
    </List>
  );
}
