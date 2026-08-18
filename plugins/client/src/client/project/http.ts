// Author: Zihan Wang
// <wangzh011031@163.com>
/** Response parsing helpers for project workspace endpoints. */

interface ErrorPayload {
  error?: unknown
}

function responseErrorMessage(status: number, body: string): string {
  const message = body.trim()
  return message === '' ? `Request failed (${String(status)})` : message
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const trimmed = body.trim()
  const wantsJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')

  if (!wantsJson) {
    throw new Error(responseErrorMessage(response.status, body))
  }

  let value: T
  try {
    value = JSON.parse(body) as T
  } catch {
    throw new Error(responseErrorMessage(response.status, body))
  }

  if (!response.ok) {
    const payload = value as ErrorPayload
    throw new Error(typeof payload.error === 'string' && payload.error.trim() !== ''
      ? payload.error
      : responseErrorMessage(response.status, body))
  }

  return value
}
