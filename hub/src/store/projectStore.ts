import type { Database } from 'bun:sqlite'

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

export class ProjectStore {
    constructor(private readonly db: Database) {
    }

    ensureDefaults(namespace: string, ownerUserId: number): StoredProject {
        const project = ensureDefaultProject(this.db, namespace, ownerUserId)
        assignLegacySessionsToDefaultProject(this.db, namespace, ownerUserId)
        assignLegacyMachinesToOwner(this.db, namespace, ownerUserId)
        return project
    }

    ensureDefaultProject(namespace: string, ownerUserId: number): StoredProject {
        return ensureDefaultProject(this.db, namespace, ownerUserId)
    }

    assignLegacySessionsToDefaultProject(namespace: string, ownerUserId: number): string {
        return assignLegacySessionsToDefaultProject(this.db, namespace, ownerUserId)
    }

    assignLegacyMachinesToOwner(namespace: string, ownerUserId: number): void {
        assignLegacyMachinesToOwner(this.db, namespace, ownerUserId)
    }

    createProject(
        namespace: string,
        name: string,
        createdByUserId: number,
        options?: { repoUrl?: string | null; teamId?: string | null }
    ): StoredProject {
        return createProject(this.db, namespace, name, createdByUserId, options)
    }

    createProjectWithWorkspace(
        namespace: string,
        name: string,
        createdByUserId: number,
        workspace: { machineId: string; rootPath: string },
        options?: { repoUrl?: string | null; teamId?: string | null }
    ): StoredProject {
        return this.db.transaction(() => {
            const project = createProject(this.db, namespace, name, createdByUserId, options)
            addProjectWorkspace(this.db, project.id, workspace.machineId, workspace.rootPath, createdByUserId)
            return project
        })()
    }

    updateProjectName(projectId: string, namespace: string, name: string): StoredProject | null {
        return updateProjectName(this.db, projectId, namespace, name)
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
        return addProjectMember(this.db, projectId, userId, role)
    }

    removeProjectMember(projectId: string, userId: number): boolean {
        return removeProjectMember(this.db, projectId, userId)
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
        return addProjectWorkspace(this.db, projectId, machineId, rootPath, createdByUserId)
    }

    removeProjectWorkspace(projectId: string, workspaceId: string): boolean {
        return removeProjectWorkspace(this.db, projectId, workspaceId)
    }

    createProjectInvite(
        projectId: string,
        role: ProjectRole,
        expiresAt: number,
        createdByUserId: number
    ): { invite: StoredProjectInvite; token: string } {
        return createProjectInvite(this.db, projectId, role, expiresAt, createdByUserId)
    }

    acceptProjectInvite(
        token: string,
        userId: number,
        namespace: string,
        now?: number
    ): { ok: true; projectId: string; role: ProjectRole } | { ok: false; reason: 'not-found' | 'expired' } {
        return acceptProjectInvite(this.db, token, userId, namespace, now)
    }
}

export type { ProjectRole, StoredProject, StoredProjectMember, StoredProjectWorkspace, StoredTeam }
