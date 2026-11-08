import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };

/**
 * WellBuddy API 타입 안전 클라이언트.
 *   const api = createApiClient({ baseUrl: 'https://erp.example.com', headers: { authorization: `Bearer ${token}` } });
 *   const { data, error } = await api.GET('/api/health');
 */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
