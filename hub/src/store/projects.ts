import type { Database } from 'bun:sqlite'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type {
    StoredProject,
    StoredProjectInvite,
    StoredProjectMember,
    StoredProjectWorkspace,
    StoredTeam,
    StoredTeamMember
} from './types'

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer'

export const PROJECT_ROLES: ProjectRole[] = ['viewer', 'editor', 'admin', 'owner']

const DEFAULT_TEAM_NAME = 'Default'
const DEFAULT_PROJECT_NAME = 'Default Project'
const PERSONAL_TEAM_NAME = 'Personal'
const PERSONAL_PROJECT_NAME = 'Personal Workspace'

type DbTeamRow = {
    id: string
    namespace: string
    name: string
    created_by_user_id: number | null
    created_at: number
}

type DbTeamMemberRow = {
    team_id: string
    user_id: number
    role: string
    created_at: number
}

type DbProjectRow = {
    id: string
    namespace: string
    team_id: string
    name: string
    repo_url: string | null
    created_by_user_id: number | null
    created_at: number
    archived_at: number | null
}

type DbProjectMemberRow = {
    project_id: string
    user_id: number
    role: string
    created_at: number
}

type DbProjectWorkspaceRow = {
    id: string
    project_id: string
    machine_id: string
    root_path: string
    created_by_user_id: number | null
    created_at: number
}

type DbProjectInviteRow = {
    id: string
    project_id: string
    token_hash: string
    role: string
    expires_at: number
    created_by_user_id: number | null
    created_at: number
    accepted_at: number | null
}

function toTeam(row: DbTeamRow): StoredTeam {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at
    }
}

function toTeamMember(row: DbTeamMemberRow): StoredTeamMember {
    return {
        teamId: row.team_id,
        userId: row.user_id,
        role: normalizeRole(row.role),
        createdAt: row.created_at
    }
}

function toProject(row: DbProjectRow): StoredProject {
    return {
        id: row.id,
        namespace: row.namespace,
        teamId: row.team_id,
        name: row.name,
        repoUrl: row.repo_url,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at,
        archivedAt: row.archived_at
    }
}

function toProjectMember(row: DbProjectMemberRow): StoredProjectMember {
    return {
        projectId: row.project_id,
        userId: row.user_id,
        role: normalizeRole(row.role),
        createdAt: row.created_at
    }
}

function toProjectWorkspace(row: DbProjectWorkspaceRow): StoredProjectWorkspace {
    return {
        id: row.id,
        projectId: row.project_id,
        machineId: row.machine_id,
        rootPath: row.root_path,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at
    }
}

function toProjectInvite(row: DbProjectInviteRow): StoredProjectInvite {
    return {
        id: row.id,
        projectId: row.project_id,
        tokenHash: row.token_hash,
        role: normalizeRole(row.role),
        expiresAt: row.expires_at,
        createdByUserId: row.created_by_user_id,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at
    }
}

function normalizeRole(value: string): ProjectRole {
    return PROJECT_ROLES.includes(value as ProjectRole) ? value as ProjectRole : 'viewer'
}

export function roleRank(role: ProjectRole): number {
    return PROJECT_ROLES.indexOf(role)
}

export function hasProjectRole(actual: ProjectRole | null, required: ProjectRole): boolean {
    if (!actual) return false
    return roleRank(actual) >= roleRank(required)
}

export function hashInviteToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

function defaultTeamId(namespace: string): string {
    return `default-team:${namespace}`
}

function defaultProjectId(namespace: string): string {
    return `default-project:${namespace}`
}

function personalTeamId(namespace: string, ownerUserId: number): string {
    return `personal-team:${namespace}:${ownerUserId}`
}

function personalProjectId(namespace: string, ownerUserId: number): string {
    return `personal-project:${namespace}:${ownerUserId}`
}

