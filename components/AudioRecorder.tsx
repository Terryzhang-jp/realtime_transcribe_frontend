import { useState, useEffect, useRef, useCallback } from 'react';
import audioTranscriptionService from '../lib/websocket';
import CheckConfig from './CheckConfig';
// 使用常量代替从npm包导入
const NOISE_SUPPRESSOR_WORKLET_NAME = 'NoiseSuppressorWorklet';

interface AudioRecorderProps {
  onTranscriptionResult: (text: string, refinedText?: string, translation?: string, timestamp?: number) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  language: string;
  modelType: string;
  targetLanguage?: string;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onTranscriptionResult,
  onRecordingStateChange,
  language = 'zh',
  modelType = 'tiny',
  targetLanguage = 'en',
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [audioSource, setAudioSource] = useState<'microphone' | 'system' | 'both'>('microphone');
  const [isSystemAudioSupported, setIsSystemAudioSupported] = useState<boolean>(false);
  const [noiseFilterLevel, setNoiseFilterLevel] = useState<'off' | 'low' | 'medium' | 'high'>('medium');
  const [autoPauseAfterSilence, setAutoPauseAfterSilence] = useState<boolean>(false);
  const [silenceTimerActive, setSilenceTimerActive] = useState<boolean>(false);
  const [useRNNoise, setUseRNNoise] = useState<boolean>(true);
  
  // 音频处理相关引用
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const rnnoiseWorkletAddedRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  
  // 使用useRef存储回调函数，避免useEffect依赖变化导致重连
  const callbacksRef = useRef({
    onTranscriptionResult,
    language,
    modelType,
    targetLanguage
  });
  
  // 静音检测计数器
  const silenceCounterRef = useRef<number>(0);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // 当props变化时更新ref
  useEffect(() => {
    callbacksRef.current = {
      onTranscriptionResult,
      language,
      modelType,
      targetLanguage
    };
  }, [onTranscriptionResult, language, modelType, targetLanguage]);
  
  // 处理转写结果的回调函数
  const handleTranscriptionResult = useCallback((
    text: string,
    refinedText?: string,
    translation?: string,
    timestamp?: number
  ) => {
    if (isMountedRef.current) {
      console.log(`%c====== 转写结果 ======`, 'background: #ff9800; color: white; padding: 4px 8px; border-radius: 4px;');
      console.log(`收到转写文本: "${text}"`);
      console.log(`优化文本: "${refinedText || '无'}"`);
      console.log(`翻译: "${translation || '无'}"`);
      
      try {
        // 首先确认回调函数存在
        if (typeof callbacksRef.current.onTranscriptionResult !== 'function') {
          console.error('转写结果回调函数不是一个有效的函数');
          return;
        }
        
        console.log('调用父组件的onTranscriptionResult回调函数');
        callbacksRef.current.onTranscriptionResult(text, refinedText, translation, timestamp);
        console.log('%c转写结果已成功传递给父组件', 'color: #4CAF50; font-weight: bold;');
      } catch (error) {
        console.error('调用父组件回调函数出错:', error);
      }
    } else {
      console.warn('组件已卸载，忽略转写结果');
    }
  }, []);
  
  // 初始化WebSocket连接
  useEffect(() => {
    const connectWebSocket = async () => {
      try {
        setConnectionStatus('connecting');
        
        // 建立WebSocket连接
        await audioTranscriptionService.connect({
          onTranscription: (text, refinedText, translation, timestamp) => 
            handleTranscriptionResult(text, refinedText, translation, timestamp),
          onOpen: () => {
            setIsConnected(true);
            setConnectionStatus('connected');
          },
          onClose: () => {
            setIsConnected(false);
            setConnectionStatus('disconnected');
          },
          onError: () => {
            setIsConnected(false);
            setConnectionStatus('disconnected');
          },
          language,
          model: modelType,
          targetLanguage
        });
      } catch (error) {
        console.error('连接WebSocket时出错:', error);
        setConnectionStatus('disconnected');
      }
    };
    
    connectWebSocket();
    
    // 清理函数
    return () => {
      audioTranscriptionService.disconnect();
    };
  }, [language, modelType, targetLanguage]);
  
