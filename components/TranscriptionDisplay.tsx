import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface TranscriptionDisplayProps {
  transcriptions: string[];
  refinedTranscriptions?: string[];
  translations?: string[];
  timestamps?: number[];
}

interface TranscriptionItem {
  text: string;
  refinedText?: string;
  translation?: string;
  timestamp: Date;
}

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ 
  transcriptions,
  refinedTranscriptions = [],
  translations = [],
  timestamps = []
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [showMode, setShowMode] = useState<'original' | 'refined' | 'translation'>('original');
  
  // 将传入的转写结果转换为带时间戳的项目
  useEffect(() => {
    const newItems = transcriptions.map((text, index) => {
      // 如果items中已有此索引的项，则保留其时间戳
      if (index < items.length) {
        return {
          ...items[index],
          text,
          refinedText: refinedTranscriptions[index] || undefined,
          translation: translations[index] || undefined
        };
      }
      
      // 否则创建新项目
      return {
        text,
        refinedText: refinedTranscriptions[index] || undefined,
        translation: translations[index] || undefined,
        timestamp: timestamps[index] ? new Date(timestamps[index] * 1000) : new Date()
      };
    });
    setItems(newItems);
    
    // 记录接收到新转写结果的信息
    if (newItems.length > items.length) {
      console.log(`%c接收到新转写结果 (总数: ${newItems.length})`, 'background: #9C27B0; color: white; padding: 2px 6px; border-radius: 4px;');
    }
  }, [transcriptions, refinedTranscriptions, translations, timestamps]);
  
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
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white flex justify-between items-center">
        <span>转写结果</span>
        {items.length > 0 && (
          <span className="text-sm font-normal bg-primary-100 dark:bg-primary-900 text-primary-800 dark:text-primary-200 px-2 py-1 rounded-full">
            共 {items.length} 条
          </span>
        )}
      </h2>
      
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
                <p className="text-gray-800 dark:text-gray-200">{getDisplayText(item)}</p>
                
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