/**
 * 会话总结服务
 * 
 * 用于与后端会话总结API通信，获取基于转写文本的会话总结。
 */

interface TranscriptionItem {
  text: string;
  timestamp: string;
}

export interface SessionSummary {
  scene: string;       // 场景描述
  topic: string;       // 主题
  keyPoints: string[]; // 关键点列表
  summary: string;     // 总体总结
}

/**
 * 获取会话总结
 * 
 * @param transcriptions 转写文本数组，包含文本和时间戳
 * @returns 会话总结结果
 */
export async function getSessionSummary(transcriptions: TranscriptionItem[]): Promise<SessionSummary> {
  try {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = '8000'; // 后端端口
    
    const apiUrl = `${protocol}//${hostname}:${port}/api/summary`;
    
    console.log('请求会话总结:', {
      url: apiUrl,
      transcriptionCount: transcriptions.length
    });
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcriptions }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取会话总结失败: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('收到会话总结结果:', result);
    
    return {
      scene: result.scene,
      topic: result.topic,
      keyPoints: result.keyPoints,
      summary: result.summary
    };
    
  } catch (error) {
    console.error('获取会话总结时出错:', error);
    // 返回一个友好的错误响应
    return {
      scene: "获取失败",
      topic: "连接错误",
      keyPoints: ["无法连接到总结服务"],
      summary: `获取总结时出错: ${error instanceof Error ? error.message : String(error)}`
    };
  }
} 