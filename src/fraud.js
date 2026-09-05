// ==============================================================================
// src/fraud.js - Fraud DB Detection (可选功能模块)
// 反诈为项目核心，默认打包；ENV_ENABLE_FRAUD_CHECK 设为 false/0/off/no 时
// 构建期裁剪、运行期跳过（详见 build.js FEATURE_MODULES）
// ==============================================================================

import { FRAUD_CACHE_TTL, getOptionalEnv, getEnableFraudCheck } from './config.js';
import { fetchRemoteDb } from './cache.js';

export function getFraudDbUrl() {
  return getOptionalEnv('ENV_FRAUD_DB_URL', 'https://raw.githubusercontent.com/ekishion/nfd/main/data/fraud.db');
}

export async function isFraud(id) {
  if (!getEnableFraudCheck()) return false;
  const lines = await fetchRemoteDb(getFraudDbUrl(), FRAUD_CACHE_TTL);
  return lines.includes(String(id));
}
