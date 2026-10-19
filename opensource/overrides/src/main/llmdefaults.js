'use strict';
// 使用自己的模型服务；真实密钥只能放本机配置或环境变量。
module.exports = {
  endpoint: process.env.BLUEV_OSS_MODEL_ENDPOINT || 'https://api.deepseek.com/v1',
  model: process.env.BLUEV_OSS_MODEL || 'deepseek-chat',
  apiKey: process.env.BLUEV_OSS_MODEL_KEY || '',
  imageCount: 2, videoFrames: 1, imageMaxSide: 768, timeoutSec: 90
};
