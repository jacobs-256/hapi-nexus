import type { Database } from 'bun:sqlite'

import type { UserStorePort } from './ports/coreStores'
import type { StoredUser } from './types'
import {
    addUser,
    createLocalUser,
    getLocalUserByUsername,
    getUser,
    getUserByAccessToken,
    getUserById,
    getUsersByPlatform,
    getUsersByPlatformAndNamespace,
    listUsersByNamespace,
    regenerateUserAccessToken,
    removeLocalUserById,
    removeUser,
    updateUser,
    updateLocalUsername,
    updateUserPassword,
    type CreateLocalUserInput,
    type UpdateLocalUsernameResult,
    type UpdateUserInput
} from './users'

export class UserStore implements UserStorePort {
    private readonly db: Database

    constructor(db: Database, private readonly onChange?: () => void) {
        this.db = db
    }

    getUser(platform: string, platformUserId: string): StoredUser | null {
        return getUser(this.db, platform, platformUserId)
    }

    getUserById(userId: number, namespace: string): StoredUser | null {
        return getUserById(this.db, userId, namespace)
    }

    getLocalUserByUsername(namespace: string, username: string): StoredUser | null {
        return getLocalUserByUsername(this.db, namespace, username)
    }

    getUserByAccessToken(accessToken: string): StoredUser | null {
        return getUserByAccessToken(this.db, accessToken)
    }

    getUsersByPlatform(platform: string): StoredUser[] {
        return getUsersByPlatform(this.db, platform)
    }

    listUsersByNamespace(namespace: string): StoredUser[] {
        return listUsersByNamespace(this.db, namespace)
    }

    getUsersByPlatformAndNamespace(platform: string, namespace: string): StoredUser[] {
        return getUsersByPlatformAndNamespace(this.db, platform, namespace)
    }

    addUser(platform: string, platformUserId: string, namespace: string): StoredUser {
        const result = addUser(this.db, platform, platformUserId, namespace)
        this.onChange?.()
        return result
    }

    createLocalUser(input: CreateLocalUserInput): StoredUser {
        const result = createLocalUser(this.db, input)
        this.onChange?.()
        return result
    }

    updateUser(userId: number, namespace: string, input: UpdateUserInput): StoredUser | null {
        const result = updateUser(this.db, userId, namespace, input)
        if (result) this.onChange?.()
        return result
    }

    updateUserPassword(userId: number, namespace: string, passwordHash: string): StoredUser | null {
        const result = updateUserPassword(this.db, userId, namespace, passwordHash)
        if (result) this.onChange?.()
        return result
    }

    updateLocalUsername(userId: number, namespace: string, username: string): UpdateLocalUsernameResult {
        const result = updateLocalUsername(this.db, userId, namespace, username)
        if (result.status === 'updated') this.onChange?.()
        return result
    }

    regenerateUserAccessToken(userId: number, namespace: string): StoredUser | null {
        const result = regenerateUserAccessToken(this.db, userId, namespace)
        if (result) this.onChange?.()
        return result
    }

    removeLocalUserById(userId: number, namespace: string, replacementOwnerUserId: number): StoredUser | null {
        const result = removeLocalUserById(this.db, userId, namespace, replacementOwnerUserId)
        if (result) this.onChange?.()
        return result
    }

    removeUser(platform: string, platformUserId: string): boolean {
        const result = removeUser(this.db, platform, platformUserId)
        if (result) this.onChange?.()
        return result
    }
}
