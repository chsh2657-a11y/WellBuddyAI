/** API 오류 응답(AllExceptionsFilter 형식) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** 액세스 토큰(wb_at) 만료 시 리프레시 쿠키로 한 번만 재발급을 시도한다(동시 요청은 하나로 합친다). */
async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: unknown;
  } | null;
  return new ApiError(
    res.status,
    body?.code ?? 'ERROR',
    body?.message ?? '요청을 처리하지 못했습니다.',
    body?.details,
  );
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; retry?: boolean } = {},
): Promise<T> {
  const { json, retry = true, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return apiFetch<T>(path, { ...init, retry: false });
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 파일 응답(엑셀 등)을 받아 브라우저 다운로드로 저장한다. */
export async function apiDownload(
  path: string,
  filename: string,
  init: RequestInit & { json?: unknown; retry?: boolean } = {},
): Promise<void> {
  const { json, retry = true, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 401 && retry && (await refreshSession())) {
    return apiDownload(path, filename, { ...init, retry: false });
  }
  if (!res.ok) throw await toApiError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  // 바로 치우면 브라우저가 파일 이름(download 속성)을 잃으므로 조금 뒤에 정리한다
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
