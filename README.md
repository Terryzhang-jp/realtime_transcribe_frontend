# 实时语音转写系统前端

这是一个基于Next.js和React的实时语音转写系统前端，提供用户友好的界面进行实时语音转写、文本优化和翻译功能。

## 功能特点

- 实时语音转写显示
- 专业级RNNoise降噪处理
- 多语言支持（中文、英文、日文等）
- 文本智能优化显示
- 实时翻译结果展示
- 响应式设计，支持各种设备
- 深色/浅色模式支持

## 技术栈

- Next.js
- React
- TypeScript
- Tailwind CSS
- WebSocket
- Web Audio API
- RNNoise-WASM

## 安装与使用

1. 克隆仓库
```bash
git clone https://github.com/Terryzhang-jp/realtime_transcribe_frontend.git
cd realtime_transcribe_frontend
```

2. 安装依赖
```bash
npm install
```

3. 配置环境变量
```bash
cp .env.example .env.local
# 编辑.env.local文件，配置后端API地址
```

4. 运行开发服务器
```bash
npm run dev
```

5. 构建生产版本
```bash
npm run build
npm start
```

## 后端服务

本前端应与[实时语音转写系统后端](https://github.com/Terryzhang-jp/realtime_transcirbe_backend)配合使用。

## 浏览器支持

- Chrome/Edge (推荐)
- Firefox
- Safari

## 许可证

MIT
