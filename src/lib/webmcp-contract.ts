export const WEBMCP_SCHEMA_VERSION = '1.0';

export type WebMCPNavigation = {
  route: string;
  selectedId?: string;
  tab?: string;
};

export type WebMCPEnvelope<T> = {
  schemaVersion: typeof WEBMCP_SCHEMA_VERSION;
  kind: string;
  ok: boolean;
  data: T;
  navigation?: WebMCPNavigation;
  nextActions?: string[];
  notices?: string[];
};

export function webmcpResponse<T>(
  kind: string,
  data: T,
  options: Omit<WebMCPEnvelope<T>, 'schemaVersion' | 'kind' | 'ok' | 'data'> = {},
) {
  return JSON.stringify({
    schemaVersion: WEBMCP_SCHEMA_VERSION,
    kind,
    ok: true,
    data,
    ...options,
  } satisfies WebMCPEnvelope<T>, null, 2);
}

export function webmcpError(
  kind: string,
  code: string,
  message: string,
  navigation?: WebMCPNavigation,
) {
  return JSON.stringify({
    schemaVersion: WEBMCP_SCHEMA_VERSION,
    kind,
    ok: false,
    error: { code, message },
    ...(navigation ? { navigation } : {}),
  }, null, 2);
}