  // 使用单独的effect来更新配置
  useEffect(() => {
    if (isConnected) {
      console.log('更新WebSocket配置:', { language, modelType, targetLanguage });
      audioTranscriptionService.updateConfig(language, modelType, targetLanguage);
    }
  }, [language, modelType, targetLanguage, isConnected]);
  
  // 列出可用的音频设备
  useEffect(() => {
    const getDevices = async () => {
      try {
        // 请求权限以列出音频设备
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioDevices(audioInputs);
        
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId);
        }
      } catch (error) {
        console.error('获取音频设备时出错:', error);
      }
    };
    
    getDevices();
    
    // 监听设备变化
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices);
    };
  }, [selectedDevice]);
  
  // 检查系统音频支持
  useEffect(() => {
    const checkSystemAudioSupport = async () => {
      try {
        // @ts-ignore
        if (!navigator.mediaDevices?.getDisplayMedia) {
          setIsSystemAudioSupported(false);
          return;
        }
        
        // 检查是否支持音频捕获
        // @ts-ignore
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false
        });
        
        // 立即停止测试流
        stream.getTracks().forEach(track => track.stop());
        
        setIsSystemAudioSupported(true);
      } catch (error) {
        console.log('系统音频不受支持:', error);
        setIsSystemAudioSupported(false);
      }
    };
    
    checkSystemAudioSupport();
  }, []);

  // 当选择不支持的系统音频时自动切换回麦克风
  useEffect(() => {
    if ((audioSource === 'system' || audioSource === 'both') && !isSystemAudioSupported) {
      setAudioSource('microphone');
      alert('您的浏览器不支持系统音频捕获，已自动切换到麦克风模式。请使用最新版本的Chrome或Edge浏览器来启用系统音频捕获功能。');
    }
  }, [audioSource, isSystemAudioSupported]);
  
  // 开始/停止录音
  const toggleRecording = async () => {
    if (!isConnected) {
      alert('WebSocket未连接，请等待连接建立');
      return;
    }
    
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };
  
  // 初始化RNNoise AudioWorklet
  const initRNNoiseWorklet = async (audioContext: AudioContext) => {
    if (rnnoiseWorkletAddedRef.current) return;
    
    try {
      console.log('初始化RNNoise AudioWorklet...');
      // 加载AudioWorklet模块
      await audioContext.audioWorklet.addModule(
        // 在浏览器中从node_modules加载worklet模块
        // 这里需要确保构建过程中worklet文件可以被访问到
        '/worklets/noise-suppressor-worklet.js'
      );
      rnnoiseWorkletAddedRef.current = true;
      console.log('RNNoise AudioWorklet初始化成功');
    } catch (error) {
      console.error('初始化RNNoise AudioWorklet时出错:', error);
      setUseRNNoise(false);
    }
  };
  
  // 开始录音
  const startRecording = async () => {
    try {
      console.log('请求音频权限和初始化音频上下文...');
      // 创建音频上下文
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioContext;
      
      let microphoneStream: MediaStream | null = null;
      let systemAudioStream: MediaStream | null = null;

      // 根据选择的音源获取相应的流
      if (audioSource === 'microphone' || audioSource === 'both') {
        console.log('请求麦克风访问权限，设备ID:', selectedDevice || '默认设备');
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }

      if (audioSource === 'system' || audioSource === 'both') {
        console.log('请求系统音频访问权限');
        try {
          // @ts-ignore - TypeScript 可能不认识这个新API
          systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: false, // 系统音频不需要回声消除
              noiseSuppression: false, // 系统音频不需要噪声抑制
              autoGainControl: false   // 系统音频不需要自动增益
            },
            video: false
          }).catch(error => {
            console.error('获取系统音频失败:', error);
            if (error.name === 'NotAllowedError') {
              alert('您拒绝了系统音频访问权限。如需录制系统声音，请允许屏幕共享并选择"系统音频"。');
            } else if (error.name === 'NotSupportedError') {
              alert('您的浏览器不支持系统音频捕获。请使用最新版本的Chrome或Edge浏览器。');
            } else {
              alert(`无法获取系统音频: ${error.message}`);
            }
            throw error;
          });

          // 确保获取到了音频轨道
          const audioTracks = systemAudioStream.getAudioTracks();
          if (audioTracks.length === 0) {
            throw new Error('未能获取到系统音频轨道');
          }

          console.log('系统音频初始化成功:', {
            tracks: audioTracks.length,
            settings: audioTracks[0].getSettings()
          });

        } catch (error) {
          console.error('获取系统音频失败:', error);
          if (!microphoneStream) {
            throw error;
          }
        }
      }

      // 合并音频流（如果需要）
      let finalStream: MediaStream;
      if (microphoneStream && systemAudioStream) {
        const micTrack = microphoneStream.getAudioTracks()[0];
        const sysTrack = systemAudioStream.getAudioTracks()[0];
        finalStream = new MediaStream([micTrack, sysTrack]);
      } else {
        finalStream = microphoneStream || systemAudioStream!;
      }

      mediaStreamRef.current = finalStream;
      
      // 先设置录音状态为true，确保handleAudioProcess能够处理数据
      setIsRecording(true);
      onRecordingStateChange?.(true);  // 通知父组件录音开始
      
      // 创建音频源
      const source = audioContext.createMediaStreamSource(finalStream);
      console.log('音频源已创建');
      
      // 创建分析器节点用于显示音量
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      // 如果使用RNNoise，创建AudioWorklet进行降噪
      if (useRNNoise) {
        try {
          // 初始化RNNoise AudioWorklet
          await initRNNoiseWorklet(audioContext);
          
          // 创建AudioWorklet节点
          const workletNode = new AudioWorkletNode(audioContext, NOISE_SUPPRESSOR_WORKLET_NAME);
          workletNodeRef.current = workletNode;
          
          // 连接节点: 源 -> 降噪worklet -> 分析器
          source.disconnect(analyser);
          source.connect(workletNode);
          workletNode.connect(analyser);
          
          // 创建处理器节点
          const processor = audioContext.createScriptProcessor(1024, 1, 1);
          processor.onaudioprocess = handleAudioProcess;
          
          // 连接到处理器: 分析器 -> 处理器 -> 输出（不播放）
          analyser.connect(processor);
          processor.connect(audioContext.destination);
          processorRef.current = processor;
          
          console.log('RNNoise降噪处理已启用');
        } catch (error) {
          console.error('设置RNNoise降噪失败:', error);
          console.log('回退到传统音频处理...');
          setUseRNNoise(false);
          
          // 回退到传统音频处理
          const processor = audioContext.createScriptProcessor(1024, 1, 1);
          processor.onaudioprocess = handleAudioProcess;
          source.connect(processor);
          processor.connect(audioContext.destination);
          processorRef.current = processor;
        }
      } else {
        // 使用传统方式创建处理器节点
        const processor = audioContext.createScriptProcessor(1024, 1, 1);
        processor.onaudioprocess = handleAudioProcess;
        source.connect(processor);
        processor.connect(audioContext.destination);
        processorRef.current = processor;
      }
      
      // 开始音量可视化
      startVolumeMetering();
      
      console.log('录音已成功启动');
    } catch (error) {
      console.error('开始录音时出错:', error);
      alert(`无法访问音频: ${error}`);
      setIsRecording(false);
      onRecordingStateChange?.(false);  // 通知父组件录音失败
    }
  };
  
  // 停止录音
  const stopRecording = async () => {
    console.log('停止录音...');
    // 停止音量可视化
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // 清理音频处理资源
    if (processorRef.current && audioContextRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    // 清理WorkletNode
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    console.log('录音已停止，资源已清理');
    setIsRecording(false);
    setAudioLevel(0);
    onRecordingStateChange?.(false);  // 通知父组件录音停止
  };
  
  // 处理音频数据
  const handleAudioProcess = async (e: AudioProcessingEvent) => {
    try {
      // 获取音频数据
      const inputBuffer = e.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      
      // 将Float32Array转换为Int16Array
      const int16Array = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      // 计算音频统计信息
      let sum = 0;
      let max = 0;
      for (let i = 0; i < int16Array.length; i++) {
        const abs = Math.abs(int16Array[i]);
        sum += abs;
        if (abs > max) max = abs;
      }
      const average = sum / int16Array.length;
      
      console.log(`音频统计: 最大=${max}, 平均=${average.toFixed(2)}, 样本数=${int16Array.length}`);
      
      // 音量过低警告
      if (max < 1000) {
        console.warn('警告: 音频音量可能太低，可能无法被语音检测捕获');
      }
      
      // 如果RNNoise已启用，则减少或禁用之前基于阈值的过滤方法
      let isLikelyVoice = true;
      
      // 使用逻辑判断而非类型比较
      if (!useRNNoise && noiseFilterLevel !== 'off') {
        // 噪声过滤: 根据选择的过滤级别设置阈值
        let volumeThreshold = 0;
        let rmsThreshold = 0;
        
        // 根据噪声过滤级别设置不同的阈值
        if (noiseFilterLevel === 'low') {
          // 低过滤级别 - 仅过滤非常低的音量
          volumeThreshold = 1000;
          rmsThreshold = 300;
        } else if (noiseFilterLevel === 'medium') {
          // 中等过滤级别
          volumeThreshold = 2000;
          rmsThreshold = 500;
        } else if (noiseFilterLevel === 'high') {
          // 高过滤级别 - 更严格的过滤
          volumeThreshold = 3000;
          rmsThreshold = 800;
        } else {
          // off或其他情况
          volumeThreshold = 0;
          rmsThreshold = 0;
        }
        
        // 计算均方根 (RMS) 值，这是检测声音活动的更好指标
        let sumOfSquares = 0;
        for (let i = 0; i < int16Array.length; i++) {
          sumOfSquares += int16Array[i] * int16Array[i];
        }
        const rms = Math.sqrt(sumOfSquares / int16Array.length);
        
        // 进行简单的声音活动检测
        isLikelyVoice = max > volumeThreshold || rms > rmsThreshold;
        
        // 分析人声频率范围 (大约85-255Hz为男声基音, 165-255Hz为女声基音)
        // 我们扩大范围一些，检查更广的频率
        const voiceFreqMin = 5;  // ~80Hz 在16kHz采样率下的FFT bin
        const voiceFreqMax = 25; // ~400Hz 在16kHz采样率下的FFT bin
        
        // 计算人声频率范围的能量占比
        let voiceRangeEnergy = 0;
        let totalEnergy = 1; // 防止除以零
        
        for (let i = 0; i < int16Array.length; i++) {
          const energy = int16Array[i] * int16Array[i]; // 能量正比于平方幅度
          totalEnergy += energy;
          
          if (i >= voiceFreqMin && i <= voiceFreqMax) {
            voiceRangeEnergy += energy;
          }
        }
        
        const voiceEnergyRatio = voiceRangeEnergy / totalEnergy;
        console.log(`频率分析: 人声频率能量占比 = ${(voiceEnergyRatio * 100).toFixed(2)}%`);
        
        // 判断是否包含显著的人声成分
        // 根据过滤级别调整阈值
        const voiceRatioThreshold = noiseFilterLevel === 'high' ? 0.25 : 0.15;
        
        const hasSignificantVoiceFreq = voiceEnergyRatio > voiceRatioThreshold;
        console.log(`频率检测结果: ${hasSignificantVoiceFreq ? '可能是人声' : '可能是噪声'}`);
        
        // 结合音量和频率分析结果
        // 在高过滤级别下，要求同时通过音量检测和频率检测
        if (noiseFilterLevel === 'high') {
          isLikelyVoice = isLikelyVoice && hasSignificantVoiceFreq;
        } else {
          // 中等过滤级别下，如果频率检测认为是人声，就更有可能保留
          if (hasSignificantVoiceFreq) {
            isLikelyVoice = true;
          }
        }
      } else if (useRNNoise) {
        // 对于RNNoise处理后的音频，执行简单的音量检测
        // RNNoise应该已经过滤了大部分噪音，所以我们只需要检查是否有足够的音量
        isLikelyVoice = max > 500; // 使用较低的阈值，因为RNNoise已经降低了噪音
        console.log(`RNNoise处理后的音量检测: ${isLikelyVoice ? '有声音活动' : '无声音活动'} (最大音量=${max})`);
      }
      
      // 静音检测和自动暂停逻辑
      if (autoPauseAfterSilence) {
        if (!isLikelyVoice) {
          // 如果检测到静音，增加静音计数器
          silenceCounterRef.current += 1;
          
          // 如果静音持续超过5秒 (大约50帧，因为每帧约0.1秒)
          if (silenceCounterRef.current > 50 && !silenceTimerActive) {
            console.log('检测到持续静音，准备自动暂停录音');
            setSilenceTimerActive(true);
            
            // 设置一个倒计时，3秒后自动停止录音
            silenceTimerRef.current = setTimeout(() => {
              console.log('由于持续静音，自动停止录音');
              stopRecording();
              setSilenceTimerActive(false);
            }, 3000);
          }
        } else {
          // 如果检测到声音，重置静音计数器
          silenceCounterRef.current = 0;
          
          // 如果静音定时器正在运行，取消它
          if (silenceTimerRef.current && silenceTimerActive) {
            console.log('检测到声音，取消自动暂停');
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
            setSilenceTimerActive(false);
          }
        }
      }
      
      // 如果声音太弱或不像人声，跳过此帧音频数据
      if (!isLikelyVoice) {
        console.log('跳过低音量或非人声数据');
        return;
      }
      
      // 检查WebSocket连接状态
      if (!isConnected) {
        console.warn('发送前检测到WebSocket未连接，跳过发送');
        return;
      }
      
      // 发送数据到WebSocket
      console.log(`发送音频数据: ${int16Array.buffer.byteLength} 字节`);
      try {
        await audioTranscriptionService.sendAudioData(int16Array.buffer);
      } catch (error) {
        console.error('发送音频数据时出错:', error);
      }
    } catch (error) {
      console.error('处理音频数据时出错:', error);
    }
  };
  
  // 更新音频可视化
  const startVolumeMetering = () => {
    const updateVolume = () => {
      if (!analyserRef.current) return;
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      
      // 计算音量平均值
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      
      const average = sum / dataArray.length;
      setAudioLevel(average / 255); // 归一化为0-1范围
      
      animationFrameRef.current = requestAnimationFrame(updateVolume);
    };
    
    updateVolume();
  };
  
  // 处理设备选择变更
  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    setSelectedDevice(deviceId);
    
    // 如果正在录音，停止并重新开始
    if (isRecording) {
      stopRecording();
      setTimeout(() => {
        startRecording();
      }, 500);
    }
  };
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-white">音频录制</h2>
      
      {/* 连接状态 */}
      <div className="mb-4">
        <div className="flex items-center space-x-2">
          <div 
            className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} 
          />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {connectionStatus === 'connected' ? '已连接' :
             connectionStatus === 'connecting' ? '正在连接...' :
             '未连接'}
          </span>
        </div>
      </div>
      
      {/* 当前配置信息 */}
      <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">当前配置</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center">
            <span className="text-gray-500 dark:text-gray-400 mr-2">语言:</span>
            <span className="font-medium">{
              {
                'zh': '中文',
                'en': '英文',
                'ja': '日文',
                'ko': '韩文',
                'fr': '法语',
                'de': '德语',
                'ru': '俄语'
              }[language] || language
            }</span>
          </div>
          <div className="flex items-center">
            <span className="text-gray-500 dark:text-gray-400 mr-2">模型:</span>
            <span className="font-medium">{
              {
                'tiny': '超小型',
                'base': '基础型',
                'small': '小型',
                'medium': '中型',
                'large': '大型'
              }[modelType] || modelType
            }</span>
          </div>
          <div className="flex items-center">
            <span className="text-gray-500 dark:text-gray-400 mr-2">翻译语言:</span>
            <span className="font-medium">{
              {
                'zh': '中文',
                'en': '英文',
                'ja': '日文',
                'ko': '韩文',
                'fr': '法语',
                'de': '德语',
                'ru': '俄语'
              }[targetLanguage] || targetLanguage
            }</span>
          </div>
          <div className="flex items-center">
            <span className="text-gray-500 dark:text-gray-400 mr-2">连接ID:</span>
            <span className="font-medium text-xs">{isConnected ? audioTranscriptionService.getClientId() : '未连接'}</span>
          </div>
          <div className="flex items-center">
            <span className="text-gray-500 dark:text-gray-400 mr-2">上次更新:</span>
            <span className="font-medium text-xs">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
      
      {/* 音频源选择 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          音频来源
        </label>
        <select
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
          value={audioSource}
          onChange={(e) => setAudioSource(e.target.value as 'microphone' | 'system' | 'both')}
          disabled={isRecording}
        >
          <option value="microphone">麦克风（外部声音）</option>
          {isSystemAudioSupported && (
            <>
              <option value="system">系统声音（电脑内部）</option>
              <option value="both">同时使用两者</option>
            </>
          )}
        </select>
        {!isSystemAudioSupported && (
          <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
            注意：您的浏览器不支持系统音频捕获。如需此功能，请使用最新版本的Chrome或Edge浏览器。
          </p>
        )}
      </div>
      
      {/* 只在选择麦克风时显示设备选择 */}
      {(audioSource === 'microphone' || audioSource === 'both') && (
        <div className="mb-4">
          <label htmlFor="device-select" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            麦克风设备
          </label>
          <select
            id="device-select"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
            value={selectedDevice}
            onChange={handleDeviceChange}
            disabled={isRecording}
          >
            {audioDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `麦克风 ${device.deviceId.substring(0, 8)}...`}
              </option>
            ))}
            {audioDevices.length === 0 && (
              <option value="">无可用设备</option>
            )}
          </select>
        </div>
      )}
      
      {/* 噪声过滤设置 */}
      <div className="mb-4">
        <div className="flex items-center">
          <input
            id="use-rnnoise"
            type="checkbox"
            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            checked={useRNNoise}
            onChange={(e) => setUseRNNoise(e.target.checked)}
          />
          <label htmlFor="use-rnnoise" className="ml-2 block text-sm text-gray-700 dark:text-gray-200">
            使用RNNoise专业降噪（推荐）
          </label>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ml-6">
          RNNoise使用深度学习技术，能有效去除背景噪音，保留清晰的人声
        </p>
      </div>
      
      {!useRNNoise && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            传统噪声过滤级别
          </label>
          <select
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white"
            value={noiseFilterLevel}
            onChange={(e) => setNoiseFilterLevel(e.target.value as 'off' | 'low' | 'medium' | 'high')}
          >
            <option value="off">关闭 - 不过滤</option>
            <option value="low">低 - 轻微过滤</option>
            <option value="medium">中 - 平衡过滤</option>
            <option value="high">高 - 严格过滤</option>
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            较高的过滤级别可减少背景噪音，但可能会过滤掉较轻的语音
          </p>
        </div>
      )}
      
      {/* 自动暂停设置 */}
      <div className="mb-4">
        <div className="flex items-center">
          <input
            id="auto-pause"
            type="checkbox"
            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            checked={autoPauseAfterSilence}
            onChange={(e) => setAutoPauseAfterSilence(e.target.checked)}
          />
          <label htmlFor="auto-pause" className="ml-2 block text-sm text-gray-700 dark:text-gray-200">
            检测到静音后自动停止录音
          </label>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 ml-6">
          启用后，系统将在检测到约5秒连续静音后，自动停止录音
        </p>
      </div>
      
      {/* 音量显示 */}
      <div className="mb-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary-500 transition-all duration-100"
            style={{ width: `${audioLevel * 100}%` }}
          />
        </div>
      </div>
      
      {/* 控制按钮 */}
      <button
        className={`w-full py-3 rounded-md font-bold transition-colors duration-200 ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-primary-500 hover:bg-primary-600 text-white'
        }`}
        onClick={toggleRecording}
        disabled={!isConnected}
      >
        {isRecording ? '停止录音' : '开始录音'}
      </button>
      
      {/* 添加配置检查组件 */}
      <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
        <CheckConfig language={language} modelType={modelType} targetLanguage={targetLanguage} />
      </div>
    </div>
  );
};

export default AudioRecorder; 