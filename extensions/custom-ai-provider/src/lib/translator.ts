// 这是发送给 AI 的“系统提示词”模板，用来约束模型输出固定格式。
// 之所以写得比较严格，是为了让后面的解析逻辑能稳定拆出中英两个部分。
export const TRANSLATION_SYSTEM_PROMPT = `You are a professional translator.

Detect the source language automatically and translate the user's text into:
1. Chinese (Simplified)
2. English

Rules:
- Return exactly two sections
- Use this output format exactly:
Chinese:
<translation>

English:
<translation>
- The content after "Chinese:" and "English:" must be the actual translation result, never placeholders
- Never output placeholder words like "原文", "Original text", "same as above", "same as source", or template labels
- If the source text is already Chinese (Simplified), the Chinese section should reproduce the original wording faithfully
- If the source text is already English, the English section should reproduce the original wording faithfully
- Preserve meaning, tone, formatting, markdown, code blocks, URLs, placeholders, and line breaks
- Do not explain
- Do not add extra headings or notes`;

// 这个辅助函数会把很长的文本压缩成短预览，适合列表或日志里展示。
// 它会先把多余空白折叠成单个空格，再根据最大长度决定是否截断。
export function truncateText(text: string, maxLength = 96) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

// 把用户原文拼接进完整提示词中，作为真正发送给模型的内容。
// 这里用代码块包住原文，是为了尽量保留换行和格式，减少模型误改文本结构。
export function buildTranslationPrompt(sourceText: string) {
  return `${TRANSLATION_SYSTEM_PROMPT}

Text to translate:
\`\`\`
${sourceText}
\`\`\``;
}

// 模型返回后，这个函数会尝试从固定格式中拆出 Chinese 和 English 两部分。
// 如果模型没有完全按要求输出，返回值里某一项可能是 undefined。
export function parseBilingualTranslation(translatedText: string): {
  chinese?: string;
  english?: string;
} {
  const normalized = translatedText.trim();

  // 用正则匹配 Chinese: 到 English: 之间的内容，作为中文翻译结果。
  const chineseMatch = normalized.match(
    /Chinese:\s*([\s\S]*?)(?:\n\s*English:\s*|$)/i,
  );

  // 用正则匹配 English: 后面的所有内容，作为英文翻译结果。
  const englishMatch = normalized.match(/English:\s*([\s\S]*?)$/i);

  return {
    chinese: chineseMatch?.[1]?.trim(),
    english: englishMatch?.[1]?.trim(),
  };
}
