import { LaunchType, Toast, getSelectedText, launchCommand, showToast } from "@raycast/api";

// 这是“翻译当前选中文本”的快捷命令。
// 它自己不负责翻译，而是先读取用户当前选中的文本，再把内容转交给主界面命令。
export default async function Command() {
  try {
    // 从前台应用里读取当前选中的文字。
    const selectedText = await getSelectedText();

    // 启动主命令，并把选中的文字作为上下文传过去，
    // 这样主界面打开后就可以自动开始翻译。
    await launchCommand({
      name: "chat-with-provider",
      type: LaunchType.UserInitiated,
      context: { selectedText },
    });
  } catch (error) {
    // 如果没选中文本，或者当前应用不支持读取选区，就在这里统一提示失败原因。
    const message = error instanceof Error ? error.message : String(error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Translate selected text failed",
      message,
    });
  }
}
