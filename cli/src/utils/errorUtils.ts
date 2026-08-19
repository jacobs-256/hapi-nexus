/**
 * Error handling utilities for API requests
 */

import type { AxiosResponse } from 'axios'

export type ErrorInfo = {
    message: string
    messageLower: string
    axiosCode?: string
    httpStatus?: number
    responseErrorText: string
    serverProtocolVersion?: number
}

/**
 * Create an Error for a successful HTTP response whose body fails schema validation.
 * Attaches the protocol version header so callers can detect version mismatch.
 */
export function apiValidationError(message: string, response: AxiosResponse, issues?: unknown): Error {
    const issueSummary = summarizeValidationIssues(issues)
    const err = new Error(issueSummary ? `${message}: ${issueSummary}` : message)
    const raw = response.headers?.['x-hapi-protocol-version']
    if (raw != null) {
        const pv = Number(raw)
        if (Number.isFinite(pv)) {
            ;(err as unknown as Record<string, unknown>).serverProtocolVersion = pv
        }
    }
    return err
}

function summarizeValidationIssues(issues: unknown): string | null {
    if (!Array.isArray(issues) || issues.length === 0) {
        return null
    }

    const parts = issues.slice(0, 5).map((issue) => {
        if (!issue || typeof issue !== 'object') {
            return null
        }
        const record = issue as Record<string, unknown>
        const path = Array.isArray(record.path)
            ? record.path.map((part) => String(part)).join('.')
            : ''
        const message = typeof record.message === 'string' ? record.message : 'invalid value'
        return path ? `${path}: ${message}` : message
    }).filter((part): part is string => Boolean(part))

    if (parts.length === 0) {
        return null
    }

    const remaining = issues.length - parts.length
    return remaining > 0 ? `${parts.join('; ')}; +${remaining} more` : parts.join('; ')
}

/**
 * Extract structured error information from an unknown error
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const messageLower = message.toLowerCase()

    if (typeof error !== 'object' || error === null) {
        return { message, messageLower, responseErrorText: '' }
    }

    const record = error as Record<string, unknown>
    const axiosCode = typeof record.code === 'string' ? record.code : undefined
    const response = typeof record.response === 'object' && record.response !== null
        ? (record.response as Record<string, unknown>)
        : undefined
    const httpStatus = typeof response?.status === 'number' ? response.status : undefined
    const responseData = response?.data
    const responseError = typeof responseData === 'object' && responseData !== null
        ? (responseData as Record<string, unknown>).error
        : undefined
    const responseErrorText = typeof responseError === 'string' ? responseError : ''

    // Protocol version: prefer direct property (set by apiValidationError),
    // fall back to axios response header (set by server on error responses)
    let serverProtocolVersion: number | undefined
    if (typeof record.serverProtocolVersion === 'number' && Number.isFinite(record.serverProtocolVersion)) {
        serverProtocolVersion = record.serverProtocolVersion
    } else {
        const headers = typeof response?.headers === 'object' && response.headers !== null
            ? (response.headers as Record<string, unknown>)
            : undefined
        const protocolHeader = headers?.['x-hapi-protocol-version']
        if (typeof protocolHeader === 'string' && protocolHeader !== '') {
            const pv = Number(protocolHeader)
            if (Number.isFinite(pv)) serverProtocolVersion = pv
        }
    }

    return {
        message,
        messageLower,
        axiosCode,
        httpStatus,
        responseErrorText,
        serverProtocolVersion
    }
}

/**
 * Check if an error is a retryable connection error
 *
 * Retryable errors:
 * - ECONNREFUSED - server not started
 * - ETIMEDOUT - connection timeout
 * - ENOTFOUND - DNS resolution failed
 * - ENETUNREACH - network unreachable
 * - ECONNRESET - connection reset
 * - 5xx - server errors
 *
 * Non-retryable errors:
 * - 401 - authentication failed
 * - 403 - permission denied
 * - 404 - endpoint not found
 * - other 4xx errors
 */
export function isRetryableConnectionError(error: unknown): boolean {
    const { axiosCode, httpStatus } = extractErrorInfo(error)

    // Retryable network errors
    if (axiosCode === 'ECONNREFUSED' ||
        axiosCode === 'ETIMEDOUT' ||
        axiosCode === 'ENOTFOUND' ||
        axiosCode === 'ENETUNREACH' ||
        axiosCode === 'ECONNRESET') {
        return true
    }

    // 5xx server errors are retryable
    if (httpStatus && httpStatus >= 500) {
        return true
    }

    // Other errors (401, 403, 404, etc.) are not retryable
    return false
}