export function ensureDefaultTeam(db: Database, namespace: string, ownerUserId: number): StoredTeam {
    const id = defaultTeamId(namespace)
    const now = Date.now()
    db.prepare(`
        INSERT INTO teams (id, namespace, name, created_by_user_id, created_at)
        VALUES (@id, @namespace, @name, @created_by_user_id, @created_at)
        ON CONFLICT(id) DO NOTHING
    `).run({
        id,
        namespace,
        name: DEFAULT_TEAM_NAME,
        created_by_user_id: ownerUserId,
        created_at: now
    })
    db.prepare(`
        INSERT INTO team_members (team_id, user_id, role, created_at)
        VALUES (@team_id, @user_id, 'owner', @created_at)
        ON CONFLICT(team_id, user_id) DO UPDATE SET role = CASE
            WHEN excluded.role = 'owner' THEN 'owner'
            ELSE team_members.role
        END
    `).run({ team_id: id, user_id: ownerUserId, created_at: now })

    const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as DbTeamRow | undefined
    if (!row) throw new Error('Failed to ensure default team')
    return toTeam(row)
}

export function ensureDefaultProject(db: Database, namespace: string, ownerUserId: number): StoredProject {
    const team = ensureDefaultTeam(db, namespace, ownerUserId)
    const id = defaultProjectId(namespace)
    const now = Date.now()
    db.prepare(`
        INSERT INTO projects (
            id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at
        ) VALUES (
            @id, @namespace, @team_id, @name, NULL, @created_by_user_id, @created_at, NULL
        )
        ON CONFLICT(id) DO NOTHING
    `).run({
        id,
        namespace,
        team_id: team.id,
        name: DEFAULT_PROJECT_NAME,
        created_by_user_id: ownerUserId,
        created_at: now
    })
    addProjectMember(db, id, ownerUserId, 'owner')

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as DbProjectRow | undefined
    if (!row) throw new Error('Failed to ensure default project')
    return toProject(row)
}

export function ensurePersonalProject(db: Database, namespace: string, ownerUserId: number): StoredProject {
    const teamId = personalTeamId(namespace, ownerUserId)
    const projectId = personalProjectId(namespace, ownerUserId)
    const now = Date.now()

    db.prepare(`
        INSERT INTO teams (id, namespace, name, created_by_user_id, created_at)
        VALUES (@id, @namespace, @name, @created_by_user_id, @created_at)
        ON CONFLICT(id) DO NOTHING
    `).run({
        id: teamId,
        namespace,
        name: PERSONAL_TEAM_NAME,
        created_by_user_id: ownerUserId,
        created_at: now
    })

    db.prepare(`
        INSERT INTO team_members (team_id, user_id, role, created_at)
        VALUES (@team_id, @user_id, 'owner', @created_at)
        ON CONFLICT(team_id, user_id) DO UPDATE SET role = 'owner'
    `).run({ team_id: teamId, user_id: ownerUserId, created_at: now })

    db.prepare(`
        INSERT INTO projects (
            id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at
        ) VALUES (
            @id, @namespace, @team_id, @name, NULL, @created_by_user_id, @created_at, NULL
        )
        ON CONFLICT(id) DO UPDATE SET archived_at = NULL
    `).run({
        id: projectId,
        namespace,
        team_id: teamId,
        name: PERSONAL_PROJECT_NAME,
        created_by_user_id: ownerUserId,
        created_at: now
    })

    addProjectMember(db, projectId, ownerUserId, 'owner')

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as DbProjectRow | undefined
    if (!row) throw new Error('Failed to ensure personal project')
    return toProject(row)
}

export function assignLegacySessionsToDefaultProject(db: Database, namespace: string, ownerUserId: number): string {
    const project = ensureDefaultProject(db, namespace, ownerUserId)
    db.prepare(`
        UPDATE sessions
        SET project_id = @project_id,
            created_by_user_id = COALESCE(created_by_user_id, @created_by_user_id)
        WHERE namespace = @namespace
          AND project_id IS NULL
    `).run({
        project_id: project.id,
        created_by_user_id: ownerUserId,
        namespace
    })
    return project.id
}

export function assignLegacyMachinesToOwner(db: Database, namespace: string, ownerUserId: number): void {
    const team = ensureDefaultTeam(db, namespace, ownerUserId)
    db.prepare(`
        UPDATE machines
        SET owner_user_id = COALESCE(owner_user_id, @owner_user_id),
            team_id = COALESCE(team_id, @team_id)
        WHERE namespace = @namespace
    `).run({
        owner_user_id: ownerUserId,
        team_id: team.id,
        namespace
    })
}

