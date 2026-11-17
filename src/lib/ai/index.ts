/**
 * AI 层统一出口。业务代码只从这里 import，
 * 换 Provider / 改校验策略都不影响调用方。
 */
export * from './provider';
export * from './schemas';
export * from './prompts';
export * from './registry';
export { getEmbedding } from './embeddings';
export { hashEmbedding, tokenize } from './embedding-local';
