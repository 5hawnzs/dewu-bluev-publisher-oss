'use strict';
// 社区版只连接使用者自己的服务，不携带原项目的地址或公开密钥。
module.exports = {
  url: process.env.BLUEV_OSS_SUPABASE_URL || '',
  anonKey: process.env.BLUEV_OSS_SUPABASE_ANON_KEY || '',
  org: process.env.BLUEV_OSS_ORG || 'community'
};
