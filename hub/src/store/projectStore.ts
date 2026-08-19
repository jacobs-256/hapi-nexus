import type { Database } from 'bun:sqlite'

import type { ProjectStorePort } from './ports/coreStores'
import type {
    StoredProject,
    StoredProjectInvite,
    StoredProjectMember,
    StoredProjectWorkspace,
    StoredTeam
} from './types'
import {
    acceptProjectInvite,
    addProjectMember,
    addProjectWorkspace,
    assignLegacyMachinesToOwner,
    assignLegacySessionsToDefaultProject,
    countProjectOwners,
    createProject,
    createProjectInvite,
    ensureDefaultProject,
    ensurePersonalProject,
    getProjectByNamespace,
    getProjectMemberRole,
    hasProjectRole,
    listProjectMembers,
    listProjectsForUser,
    listProjectWorkspaces,
    listProjectWorkspacesForUser,
    removeProjectMember,
    removeProjectWorkspace,
    updateProjectName,
    type ProjectRole
} from './projects'

export class ProjectStore implements ProjectStorePort {
    constructor(private readonly db: Database, private readonly onChange?: () => void) {
    }

    ensureDefaults(namespace: string, ownerUserId: number): StoredProject {
        const project = ensureDefaultProject(this.db, namespace, ownerUserId)
        assignLegacySessionsToDefaultProject(this.db, namespace, ownerUserId)
        assignLegacyMachinesToOwner(this.db, namespace, ownerUserId)
        this.onChange?.()
        return project
    }

    ensureDefaultProject(namespace: string, ownerUserId: number): StoredProject {
        const result = ensureDefaultProject(this.db, namespace, ownerUserId)
        this.onChange?.()
        return result
    }

    ensurePersonalProject(namespace: string, ownerUserId: number): StoredProject {
        const result = ensurePersonalProject(this.db, namespace, ownerUserId)
        this.onChange?.()
        return result
    }

    assignLegacySessionsToDefaultProject(namespace: string, ownerUserId: number): string {
        const result = assignLegacySessionsToDefaultProject(this.db, namespace, ownerUserId)
        this.onChange?.()
        return result
    }

    assignLegacyMachinesToOwner(namespace: string, ownerUserId: number): void {
        assignLegacyMachinesToOwner(this.db, namespace, ownerUserId)
        this.onChange?.()
    }

    createProject(
        namespace: string,
        name: string,
        createdByUserId: number,
        options?: { repoUrl?: string | null; teamId?: string | null }
    ): StoredProject {
        const result = createProject(this.db, namespace, name, createdByUserId, options)
        this.onChange?.()
        return result
    }

    createProjectWithWorkspace(
        namespace: string,
        name: string,
        createdByUserId: number,
        workspace: { machineId: string; rootPath: string },
        options?: { repoUrl?: string | null; teamId?: string | null }
    ): StoredProject {
        const result = this.db.transaction(() => {
            const project = createProject(this.db, namespace, name, createdByUserId, options)
            addProjectWorkspace(this.db, project.id, workspace.machineId, workspace.rootPath, createdByUserId)
            return project
        })()
        this.onChange?.()
        return result
    }

    updateProjectName(projectId: string, namespace: string, name: string): StoredProject | null {
        const result = updateProjectName(this.db, projectId, namespace, name)
        if (result) this.onChange?.()
        return result
    }

    getProjectByNamespace(projectId: string, namespace: string): StoredProject | null {
        return getProjectByNamespace(this.db, projectId, namespace)
    }

    listProjectsForUser(namespace: string, userId: number): StoredProject[] {
        return listProjectsForUser(this.db, namespace, userId)
    }

    listProjectMembers(projectId: string): StoredProjectMember[] {
        return listProjectMembers(this.db, projectId)
    }

    addProjectMember(projectId: string, userId: number, role: ProjectRole): StoredProjectMember {
        const result = addProjectMember(this.db, projectId, userId, role)
        this.onChange?.()
        return result
    }

    removeProjectMember(projectId: string, userId: number): boolean {
        const result = removeProjectMember(this.db, projectId, userId)
        if (result) this.onChange?.()
        return result
    }

    countProjectOwners(projectId: string): number {
        return countProjectOwners(this.db, projectId)
    }

    getProjectMemberRole(projectId: string, userId: number): ProjectRole | null {
        return getProjectMemberRole(this.db, projectId, userId)
    }

    hasProjectRole(projectId: string, userId: number, role: ProjectRole): boolean {
        return hasProjectRole(this.getProjectMemberRole(projectId, userId), role)
    }

    listProjectWorkspaces(projectId: string): StoredProjectWorkspace[] {
        return listProjectWorkspaces(this.db, projectId)
    }

    listProjectWorkspacesForUser(
        namespace: string,
        userId: number,
        requiredRole: ProjectRole = 'viewer'
    ): StoredProjectWorkspace[] {
        return listProjectWorkspacesForUser(this.db, namespace, userId, requiredRole)
    }

    addProjectWorkspace(
        projectId: string,
        machineId: string,
        rootPath: string,
        createdByUserId: number
    ): StoredProjectWorkspace {
        const result = addProjectWorkspace(this.db, projectId, machineId, rootPath, createdByUserId)
        this.onChange?.()
        return result
    }

    removeProjectWorkspace(projectId: string, workspaceId: string): boolean {
        const result = removeProjectWorkspace(this.db, projectId, workspaceId)
        if (result) this.onChange?.()
        return result
    }

    createProjectInvite(
        projectId: string,
        role: ProjectRole,
        expiresAt: number,
        createdByUserId: number
    ): { invite: StoredProjectInvite; token: string } {
        const result = createProjectInvite(this.db, projectId, role, expiresAt, createdByUserId)
        this.onChange?.()
        return result
    }

    acceptProjectInvite(
        token: string,
        userId: number,
        namespace: string,
        now?: number
    ): { ok: true; projectId: string; role: ProjectRole } | { ok: false; reason: 'not-found' | 'expired' } {
        const result = acceptProjectInvite(this.db, token, userId, namespace, now)
        if (result.ok) this.onChange?.()
        return result
    }
}

export type { ProjectRole, StoredProject, StoredProjectMember, StoredProjectWorkspace, StoredTeam }
