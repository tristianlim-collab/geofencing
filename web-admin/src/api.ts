export type User = {
  id: string;
  role: 'admin' | 'teacher' | 'student';
  name: string;
  username?: string;
  studentId?: string;
};

const API_BASE_ENV = (import.meta.env.VITE_API_BASE as string | undefined) || '';
let resolvedApiBase: string | null = null;
let resolvingApiBase: Promise<string> | null = null;

const TOKEN_KEY = 'geoatt.admin.sid';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise
      .then(value => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(err => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

async function canReachApi(base: string) {
  try {
    const res = await withTimeout(fetch(`${base}/health`, { method: 'GET' }), 1500);
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

async function resolveApiBase() {
  if (resolvedApiBase) return resolvedApiBase;
  if (resolvingApiBase) return resolvingApiBase;

  resolvingApiBase = (async () => {
    if (API_BASE_ENV) {
      resolvedApiBase = API_BASE_ENV;
      return resolvedApiBase;
    }

    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const hostSet = new Set([hostname, '127.0.0.1', 'localhost']);
    const candidates: string[] = [];

    for (const host of hostSet) {
      for (let port = 3100; port <= 3110; port += 1) {
        candidates.push(`${protocol}//${host}:${port}/api`);
      }
    }

    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await canReachApi(candidate)) {
        resolvedApiBase = candidate;
        return candidate;
      }
    }

    resolvedApiBase = `${protocol}//${hostname}:3100/api`;
    return resolvedApiBase;
  })();

  return resolvingApiBase;
}

function buildCandidateApiBases() {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const hostSet = new Set([hostname, '127.0.0.1', 'localhost']);
  const candidates: string[] = [];
  for (const host of hostSet) {
    for (let port = 3100; port <= 3110; port += 1) {
      candidates.push(`${protocol}//${host}:${port}/api`);
    }
  }
  return candidates;
}

async function requestJson(
  apiBase: string,
  path: string,
  init: RequestInit | undefined,
  headers: Record<string, string>
) {
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers
    });
  } catch {
    throw new Error(
      `Failed to fetch API at ${apiBase}. Ensure backend is running and reachable from this device.`
    );
  }

  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  return { res, payload };
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  token?: string | null
): Promise<T> {
  let apiBase = await resolveApiBase();
  const sid = token ?? getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (sid) headers.Authorization = `Bearer ${sid}`;

  let { res, payload } = await requestJson(apiBase, path, init, headers);

  const routeNotFound = !res.ok && (payload?.error || '').toString().toLowerCase().includes('api route not found');
  if (routeNotFound) {
    const candidates = buildCandidateApiBases().filter(candidate => candidate !== apiBase);
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await canReachApi(candidate))) continue;
      // eslint-disable-next-line no-await-in-loop
      const retried = await requestJson(candidate, path, init, headers);
      const retriedRouteNotFound = !retried.res.ok && (retried.payload?.error || '').toString().toLowerCase().includes('api route not found');
      if (retriedRouteNotFound) continue;
      resolvedApiBase = candidate;
      resolvingApiBase = null;
      apiBase = candidate;
      res = retried.res;
      payload = retried.payload;
      break;
    }
  }

  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload as T;
}
