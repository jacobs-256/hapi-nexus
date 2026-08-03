import type { Store, StoredUser } from '../store'
import { DEFAULT_NAMESPACE } from '../utils/accessToken'

export type InitialAdminBootstrapResult =
    | { status: 'exists'; user: StoredUser }
    | {
        status: 'created'
        user: StoredUser
        namespace: string
        username: string
        passwordSource: 'environment' | 'default'
        password: string
    }
    | { status: 'conflict'; namespace: string; username: string; existingUser: StoredUser }
    | { status: 'invalid-password'; namespace: string; username: string }

export type InitialAdminBootstrapOptions = {
    namespace?: string
    username?: string
    password?: string
}

const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'admin'

function resolveInitialAdminUsername(value: string | undefined): string {
    const trimmed = value?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ADMIN_USERNAME
}

function hasActiveLocalAdmin(user: StoredUser): boolean {
    return user.platform === 'local' && user.role === 'admin' && user.disabledAt === null
}

export async function ensureInitialLocalAdmin(
    store: Store,
    options: InitialAdminBootstrapOptions = {}
): Promise<InitialAdminBootstrapResult> {
    const namespace = options.namespace?.trim() || DEFAULT_NAMESPACE
    const existingActiveAdmin = store.users
        .listUsersByNamespace(namespace)
        .find(hasActiveLocalAdmin)
    if (existingActiveAdmin) {
        return { status: 'exists', user: existingActiveAdmin }
    }

    const username = resolveInitialAdminUsername(
        options.username ?? process.env.HAPI_ADMIN_USERNAME
    )
    const existingUser = store.users.getLocalUserByUsername(namespace, username)
    if (existingUser) {
        return { status: 'conflict', namespace, username, existingUser }
    }

    const configuredPassword = options.password ?? process.env.HAPI_ADMIN_PASSWORD
    const passwordSource = configuredPassword ? 'environment' : 'default'
    const password = configuredPassword ?? DEFAULT_ADMIN_PASSWORD
    if (!password) {
        return { status: 'invalid-password', namespace, username }
    }

    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })
    const user = store.users.createLocalUser({
        namespace,
        username,
        passwordHash,
        displayName: 'Enterprise Admin',
        role: 'admin'
    })

    return {
        status: 'created',
        user,
        namespace,
        username,
        passwordSource,
        password
    }
}
