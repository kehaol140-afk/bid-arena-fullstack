import { request } from './http'
import type { LoginRequest, LoginResponse, User } from '@/types'

export function loginApi(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>({ method: 'post', url: '/api/v1/auth/login', data: payload })
}

export function logoutApi(): Promise<null> {
  return request<null>({ method: 'post', url: '/api/v1/auth/logout' })
}

export function fetchMeApi(): Promise<User> {
  return request<User>({ method: 'get', url: '/api/v1/users/me' })
}
