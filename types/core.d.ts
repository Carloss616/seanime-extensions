declare function fetch(url: string, options?: FetchOptions): Promise<FetchResponse>

interface FetchOptions {
    method?: string
    headers?: Record<string, string>
    body?: any
    noCloudflareBypass?: boolean
    timeout?: number
}

interface FetchResponse {
    status: number
    statusText: string
    method: string
    rawHeaders: Record<string, string[]>
    ok: boolean
    url: string
    headers: Record<string, string>
    cookies: Record<string, string>
    redirected: boolean
    contentType: string
    contentLength: number

    text(): string
    json<T = any>(): T
}

declare function $sleep(ms: number): void
declare function $clone<T = any>(value: T): T
declare function $replace<T = any>(value: T, newValue: T): void
declare function $toString(value: any): string

declare function $getUserPreference(name: string): string | undefined

interface Console {
    log(...args: unknown[]): void
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
    debug(...args: unknown[]): void
}
declare const console: Console
