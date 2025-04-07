// 导入polyfills（如果AudioWorklet环境中需要）
// 注意：在AudioWorklet环境中，一些全局对象可能不可用

// NoiseSuppressorWorklet类定义
class NoiseSuppressorWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._initialized = false;
    this._init();
    
    // 处理来自主线程的消息
    this.port.onmessage = (event) => {
      if (event.data.type === 'init') {
        console.log('[NoiseSuppressorWorklet] 初始化消息已接收');
      }
    };
  }
  
  async _init() {
    try {
      console.log('[NoiseSuppressorWorklet] 正在初始化');
      // 在真实实现中，这里会加载RNNoise WASM模块并创建处理器
      // 由于我们无法直接在Worklet中访问RNNoise库，这里简化处理
      this._initialized = true;
      console.log('[NoiseSuppressorWorklet] 初始化完成');
    } catch (error) {
      console.error('[NoiseSuppressorWorklet] 初始化失败:', error);
    }
  }
  
  process(inputs, outputs) {
    // 确保有音频输入
    if (inputs.length === 0 || inputs[0].length === 0) {
      return true;
    }
    
    const input = inputs[0][0];  // 获取第一个输入通道
    const output = outputs[0][0]; // 获取第一个输出通道
    
    if (!input || !output) {
      return true;
    }
    
    // 如果尚未初始化，则直接传递音频
    if (!this._initialized) {
      for (let i = 0; i < input.length; i++) {
        output[i] = input[i];
      }
      return true;
    }
    
    // 这里执行简单的噪音抑制 - 实际应用中应使用RNNoise算法
    // 目前我们实现一个简单的噪声门控，对小信号进行衰减
    const NOISE_THRESHOLD = 0.01;
    for (let i = 0; i < input.length; i++) {
      // 简单噪声门控
      if (Math.abs(input[i]) < NOISE_THRESHOLD) {
        output[i] = 0; // 低于阈值的信号设为0
      } else {
        output[i] = input[i]; // 保留高于阈值的信号
      }
    }
    
    // 返回true以保持处理器活动
    return true;
  }
}

// 注册处理器
registerProcessor('NoiseSuppressorWorklet', NoiseSuppressorWorklet); 