import { describe, expect, it } from 'bun:test'
import { Store } from './index'
import { mergeMachineMetadata } from './machines'

describe('machine metadata backfill', () => {
    it('merges incoming metadata over stored fields on re-registration', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', null, null, 'ns')
        expect(created.metadata).toBeNull()

        const refreshed = store.machines.getOrCreateMachine(
            'machine-1',
            { host: 'MacBook Pro', platform: 'darwin' },
            null,
            'ns'
        )

        expect(refreshed.metadata).toEqual({ host: 'MacBook Pro', platform: 'darwin' })
        expect(refreshed.metadataVersion).toBe(created.metadataVersion + 1)
    })

    it('preserves hub-side fields the CLI never sends', () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine('machine-1', { displayName: 'Workstation', host: 'old-host' }, null, 'ns')

        const refreshed = store.machines.getOrCreateMachine('machine-1', { host: 'new-host' }, null, 'ns')

        expect(refreshed.metadata).toEqual({ displayName: 'Workstation', host: 'new-host' })
    })

    it('does not write when the merge changes nothing', () => {
        const store = new Store(':memory:')
        const created = store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'ns')

        const again = store.machines.getOrCreateMachine('machine-1', { host: 'alpha' }, null, 'ns')

        expect(again.metadataVersion).toBe(created.metadataVersion)
        expect(again.updatedAt).toBe(created.updatedAt)
    })
})

describe('mergeMachineMetadata', () => {
    it('returns undefined for non-object incoming metadata', () => {
        expect(mergeMachineMetadata({ host: 'a' }, null)).toBeUndefined()
        expect(mergeMachineMetadata({ host: 'a' }, 'host')).toBeUndefined()
        expect(mergeMachineMetadata({ host: 'a' }, ['host'])).toBeUndefined()
    })

    it('returns undefined when the merge is a no-op', () => {
        expect(mergeMachineMetadata({ host: 'a' }, { host: 'a' })).toBeUndefined()
    })
})

describe('MachineStore.deleteMachineByNamespace', () => {
    it('deletes the machine, its workspaces, machine-only projects, and related sessions', () => {
        const store = new Store(':memory:')
        try {
            store.machines.getOrCreateMachine(
                'machine-1',
                { host: 'one', platform: 'linux', happyCliVersion: '1.0.0' },
                null,
                'default'
            )
            store.machines.getOrCreateMachine(
                'machine-2',
                { host: 'two', platform: 'linux', happyCliVersion: '1.0.0' },
                null,
                'default'
            )
            store.machines.getOrCreateMachine(
                'machine-1-other-ns',
                { host: 'other', platform: 'linux', happyCliVersion: '1.0.0' },
                null,
                'other'
            )

            const machineOnlyProject = store.projects.createProject('default', 'Machine Only', 1)
            store.projects.addProjectWorkspace(machineOnlyProject.id, 'machine-1', '/srv/only', 1)
            const sharedProject = store.projects.createProject('default', 'Shared', 1)
            store.projects.addProjectWorkspace(sharedProject.id, 'machine-1', '/srv/shared-one', 1)
            store.projects.addProjectWorkspace(sharedProject.id, 'machine-2', '/srv/shared-two', 1)

            const byMachineMetadata = store.sessions.getOrCreateSession(
                'session-machine',
                { path: '/srv/only', host: 'one', machineId: 'machine-1' },
                null,
                'default'
            )
            const byMachineOnlyProject = store.sessions.getOrCreateSession(
                'session-project',
                { path: '/srv/only', host: 'one' },
                null,
                'default',
                undefined,
                undefined,
                undefined,
                undefined,
                { projectId: machineOnlyProject.id, createdByUserId: 1 }
            )
            const sharedProjectSession = store.sessions.getOrCreateSession(
                'session-shared',
                { path: '/srv/shared-two', host: 'two', machineId: 'machine-2' },
                null,
                'default',
                undefined,
                undefined,
                undefined,
                undefined,
                { projectId: sharedProject.id, createdByUserId: 1 }
            )
            const otherNamespaceSession = store.sessions.getOrCreateSession(
                'session-other-ns',
                { path: '/srv/other', host: 'other', machineId: 'machine-1' },
                null,
                'other'
            )

            const result = store.machines.deleteMachineByNamespace('machine-1', 'default')

            expect(result.machineDeleted).toBe(true)
            expect(result.deletedProjectCount).toBe(1)
            expect(result.deletedProjectWorkspaceCount).toBe(2)
            expect(result.deletedSessionIds.sort()).toEqual([byMachineMetadata.id, byMachineOnlyProject.id].sort())
            expect(store.machines.getMachineByNamespace('machine-1', 'default')).toBeNull()
            expect(store.projects.getProjectByNamespace(machineOnlyProject.id, 'default')).toBeNull()
            expect(store.projects.getProjectByNamespace(sharedProject.id, 'default')).not.toBeNull()
            expect(store.projects.listProjectWorkspaces(sharedProject.id).map((workspace) => workspace.machineId)).toEqual(['machine-2'])
            expect(store.sessions.getSession(byMachineMetadata.id)).toBeNull()
            expect(store.sessions.getSession(byMachineOnlyProject.id)).toBeNull()
            expect(store.sessions.getSession(sharedProjectSession.id)).not.toBeNull()
            expect(store.sessions.getSession(otherNamespaceSession.id)).not.toBeNull()
        } finally {
            store.close()
        }
    })
})
