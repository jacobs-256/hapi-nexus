import type { Database } from 'bun:sqlite'

import type { PushStorePort } from './ports/coreStores'
import type { StoredPushSubscription } from './types'
import { addPushSubscription, getPushSubscriptionsByNamespace, removePushSubscription } from './pushSubscriptions'

export class PushStore implements PushStorePort {
    private readonly db: Database

    constructor(db: Database, private readonly onChange?: () => void) {
        this.db = db
    }

    addPushSubscription(namespace: string, subscription: { endpoint: string; p256dh: string; auth: string }): void {
        addPushSubscription(this.db, namespace, subscription)
        this.onChange?.()
    }

    removePushSubscription(namespace: string, endpoint: string): void {
        removePushSubscription(this.db, namespace, endpoint)
        this.onChange?.()
    }

    getPushSubscriptionsByNamespace(namespace: string): StoredPushSubscription[] {
        return getPushSubscriptionsByNamespace(this.db, namespace)
    }
}
