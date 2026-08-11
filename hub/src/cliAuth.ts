import { getConfiguration } from './configuration'
import { getOrCreateOwnerId } from './config/ownerId'
import type { Store, StoredUser } from './store'
import { parseAccessToken } from './utils/accessToken'
import { constantTimeEquals } from './utils/crypto'

export type CliAuthSource = 'system' | 'user'

export type CliAuthContext = {
    namespace: string
    userId: number
    authPlatform: 'owner' | 'local'
    role: 'admin' | 'user'
    source: CliAuthSource
}

type ResolveCliAuthTokenOptions = {
    getOwnerUserId?: () => Promise<number>
}

function isValidLocalTokenUser(user: StoredUser | null): user is StoredUser {
    return user !== null
        && user.platform === 'local'
        && user.disabledAt === null
        && user.accessToken !== null
}

export async function resolveCliAuthToken(
    store: Store,
    rawToken: string,
    options?: ResolveCliAuthTokenOptions
): Promise<CliAuthContext | null> {
    const token = rawToken.trim()
    if (!token) {
        return null
    }

    const configuration = getConfiguration()
    const parsedSystemToken = parseAccessToken(token)
    if (parsedSystemToken && constantTimeEquals(parsedSystemToken.baseToken, configuration.cliApiToken)) {
        const userId = await (options?.getOwnerUserId ?? getOrCreateOwnerId)()
        return {
            namespace: parsedSystemToken.namespace,
            userId,
            authPlatform: 'owner',
            role: 'admin',
            source: 'system'
        }
    }

    const user = store.users.getUserByAccessToken(token)
    if (!isValidLocalTokenUser(user)) {
        return null
    }

    return {
        namespace: user.namespace,
        userId: user.id,
        authPlatform: 'local',
        role: user.role,
        source: 'user'
    }
}
