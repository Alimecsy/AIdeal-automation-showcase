export function getBackendApiBaseUrl() {
  return (
    process.env.API_BASE_URL ??
    `http://127.0.0.1:${process.env.API_PORT ?? "4000"}`
  );
}

export async function backendApiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${getBackendApiBaseUrl()}/api${path}`, {
    ...init,
    cache: "no-store",
  });
}
