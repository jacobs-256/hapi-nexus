import type { Database } from 'bun:sqlite'

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

export class UserStore {
    private readonly db: Database

    constructor(db: Database) {
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
        return addUser(this.db, platform, platformUserId, namespace)
    }

    createLocalUser(input: CreateLocalUserInput): StoredUser {
        return createLocalUser(this.db, input)
    }

    updateUser(userId: number, namespace: string, input: UpdateUserInput): StoredUser | null {
        return updateUser(this.db, userId, namespace, input)
    }

    updateUserPassword(userId: number, namespace: string, passwordHash: string): StoredUser | null {
        return updateUserPassword(this.db, userId, namespace, passwordHash)
    }

    updateLocalUsername(userId: number, namespace: string, username: string): UpdateLocalUsernameResult {
        return updateLocalUsername(this.db, userId, namespace, username)
    }

    regenerateUserAccessToken(userId: number, namespace: string): StoredUser | null {
        return regenerateUserAccessToken(this.db, userId, namespace)
    }

    removeLocalUserById(userId: number, namespace: string, replacementOwnerUserId: number): StoredUser | null {
        return removeLocalUserById(this.db, userId, namespace, replacementOwnerUserId)
    }

    removeUser(platform: string, platformUserId: string): boolean {
        return removeUser(this.db, platform, platformUserId)
    }
}
