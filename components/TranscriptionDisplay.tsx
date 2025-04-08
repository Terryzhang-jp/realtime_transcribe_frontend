import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { calculateTextStatistics, TextStatistics } from '../lib/textUtils';
import { getSessionSummary, SessionSummary as SessionSummaryType } from '../lib/summaryService';

// 会话总结接口
interface SessionSummary {
  scene: string;       // 场景描述
  topic: string;       // 主题
  keyPoints: string[]; // 关键点列表
  summary: string;     // 总体总结
  updatedAt: Date;     // 更新时间
}

interface TranscriptionDisplayProps {
  transcriptions: string[];
  refinedTranscriptions?: string[];
  translations?: string[];
  timestamps?: number[];
  contextEnhanced?: boolean[];
  isRecording: boolean;
}

interface TranscriptionItem {
  text: string;
  refinedText?: string;
  translation?: string;
  timestamp: Date;
  contextEnhanced?: boolean;
}

const TOKEN_THRESHOLD = 200; // 触发总结的token阈值

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ 
  transcriptions,
  refinedTranscriptions = [],
  translations = [],
  timestamps = [],
  contextEnhanced = [],
  isRecording
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [showMode, setShowMode] = useState<'original' | 'refined' | 'translation'>('original');
  const [statistics, setStatistics] = useState<TextStatistics>({
    textCount: 0,
    totalCharacters: 0,
    totalTokens: 0
  });
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);
  const [recordingDuration, setRecordingDuration] = useState<string>("00:00:00");
  
  // 会话总结相关状态
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [isFetchingSummary, setIsFetchingSummary] = useState<boolean>(false);
  const [lastProcessedTokens, setLastProcessedTokens] = useState<number>(0);
  const [tokensUntilNextSummary, setTokensUntilNextSummary] = useState<number>(TOKEN_THRESHOLD);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryCount, setSummaryCount] = useState<number>(0); // 添加总结次数状态
  const [summarySubmittedToBackend, setSummarySubmittedToBackend] = useState<boolean>(false); // 跟踪是否已提交给后端
  
  // 当录音状态改变时更新开始时间
  useEffect(() => {
    if (isRecording && !recordingStartTime) {
      setRecordingStartTime(new Date());
    } else if (!isRecording) {
      setRecordingStartTime(null);
      setRecordingDuration("00:00:00");
    }
  }, [isRecording]);
  
  // 格式化持续时间
  const formatDuration = (durationInSeconds: number): string => {
    const hours = Math.floor(durationInSeconds / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = Math.floor(durationInSeconds % 60);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // 更新录音时长
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (recordingStartTime && isRecording) {
      timer = setInterval(() => {
        const now = new Date();
        const durationInSeconds = (now.getTime() - recordingStartTime.getTime()) / 1000;
        setRecordingDuration(formatDuration(durationInSeconds));
      }, 1000);
    }
    
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [recordingStartTime, isRecording]);
  
  // 将传入的转写结果转换为带时间戳的项目
  useEffect(() => {
    const newItems = transcriptions.map((text, index) => {
      // 如果items中已有此索引的项，则保留其时间戳和contextEnhanced标记
      if (index < items.length) {
        return {
          ...items[index],
          text,
          refinedText: refinedTranscriptions[index] || undefined,
          translation: translations[index] || undefined,
          contextEnhanced: contextEnhanced[index] || false
        };
      }
      
      // 否则创建新项目
      return {
        text,
        refinedText: refinedTranscriptions[index] || undefined,
        translation: translations[index] || undefined,
        timestamp: timestamps[index] ? new Date(timestamps[index] * 1000) : new Date(),
        contextEnhanced: contextEnhanced[index] || false
      };
    });
    setItems(newItems);
    
    // 记录接收到新转写结果的信息
    if (newItems.length > items.length) {
      console.log(`%c接收到新转写结果 (总数: ${newItems.length})`, 'background: #9C27B0; color: white; padding: 2px 6px; border-radius: 4px;');
    }
  }, [transcriptions, refinedTranscriptions, translations, timestamps, contextEnhanced]);
  
  // 当新的转写结果出现时，滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items]);
  
  // 获取当前显示文本
  const getDisplayText = (item: TranscriptionItem): string => {
    switch (showMode) {
      case 'refined':
        return item.refinedText || item.text;
      case 'translation':
        return item.translation || '';
      case 'original':
      default:
        return item.text;
    }
  };
  
  // 更新统计信息并检查是否需要触发总结
  useEffect(() => {
    const currentTexts = items.map(item => getDisplayText(item));
    const stats = calculateTextStatistics(currentTexts);
    setStatistics(stats);
    
    // 计算距离下一次总结所需的token数
    const tokensGained = stats.totalTokens - lastProcessedTokens;
    const tokensRemaining = Math.max(0, TOKEN_THRESHOLD - tokensGained);
    setTokensUntilNextSummary(tokensRemaining);
    
    // 检查是否达到token阈值触发总结
    if (tokensGained >= TOKEN_THRESHOLD && items.length > 0 && !isFetchingSummary) {
      fetchSessionSummary();
    }
  }, [items, showMode, lastProcessedTokens, isFetchingSummary]);
  
  // 获取会话总结
  const fetchSessionSummary = async () => {
    try {
      setIsFetchingSummary(true);
      setSummaryError(null);
      
      // 提取优化后的文本和时间戳
      const summaryData = items.map(item => ({
        text: item.refinedText || item.text,
        timestamp: item.timestamp.toISOString()
      }));
      
      // 调用API服务获取会话总结
      const result = await getSessionSummary(summaryData);
      
      // 更新总结结果
      const newSummary = {
        scene: result.scene,
        topic: result.topic,
        keyPoints: result.keyPoints,
        summary: result.summary,
        updatedAt: new Date()
      };
      
      setSessionSummary(newSummary);
      
      // 更新已处理的token数
      setLastProcessedTokens(statistics.totalTokens);
      
      // 更新总结次数并处理第一次总结
      if (summaryCount === 0) {
        setSummaryCount(1);
        // 第一次总结时，将总结发送给后端以增强优化和翻译
        sendSummaryToBackend(newSummary);
      }
      
    } catch (error) {
      console.error('获取会话总结时出错:', error);
      setSummaryError(error instanceof Error ? error.message : '获取总结失败');
    } finally {
      setIsFetchingSummary(false);
    }
  };
  
  // 将第一次总结发送给后端
  const sendSummaryToBackend = async (summary: SessionSummary) => {
    if (summarySubmittedToBackend) return; // 避免重复发送
    
    try {
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const port = '8000'; // 后端端口
      
      const backendUrl = `${protocol}//${hostname}:${port}/api/summary/context`;
      
      console.log('向后端发送会话总结上下文...');
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scene: summary.scene,
          topic: summary.topic,
          keyPoints: summary.keyPoints,
          summary: summary.summary
        }),
      });
      
      if (response.ok) {
        console.log('会话总结上下文已成功发送到后端，用于增强文本优化和翻译');
        setSummarySubmittedToBackend(true);
      } else {
        console.error('发送会话总结上下文到后端失败:', await response.text());
      }
      
    } catch (error) {
      console.error('发送会话总结上下文时出错:', error);
    }
  };
  
  // 计算进度条百分比
  const calculateProgressPercentage = (): number => {
    if (statistics.totalTokens < lastProcessedTokens) {
      return 0;
    }
    
    const tokensGained = statistics.totalTokens - lastProcessedTokens;
    const percentage = Math.min(100, Math.floor((tokensGained / TOKEN_THRESHOLD) * 100));
    return percentage;
  };
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white flex justify-between items-center">
        <span>转写结果</span>
        <div className="flex items-center space-x-4">
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
            录音时长: {recordingDuration}
          </span>
          {items.length > 0 && (
            <span className="text-sm font-normal bg-primary-100 dark:bg-primary-900 text-primary-800 dark:text-primary-200 px-2 py-1 rounded-full">
              共 {items.length} 条
            </span>
          )}
        </div>
      </h2>
      
      {/* 统计信息面板 */}
      <div className="mb-4 bg-gray-50 dark:bg-gray-700 rounded-lg p-4 grid grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">录音时长</div>
          <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
            {recordingDuration}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {isRecording ? "录音中..." : "未录音"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">文本数量</div>
          <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
            {statistics.textCount}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">总字符数</div>
          <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
            {statistics.totalCharacters}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">总Token数</div>
          <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
            {statistics.totalTokens}
          </div>
        </div>
      </div>
      
      {/* 会话总结进度条 */}
      <div className="mb-4 bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">会话总结进度</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            还需 {tokensUntilNextSummary} tokens ({calculateProgressPercentage()}%)
          </span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ease-in-out ${isFetchingSummary ? 'bg-yellow-500 animate-pulse' : 'bg-primary-500'}`}
            style={{ width: `${calculateProgressPercentage()}%` }}
          />
        </div>
        {isFetchingSummary && (
          <div className="text-xs text-center mt-1 text-yellow-600 dark:text-yellow-400">
            正在生成会话总结...
          </div>
        )}
        {summaryError && (
          <div className="text-xs text-center mt-1 text-red-600 dark:text-red-400">
            {summaryError}
          </div>
        )}
      </div>
      
      {/* 会话总结显示 */}
      {sessionSummary && (
        <div className="mb-4 bg-primary-50 dark:bg-gray-700 rounded-lg p-4 border-l-4 border-primary-500">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-md font-medium text-gray-800 dark:text-white">会话总结</h3>
            <div className="flex items-center space-x-2">
              {summarySubmittedToBackend && (
                <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                  已用于增强优化和翻译
                </span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                更新于 {sessionSummary.updatedAt.toLocaleTimeString()}
              </span>
            </div>
          </div>
          
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">场景</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{sessionSummary.scene}</p>
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">主题</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{sessionSummary.topic}</p>
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">关键点</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
                {sessionSummary.keyPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">总结</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">{sessionSummary.summary}</p>
            </div>
          </div>
          
          <button 
            className="mt-3 text-xs text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
            onClick={fetchSessionSummary}
            disabled={isFetchingSummary}
          >
            {isFetchingSummary ? '更新中...' : '手动更新总结'}
          </button>
        </div>
      )}
      
      {/* 显示模式选择 */}
      <div className="mb-4 flex space-x-2">
        <button
          className={`px-3 py-1 text-sm rounded-md ${
            showMode === 'original' 
              ? 'bg-primary-500 text-white' 
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
          onClick={() => setShowMode('original')}
        >
          原始文本
        </button>
        <button
          className={`px-3 py-1 text-sm rounded-md ${
            showMode === 'refined' 
              ? 'bg-primary-500 text-white' 
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
          onClick={() => setShowMode('refined')}
          disabled={!refinedTranscriptions.some(t => !!t)}
        >
          优化文本
        </button>
        <button
          className={`px-3 py-1 text-sm rounded-md ${
            showMode === 'translation' 
              ? 'bg-primary-500 text-white' 
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
          onClick={() => setShowMode('translation')}
          disabled={!translations.some(t => !!t)}
        >
          翻译文本
        </button>
      </div>
      
      <div 
        ref={containerRef}
        className="h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900"
      >
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p>开始录音后，转写结果将显示在这里</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="p-3 bg-primary-50 dark:bg-gray-800 rounded-lg border-l-4 border-primary-500"
              >
                <div className="flex justify-between items-start">
                  <p className="text-gray-800 dark:text-gray-200">{getDisplayText(item)}</p>
                  {item.contextEnhanced && (showMode === 'refined' || showMode === 'translation') && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                      会话增强
                    </span>
                  )}
                </div>
                
                {/* 显示所有内容的详细视图 */}
                {showMode !== 'original' && item.text && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 border-t pt-2">
                    <div className="flex items-start">
                      <span className="font-medium mr-1">原文:</span>
                      <span>{item.text}</span>
                    </div>
                  </div>
                )}
                
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                  {item.timestamp.toLocaleTimeString()}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      
      <div className="mt-4 flex justify-between items-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {items.length > 0 ? `最后更新: ${items[items.length-1].timestamp.toLocaleTimeString()}` : "尚无转写结果"}
        </div>
        <button 
          className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 disabled:opacity-50"
          onClick={() => {
            // 创建包含转写结果的文本
            const text = items.map(item => {
              let result = `[${item.timestamp.toLocaleTimeString()}]\n`;
              result += `原文: ${item.text}\n`;
              if (item.refinedText) {
                result += `优化: ${item.refinedText}\n`;
              }
              if (item.translation) {
                result += `翻译: ${item.translation}\n`;
              }
              return result;
            }).join('\n\n');
            
            // 创建Blob对象
            const blob = new Blob([text], { type: 'text/plain' });
            
            // 创建URL
            const url = URL.createObjectURL(blob);
            
            // 创建下载链接
            const a = document.createElement('a');
            a.href = url;
            a.download = `转写结果_${new Date().toISOString().split('T')[0]}.txt`;
            
            // 模拟点击
            document.body.appendChild(a);
            a.click();
            
            // 清理
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          disabled={items.length === 0}
        >
          导出结果
        </button>
      </div>
    </div>
  );
};

export default TranscriptionDisplay; 