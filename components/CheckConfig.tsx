import React, { useState, useEffect } from 'react';
import audioTranscriptionService from '../lib/websocket';

interface CheckConfigProps {
  language: string;
  modelType: string;
  targetLanguage?: string;
}

const CheckConfig: React.FC<CheckConfigProps> = ({ language, modelType, targetLanguage = 'en' }) => {
  const [serverConfig, setServerConfig] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [needsRefresh, setNeedsRefresh] = useState<boolean>(false);
  
  // 检查是否与服务器配置存在差异
  useEffect(() => {
    if (serverConfig && serverConfig.processor) {
      // 如果配置不一致，设置需要刷新
      const mismatch = 
        serverConfig.processor.language !== language ||
        serverConfig.processor.model_type !== modelType ||
        serverConfig.processor.target_language !== targetLanguage;
      
      setNeedsRefresh(mismatch);
    }
  }, [language, modelType, targetLanguage, serverConfig]);
  
  // 自动刷新配置
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        checkConfig();
      }, 5000); // 每5秒检查一次
      
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);
  
  const checkConfig = async () => {
    setIsLoading(true);
    setError('');
    try {
      const config = await audioTranscriptionService.checkServerConfig();
      setServerConfig(config);
      setNeedsRefresh(false);
    } catch (err: any) {
      setError(err.message || '检查配置失败');
    } finally {
      setIsLoading(false);
    }
  };
  
  const applyConfigDirectly = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await audioTranscriptionService.setServerConfig({
        language,
        model_type: modelType,
        target_language: targetLanguage
      });
      if (result.success) {
        // 应用成功后立即检查配置
        await checkConfig();
      } else {
        setError('应用配置失败: ' + result.message);
      }
    } catch (err: any) {
      setError(err.message || '应用配置失败');
    } finally {
      setIsLoading(false);
    }
  };
  
  // 检测配置问题
  const hasConfigMismatch = serverConfig && serverConfig.processor && (
    serverConfig.processor.language !== language ||
    serverConfig.processor.model_type !== modelType ||
    serverConfig.processor.target_language !== targetLanguage
  );
  
  return (
    <div className="mt-4 border-t pt-4 text-sm">
      <h3 className="font-medium mb-2">配置检查工具</h3>
      
      <div className="flex items-center space-x-2 mb-2">
        <button
          onClick={checkConfig}
          disabled={isLoading}
          className="px-2 py-1 bg-blue-500 text-white rounded-md text-xs"
        >
          {isLoading ? '加载中...' : '检查服务器配置'}
        </button>
        
        <button
          onClick={applyConfigDirectly}
          disabled={isLoading}
          className={`px-2 py-1 ${
            needsRefresh ? 'bg-green-600 animate-pulse' : 'bg-green-500'
          } text-white rounded-md text-xs`}
        >
          直接应用配置
        </button>
        
        <div className="flex items-center ml-2">
          <input
            type="checkbox"
            id="auto-refresh"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="mr-1"
          />
          <label htmlFor="auto-refresh" className="text-xs">自动刷新</label>
        </div>
      </div>
      
      {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
      
      {needsRefresh && serverConfig && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-2 py-1 rounded-md text-xs mb-2">
          前端配置与服务器配置不一致！请点击"直接应用配置"同步到服务器。
        </div>
      )}
      
      {serverConfig && (
        <div className={`${hasConfigMismatch ? 'bg-yellow-50' : 'bg-gray-100'} p-2 rounded-md text-xs`}>
          <h4 className="font-medium">服务器配置:</h4>
          <div>客户端ID: {serverConfig.client_id}</div>
          <div>连接状态: {serverConfig.connected ? '已连接' : '未连接'}</div>
          <div>处理器配置:</div>
          <ul className="pl-2">
            <li className={serverConfig.processor?.language !== language ? 'text-red-500 font-bold' : ''}>
              语言: {serverConfig.processor?.language}
              {serverConfig.processor?.language !== language && ` (前端: ${language})`}
            </li>
            <li className={serverConfig.processor?.model_type !== modelType ? 'text-red-500 font-bold' : ''}>
              模型: {serverConfig.processor?.model_type}
              {serverConfig.processor?.model_type !== modelType && ` (前端: ${modelType})`}
            </li>
            <li className={serverConfig.processor?.target_language !== targetLanguage ? 'text-red-500 font-bold' : ''}>
              翻译语言: {serverConfig.processor?.target_language}
              {serverConfig.processor?.target_language !== targetLanguage && ` (前端: ${targetLanguage})`}
            </li>
            <li>运行状态: {serverConfig.processor?.running ? '运行中' : '已停止'}</li>
          </ul>
          <div>客户端配置:</div>
          <ul className="pl-2">
            <li className={serverConfig.config?.language !== language ? 'text-orange-500' : ''}>
              语言: {serverConfig.config?.language}
            </li>
            <li className={serverConfig.config?.model_type !== modelType ? 'text-orange-500' : ''}>
              模型: {serverConfig.config?.model_type}
            </li>
            <li className={serverConfig.config?.target_language !== targetLanguage ? 'text-orange-500' : ''}>
              翻译语言: {serverConfig.config?.target_language}
            </li>
          </ul>
          <div className="mt-1 text-xs text-gray-500">
            最后更新: {new Date().toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckConfig; 