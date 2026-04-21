declare module "@abacatepay/sdk" {
  export class AbacatePayError extends Error {}

  export class HTTPError extends Error {
    route: string
    status: number
    method: string
  }

  export function AbacatePay(options: {
    secret: string
    rest?: Record<string, unknown>
  }): {
    rest: {
      get<T = any>(route: string, options?: Record<string, unknown>): Promise<T>
      post<T = any>(route: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<T>
      delete<T = any>(route: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<T>
      put<T = any>(route: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<T>
      patch<T = any>(route: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<T>
    }
  }
}
