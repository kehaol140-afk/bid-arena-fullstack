import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import type { ApiResult } from '@/types'
import { readAuth, clearAuth } from '@/utils/authStorage'

/** 业务/网络错误统一形态（对齐契约 §6 错误码表） */
export class ApiError extends Error {
  /** 业务错误码（契约定义）或 9999（网络/未知） */
  readonly code: number
  /** HTTP 状态码；网络层错误为 0 */
  readonly status: number

  constructor(code: number, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }

  get isAuthError(): boolean {
    return this.code === 1001 || this.status === 401
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }
}

let onUnauthorized: (() => void) | null = null

/** 注册会话失效回调（main.ts 中接入路由跳转） */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 10000,
})

http.interceptors.request.use((config) => {
  const saved = readAuth()
  if (saved?.token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${saved.token}`
  }
  return config
})

/**
 * 统一请求入口：解包 ApiResult，code!==0 抛 ApiError。
 * 携带会话 token 却收到 401/1001 时清理本地会话并通知（登录接口本身的 401 不触发）。
 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  let res: { status: number; data: ApiResult<T> | undefined } | null = null
  let hadToken = false
  try {
    hadToken = !!readAuth()?.token
    res = await http.request<ApiResult<T>>(config)
  } catch (e) {
    if (e instanceof AxiosError) {
      const body = e.response?.data as ApiResult<T> | undefined
      if (body && typeof body.code === 'number') {
        handleAuthLoss(body.code, e.response?.status ?? 0, hadToken && !isAuthPath(config.url))
        throw new ApiError(body.code, body.message || '请求失败', e.response?.status ?? 0)
      }
      throw new ApiError(9999, '网络异常，无法连接服务器', 0)
    }
    throw e
  }
  const body = res.data
  if (!body || typeof body.code !== 'number') {
    throw new ApiError(9999, '响应格式异常', res.status)
  }
  if (body.code !== 0) {
    handleAuthLoss(body.code, res.status, hadToken && !isAuthPath(config.url))
    throw new ApiError(body.code, body.message || '请求失败', res.status)
  }
  return body.data as T
}

function isAuthPath(url: string | undefined): boolean {
  return !!url && url.includes('/auth/login')
}

function handleAuthLoss(code: number, status: number, eligible: boolean): void {
  if (eligible && (code === 1001 || status === 401)) {
    clearAuth()
    onUnauthorized?.()
  }
}
