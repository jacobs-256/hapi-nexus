export const ELASTIC_BULK_MAX_BYTES = 5 * 1024 * 1024
export const ELASTIC_BULK_MAX_DOCS = 2_000
export const ELASTIC_SEARCH_SIZE = 10_000
export const ELASTIC_SCHEDULED_SEARCH_SIZE = 1_000
export const ELASTIC_SEARCH_PAGE_SIZE = 500

export const ELASTIC_CURL_TIMEOUT_SECONDS = (() => {
    const seconds = Number(process.env.HAPI_ELASTICSEARCH_REQUEST_TIMEOUT_MS ?? 300_000) / 1000
    return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, seconds) : 300
})()
