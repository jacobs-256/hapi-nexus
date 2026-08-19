export function positiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name])
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
