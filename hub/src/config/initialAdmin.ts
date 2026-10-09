import type { Store, StoredUser } from '../store'
import { DEFAULT_NAMESPACE } from '../utils/accessToken'
import { LocalEmailSchema } from '@hapi/protocol'

export type InitialAdminBootstrapResult =
    | { status: 'exists'; user: StoredUser }
    | {
        status: 'created'
        user: StoredUser
        namespace: string
        email: string
        passwordSource: 'environment' | 'default'
        password: string
    }
    | { status: 'conflict'; namespace: string; email: string; existingUser: StoredUser }
    | { status: 'invalid-password'; namespace: string; email: string }

export type InitialAdminBootstrapOptions = {
    namespace?: string
    email?: string
    password?: string
}

const DEFAULT_ADMIN_EMAIL = 'admin@hapi.local'
const DEFAULT_ADMIN_PASSWORD = 'admin'

function resolveInitialAdminEmail(value: string | undefined): string {
    const trimmed = value?.trim()
    return LocalEmailSchema.parse(trimmed || DEFAULT_ADMIN_EMAIL)
}

function hasActiveLocalAdmin(user: StoredUser): boolean {
    return user.platform === 'local' && user.role === 'admin' && user.disabledAt === null
}

export async function ensureInitialLocalAdmin(
    store: Store,
    options: InitialAdminBootstrapOptions = {}
): Promise<InitialAdminBootstrapResult> {
    const namespace = options.namespace?.trim() || DEFAULT_NAMESPACE
    const existingActiveAdmin = (await store.users.listUsersByNamespace(namespace))
        .find(hasActiveLocalAdmin)
    if (existingActiveAdmin) {
        return { status: 'exists', user: existingActiveAdmin }
    }

    const email = resolveInitialAdminEmail(
        options.email ?? process.env.HAPI_ADMIN_EMAIL
    )
    const existingUser = await store.users.getLocalUserByEmail(namespace, email)
    if (existingUser) {
        return { status: 'conflict', namespace, email, existingUser }
    }

    const configuredPassword = options.password ?? process.env.HAPI_ADMIN_PASSWORD
    const passwordSource = configuredPassword ? 'environment' : 'default'
    const password = configuredPassword ?? DEFAULT_ADMIN_PASSWORD
    if (!password) {
        return { status: 'invalid-password', namespace, email }
    }

    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' })
    const user = await store.users.createLocalUser({
        namespace,
        email,
        passwordHash,
        displayName: 'Enterprise Admin',
        role: 'admin'
    })

    return {
        status: 'created',
        user,
        namespace,
        email,
        passwordSource,
        password
    }
}
