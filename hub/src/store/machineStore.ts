import type { Database } from 'bun:sqlite'

import type { MachineStorePort } from './ports/coreStores'
import type { StoredMachine, VersionedUpdateResult } from './types'
import {
    deleteMachineByNamespace,
    type DeleteMachineResult,
    getMachine,
    getMachineByNamespace,
    getMachines,
    getMachinesByNamespace,
    getOrCreateMachine,
    updateMachineRunnerState,
    updateMachineMetadata
} from './machines'

export class MachineStore implements MachineStorePort {
    private readonly db: Database

    constructor(
        db: Database,
        private readonly onSessionsDeleted?: (sessionIds: string[]) => void,
        private readonly onChange?: () => void
    ) {
        this.db = db
    }

    getOrCreateMachine(
        id: string,
        metadata: unknown,
        runnerState: unknown,
        namespace: string,
        options?: { ownerUserId?: number | null; teamId?: string | null }
    ): StoredMachine {
        const result = getOrCreateMachine(this.db, id, metadata, runnerState, namespace, options)
        this.onChange?.()
        return result
    }

    updateMachineMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        const result = updateMachineMetadata(this.db, id, metadata, expectedVersion, namespace)
        if (result.result === 'success') this.onChange?.()
        return result
    }

    updateMachineRunnerState(
        id: string,
        runnerState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        const result = updateMachineRunnerState(this.db, id, runnerState, expectedVersion, namespace)
        if (result.result === 'success') this.onChange?.()
        return result
    }

    getMachine(id: string): StoredMachine | null {
        return getMachine(this.db, id)
    }

    getMachineByNamespace(id: string, namespace: string): StoredMachine | null {
        return getMachineByNamespace(this.db, id, namespace)
    }

    getMachines(): StoredMachine[] {
        return getMachines(this.db)
    }

    getMachinesByNamespace(namespace: string): StoredMachine[] {
        return getMachinesByNamespace(this.db, namespace)
    }

    deleteMachineByNamespace(id: string, namespace: string): DeleteMachineResult {
        const result = deleteMachineByNamespace(this.db, id, namespace)
        if (result.deletedSessionIds.length > 0) {
            this.onSessionsDeleted?.(result.deletedSessionIds)
        }
        if (result.machineDeleted) this.onChange?.()
        return result
    }
}

export type { DeleteMachineResult }
