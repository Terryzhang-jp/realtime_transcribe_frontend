/**
 * 计算文本的token数量
 * 规则：
 * 1. 每个汉字算作一个token
 * 2. 每个标点符号算作一个token
 * 3. 英文单词按空格分割，每个单词算作一个token
 * 4. 数字序列算作一个token
 */
export function calculateTokens(text: string): number {
  if (!text) return 0;
  
  // 将文本分割成字符数组
  const chars = Array.from(text);
  
  // 统计汉字和标点符号
  const chineseAndPunctuationCount = chars.filter(char => {
    // 匹配汉字
    const isChinese = /[\u4e00-\u9fa5]/.test(char);
    // 匹配标点符号
    const isPunctuation = /[，。！？；：""''（）、]/.test(char);
    return isChinese || isPunctuation;
  }).length;
  
  // 处理英文单词和数字
  // 先将所有汉字替换为空格，以便正确分割英文单词
  const nonChineseText = text.replace(/[\u4e00-\u9fa5，。！？；：""''（）、]/g, ' ');
  // 分割并过滤空字符串
  const words = nonChineseText.split(/\s+/).filter(word => word.length > 0);
  
  return chineseAndPunctuationCount + words.length;
}

/**
 * 计算文本的字符数量（不包括空格）
 */
export function calculateCharacters(text: string): number {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
}

/**
 * 文本统计信息接口
 */
export interface TextStatistics {
  textCount: number;      // 文本数量
  totalCharacters: number; // 总字符数
  totalTokens: number;    // 总token数
}

/**
 * 计算文本统计信息
 */
export function calculateTextStatistics(texts: string[]): TextStatistics {
  const textCount = texts.length;
  const totalCharacters = texts.reduce((sum, text) => sum + calculateCharacters(text), 0);
  const totalTokens = texts.reduce((sum, text) => sum + calculateTokens(text), 0);
  
  return {
    textCount,
    totalCharacters,
    totalTokens
  };
} 