export function createProject(
    db: Database,
    namespace: string,
    name: string,
    createdByUserId: number,
    options?: { repoUrl?: string | null; teamId?: string | null }
): StoredProject {
    const team = options?.teamId
        ? getTeam(db, options.teamId)
        : ensureDefaultTeam(db, namespace, createdByUserId)
    if (!team || team.namespace !== namespace) {
        throw new Error('Team not found')
    }
    const now = Date.now()
    const id = randomUUID()
    db.prepare(`
        INSERT INTO projects (
            id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at
        ) VALUES (
            @id, @namespace, @team_id, @name, @repo_url, @created_by_user_id, @created_at, NULL
        )
    `).run({
        id,
        namespace,
        team_id: team.id,
        name,
        repo_url: options?.repoUrl ?? null,
        created_by_user_id: createdByUserId,
        created_at: now
    })
    addProjectMember(db, id, createdByUserId, 'owner')
    const project = getProject(db, id)
    if (!project) throw new Error('Failed to create project')
    return project
}

export function updateProjectName(
    db: Database,
    projectId: string,
    namespace: string,
    name: string
): StoredProject | null {
    db.prepare(`
        UPDATE projects
        SET name = @name
        WHERE id = @id
          AND namespace = @namespace
          AND archived_at IS NULL
    `).run({ id: projectId, namespace, name })
    return getProjectByNamespace(db, projectId, namespace)
}

export function getTeam(db: Database, teamId: string): StoredTeam | null {
    const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as DbTeamRow | undefined
    return row ? toTeam(row) : null
}

export function getProject(db: Database, projectId: string): StoredProject | null {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as DbProjectRow | undefined
    return row ? toProject(row) : null
}

export function getProjectByNamespace(
    db: Database,
    projectId: string,
    namespace: string
): StoredProject | null {
    const row = db.prepare(
        'SELECT * FROM projects WHERE id = ? AND namespace = ?'
    ).get(projectId, namespace) as DbProjectRow | undefined
    return row ? toProject(row) : null
}

export function listProjectsForUser(
    db: Database,
    namespace: string,
    userId: number
): StoredProject[] {
    const rows = db.prepare(`
        SELECT p.*
        FROM projects p
        INNER JOIN project_members pm ON pm.project_id = p.id
        WHERE p.namespace = ?
          AND pm.user_id = ?
          AND p.archived_at IS NULL
        ORDER BY p.created_at ASC
    `).all(namespace, userId) as DbProjectRow[]
    return rows.map(toProject)
}

