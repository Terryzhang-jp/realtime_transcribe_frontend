interface TranscriptionOptions {
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Error) => void;
  onTranscription?: (text: string, refinedText?: string, translation?: string, timestamp?: number) => void;
  language?: string;
  model?: string;
}

class AudioTranscriptionService {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private callbacks = {
    onOpen: undefined as ((event: Event) => void) | undefined,
    onClose: undefined as ((event: CloseEvent) => void) | undefined,
    onError: undefined as ((error: Error) => void) | undefined,
    onTranscription: undefined as ((text: string, refinedText?: string, translation?: string, timestamp?: number) => void) | undefined
  };
  private config = {
    language: 'zh',
    model: 'tiny'
  };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 初始重连延迟1秒
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;

  constructor(baseUrl: string = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000') {
    // 确保使用正确的WebSocket协议
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '8000'; // 使用环境变量或默认端口
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.baseUrl = `${protocol}//${hostname}:${wsPort}`;
      console.log('WebSocket配置:', {
        protocol,
        hostname,
        port: wsPort,
        finalUrl: this.baseUrl
      });
    } else {
      this.baseUrl = baseUrl;
    }
  }

  async connect(options: TranscriptionOptions = {}): Promise<void> {
    if (this.isReconnecting) {
      console.log('正在重连中，跳过连接请求');
      return;
    }

    if (this.ws) {
      console.log('关闭现有WebSocket连接');
      this.ws.close();
      this.ws = null;
    }

    this.callbacks = {
      onOpen: options.onOpen || undefined,
      onClose: options.onClose || undefined,
      onError: options.onError || undefined,
      onTranscription: options.onTranscription || undefined
    };

    if (options.language) this.config.language = options.language;
    if (options.model) this.config.model = options.model;

    return new Promise((resolve, reject) => {
      try {
        // 生成一个随机的client_id
        const clientId = Math.random().toString(36).substring(7);
        const wsUrl = `${this.baseUrl}/ws/transcribe/${clientId}`;
        console.log('尝试连接WebSocket:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
        
        let configSent = false;
        const connectionTimeoutId = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            const error = new Error('WebSocket连接超时');
            console.error('连接超时，当前状态:', {
              readyState: this.ws?.readyState,
              url: wsUrl
            });
            this.ws?.close();
            this.attemptReconnect();
            reject(error);
          }
        }, 5000);

        this.ws.onopen = async (event) => {
          console.log('WebSocket连接已建立，readyState:', this.ws?.readyState);
          clearTimeout(connectionTimeoutId);
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          
          if (this.callbacks.onOpen) this.callbacks.onOpen(event);

          // 等待连接稳定
          await new Promise(resolve => setTimeout(resolve, 500));
          
          try {
            // 发送配置
            await this.sendConfig();
            configSent = true;
            resolve();
          } catch (error) {
            console.error('发送初始配置失败:', error);
            // 即使配置发送失败也继续保持连接
            resolve();
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket连接已关闭:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            readyState: this.ws?.readyState,
            configSent
          });
          
          if (this.callbacks.onClose) this.callbacks.onClose(event);
          
          // 如果连接关闭时配置还未发送成功，尝试重连
          if (!configSent || !event.wasClean) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (event) => {
          console.error('WebSocket错误:', {
            event,
            readyState: this.ws?.readyState,
            url: wsUrl,
            configSent
          });
          if (this.callbacks.onError) {
            this.callbacks.onError(new Error('WebSocket连接错误'));
          }
        };

        this.ws.onmessage = this.handleMessage.bind(this);

      } catch (error) {
        console.error('创建WebSocket连接时出错:', error);
        this.attemptReconnect();
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.isReconnecting) {
      console.log('已经在重连中');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('达到最大重连次数，停止重连');
      if (this.callbacks.onError) {
        this.callbacks.onError(new Error('WebSocket重连失败'));
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`第 ${this.reconnectAttempts} 次重连，延迟 ${delay}ms`);
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect({
          onOpen: this.callbacks.onOpen,
          onClose: this.callbacks.onClose,
          onError: this.callbacks.onError,
          onTranscription: this.callbacks.onTranscription,
          language: this.config.language,
          model: this.config.model
        });
      } catch (error) {
        console.error('重连失败:', error);
        this.isReconnecting = false;
      }
    }, delay);
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      // 增强日志显示
      console.log('%c收到WebSocket消息', 'background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px;');
      console.log('类型:', data.event);
      console.log('内容:', data);

      if (data.event === 'transcription' && data.text && this.callbacks.onTranscription) {
        console.log('%c处理转写结果', 'background: #2196F3; color: white; padding: 4px 8px; border-radius: 4px;');
        console.log('文本:', data.text);
        console.log('优化文本:', data.refined_text || '(无)');
        console.log('翻译:', data.translation || '(无)');
        console.log('时间戳:', data.timestamp || '(无)');
        
        this.callbacks.onTranscription(
          data.text,
          data.refined_text,
          data.translation,
          data.timestamp
        );
      } else if (data.event === 'error') {
        console.error('服务器报告错误:', data.message);
        if (this.callbacks.onError) {
          this.callbacks.onError(new Error(data.message));
        }
      } else if (data.event === 'connected') {
        console.log('收到连接确认');
      } else if (data.event === 'config_updated' || data.event === 'config_received') {
        console.log('收到配置确认');
      } else {
        console.warn('收到未知类型的消息:', data);
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
      console.log('原始消息:', event.data);
    }
  }

  private async sendConfig(): Promise<void> {
    // 等待连接就绪
    const waitForConnection = async (maxAttempts = 10): Promise<void> => {
      for (let i = 0; i < maxAttempts; i++) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('等待WebSocket连接就绪超时');
    };

    try {
      await waitForConnection();
      
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket未连接，无法发送配置');
        throw new Error('WebSocket未连接');
      }

      const config = {
        event: 'config',
        config: {
          language: this.config.language,
          model: this.config.model,
          noise_suppression: false,
          enable_realtime_transcription: true,
          use_main_model_for_realtime: true,
          realtime_model_type: 'tiny',
          realtime_processing_pause: 0.2,
          stabilization_window: 2,
          match_threshold: 10
        }
      };

      // 最多重试3次
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`发送配置 (尝试 ${attempt}/3):`, config);
          this.ws.send(JSON.stringify(config));
          
          // 等待确认
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              this.ws?.removeEventListener('message', messageHandler);
              if (attempt === 3) {
                reject(new Error('配置发送超时'));
              } else {
                console.log(`配置发送超时，将进行第 ${attempt + 1} 次尝试`);
                resolve();
              }
            }, 5000);

            const messageHandler = (event: MessageEvent) => {
              try {
                const response = JSON.parse(event.data);
                if (response.event === 'config_updated' || response.event === 'config_received') {
                  clearTimeout(timeoutId);
                  this.ws?.removeEventListener('message', messageHandler);
                  console.log('配置更新成功');
                  resolve();
                }
              } catch (error) {
                console.error('处理配置响应时出错:', error);
              }
            };

            this.ws?.addEventListener('message', messageHandler);
          });
          
          // 如果成功收到响应，直接返回
          return;
          
        } catch (error) {
          if (attempt === 3) {
            throw error;
          }
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    } catch (error) {
      console.error('发送配置时出错:', error);
      throw error;
    }
  }

  async sendAudioData(audioData: ArrayBuffer): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket未连接，状态:', this.ws?.readyState);
      throw new Error('WebSocket未连接');
    }

    if (audioData.byteLength === 0) {
      console.warn('音频数据为空');
      return;
    }

    try {
      // 检查缓冲区状态
      if (this.ws.bufferedAmount > 1024 * 1024) {
        console.warn('WebSocket缓冲区已满，等待发送...');
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }

      // 检查音频数据
      const view = new Int16Array(audioData);
      const maxAbs = Math.max(...Array.from(view).map(Math.abs));
      
      if (maxAbs < 100) {
        console.log('音频数据振幅太小，跳过发送');
        return;
      }
      
      console.log('准备发送音频数据:', {
        byteLength: audioData.byteLength,
        samples: view.length,
        maxAmplitude: maxAbs,
        bufferedAmount: this.ws.bufferedAmount,
        readyState: this.ws.readyState
      });

      // 发送音频数据
      this.ws.send(audioData);
      
      console.log('音频数据发送成功');

    } catch (error) {
      console.error('发送音频数据时出错:', error);
      throw error;
    }
  }

  updateConfig(language: string, model: string): void {
    this.config.language = language;
    this.config.model = model;
    this.sendConfig();
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.isReconnecting = false;
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// 创建单例实例
const audioTranscriptionService = new AudioTranscriptionService();

export default audioTranscriptionService;

// 扩展原有的创建WebSocket连接函数，添加对refined_text和translation的处理
export const setupWebSocket = (
  onTranscription: (text: string, refinedText?: string, translation?: string, timestamp?: number) => void,
  onConnectionStatus: (status: boolean) => void,
  language: string = 'zh',
  model: string = 'tiny',
) => {
  // 获取WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = process.env.NEXT_PUBLIC_API_HOST || window.location.host;
  const clientId = localStorage.getItem('ws_client_id') || undefined;
  
  // 创建WebSocket连接
  const wsUrl = `${protocol}//${host}/ws/transcribe/${clientId}`;
  console.log(`正在连接WebSocket: ${wsUrl}`);
  
  const ws = new WebSocket(wsUrl);
  
  // 处理WebSocket事件
  ws.onopen = () => {
    console.log('WebSocket连接已打开');
    onConnectionStatus(true);
    
    // 发送配置信息
    const config = {
      event: 'config',
      config: {
        language,
        model
      }
    };
    console.log(`发送配置信息: ${JSON.stringify(config)}`);
    ws.send(JSON.stringify(config));
  };
  
  ws.onclose = () => {
    console.log('WebSocket连接已关闭');
    onConnectionStatus(false);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket错误:', error);
    onConnectionStatus(false);
  };
  
  ws.onmessage = (event) => {
    // 添加原始消息日志，以便调试
    console.log(`接收到WebSocket消息 (原始): `, event.data);
    
    try {
      const message = JSON.parse(event.data);
      
      // 增强日志显示
      console.log('%c接收到WebSocket消息', 'background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px;');
      console.log('类型:', message.event);
      console.log('内容:', message);
      
      if (message.event === 'connected') {
        // 保存客户端ID
        if (message.client_id) {
          console.log(`保存客户端ID: ${message.client_id}`);
          localStorage.setItem('ws_client_id', message.client_id);
        }
        onConnectionStatus(true);
      } 
      else if (message.event === 'transcription') {
        // 收到转写结果
        console.log('%c收到转写结果', 'background: #2196F3; color: white; padding: 4px 8px; border-radius: 4px;');
        console.log('文本:', message.text);
        console.log('优化文本:', message.refined_text || '(无)');
        console.log('翻译:', message.translation || '(无)');
        console.log('时间戳:', message.timestamp || '(无)');
        
        if (message.text && typeof onTranscription === 'function') {
          try {
            onTranscription(
              message.text, 
              message.refined_text, 
              message.translation,
              message.timestamp
            );
            console.log('成功调用转写回调函数');
          } catch (err) {
            console.error('调用转写回调函数时出错:', err);
          }
        }
      }
    } catch (error) {
      console.error('解析WebSocket消息时出错:', error);
    }
  };
  
  return ws;
}; 