export function listProjectMembers(db: Database, projectId: string): StoredProjectMember[] {
    const rows = db.prepare(
        'SELECT * FROM project_members WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as DbProjectMemberRow[]
    return rows.map(toProjectMember)
}

export function addProjectMember(
    db: Database,
    projectId: string,
    userId: number,
    role: ProjectRole
): StoredProjectMember {
    const now = Date.now()
    db.prepare(`
        INSERT INTO project_members (project_id, user_id, role, created_at)
        VALUES (@project_id, @user_id, @role, @created_at)
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role
    `).run({
        project_id: projectId,
        user_id: userId,
        role,
        created_at: now
    })
    const row = db.prepare(
        'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(projectId, userId) as DbProjectMemberRow | undefined
    if (!row) throw new Error('Failed to add project member')
    return toProjectMember(row)
}

export function removeProjectMember(db: Database, projectId: string, userId: number): boolean {
    const result = db.prepare(
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
    ).run(projectId, userId)
    return result.changes > 0
}

export function countProjectOwners(db: Database, projectId: string): number {
    const row = db.prepare(
        "SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'"
    ).get(projectId) as { count: number } | undefined
    return row?.count ?? 0
}

export function getProjectMemberRole(
    db: Database,
    projectId: string,
    userId: number
): ProjectRole | null {
    const row = db.prepare(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(projectId, userId) as { role: string } | undefined
    return row ? normalizeRole(row.role) : null
}

export function listProjectWorkspaces(db: Database, projectId: string): StoredProjectWorkspace[] {
    const rows = db.prepare(
        'SELECT * FROM project_workspaces WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as DbProjectWorkspaceRow[]
    return rows.map(toProjectWorkspace)
}

export function listProjectWorkspacesForUser(
    db: Database,
    namespace: string,
    userId: number,
    requiredRole: ProjectRole = 'viewer'
): StoredProjectWorkspace[] {
    const rows = db.prepare(`
        SELECT pw.*, pm.role AS member_role
        FROM project_workspaces pw
        INNER JOIN projects p ON p.id = pw.project_id
        INNER JOIN project_members pm ON pm.project_id = p.id
        WHERE p.namespace = ?
          AND p.archived_at IS NULL
          AND pm.user_id = ?
    `).all(namespace, userId) as Array<DbProjectWorkspaceRow & { member_role: string }>
    return rows
        .filter((row) => hasProjectRole(normalizeRole(row.member_role), requiredRole))
        .map(toProjectWorkspace)
}

export function addProjectWorkspace(
    db: Database,
    projectId: string,
    machineId: string,
    rootPath: string,
    createdByUserId: number
): StoredProjectWorkspace {
    const existing = db.prepare(`
        SELECT * FROM project_workspaces
        WHERE project_id = ? AND machine_id = ? AND root_path = ?
        LIMIT 1
    `).get(projectId, machineId, rootPath) as DbProjectWorkspaceRow | undefined
    if (existing) {
        return toProjectWorkspace(existing)
    }

    const now = Date.now()
    const id = randomUUID()
    db.prepare(`
        INSERT INTO project_workspaces (
            id, project_id, machine_id, root_path, created_by_user_id, created_at
        ) VALUES (
            @id, @project_id, @machine_id, @root_path, @created_by_user_id, @created_at
        )
    `).run({
        id,
        project_id: projectId,
        machine_id: machineId,
        root_path: rootPath,
        created_by_user_id: createdByUserId,
        created_at: now
    })
    const row = db.prepare('SELECT * FROM project_workspaces WHERE id = ?').get(id) as DbProjectWorkspaceRow | undefined
    if (!row) throw new Error('Failed to add project workspace')
    return toProjectWorkspace(row)
}

export function removeProjectWorkspace(db: Database, projectId: string, workspaceId: string): boolean {
    const result = db.prepare(
        'DELETE FROM project_workspaces WHERE project_id = ? AND id = ?'
    ).run(projectId, workspaceId)
    return result.changes > 0
}

export function createProjectInvite(
    db: Database,
    projectId: string,
    role: ProjectRole,
    expiresAt: number,
    createdByUserId: number
): { invite: StoredProjectInvite; token: string } {
    const now = Date.now()
    const id = randomUUID()
    const token = randomBytes(24).toString('base64url')
    const tokenHash = hashInviteToken(token)
    db.prepare(`
        INSERT INTO project_invites (
            id, project_id, token_hash, role, expires_at, created_by_user_id, created_at, accepted_at
        ) VALUES (
            @id, @project_id, @token_hash, @role, @expires_at, @created_by_user_id, @created_at, NULL
        )
    `).run({
        id,
        project_id: projectId,
        token_hash: tokenHash,
        role,
        expires_at: expiresAt,
        created_by_user_id: createdByUserId,
        created_at: now
    })
    const row = db.prepare('SELECT * FROM project_invites WHERE id = ?').get(id) as DbProjectInviteRow | undefined
    if (!row) throw new Error('Failed to create project invite')
    return { invite: toProjectInvite(row), token }
}

export function acceptProjectInvite(
    db: Database,
    token: string,
    userId: number,
    namespace: string,
    now: number = Date.now()
): { ok: true; projectId: string; role: ProjectRole } | { ok: false; reason: 'not-found' | 'expired' } {
    const tokenHash = hashInviteToken(token)
    return db.transaction(() => {
        const row = db.prepare(`
            SELECT pi.*
            FROM project_invites pi
            INNER JOIN projects p ON p.id = pi.project_id
            WHERE pi.token_hash = ?
              AND p.namespace = ?
              AND p.archived_at IS NULL
            LIMIT 1
        `).get(tokenHash, namespace) as DbProjectInviteRow | undefined
        if (!row) return { ok: false as const, reason: 'not-found' as const }
        if (row.expires_at < now) return { ok: false as const, reason: 'expired' as const }
        const inviteRole = normalizeRole(row.role)
        const currentRole = getProjectMemberRole(db, row.project_id, userId)
        const role = currentRole && roleRank(currentRole) >= roleRank(inviteRole)
            ? currentRole
            : inviteRole
        if (currentRole !== role) {
            addProjectMember(db, row.project_id, userId, role)
        }
        db.prepare(
            'UPDATE project_invites SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?'
        ).run(now, row.id)
        return { ok: true as const, projectId: row.project_id, role }
    })()
}
