import type { StorageConfig } from '@hapi/protocol/storage'
import type { ProjectStorePort } from '../ports/coreStores'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createMysqlClient } from '../external/storageSync'
import type { StoredProject, StoredProjectInvite, StoredProjectMember, StoredProjectWorkspace, StoredTeam, StoredTeamMember } from '../types'
import { hasProjectRole, roleRank, type ProjectRole } from '../projects'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']
type Num = number | string | null

type TeamRow = { id: string; namespace: string; name: string; created_by_user_id: Num; created_at: Num }
type TeamMemberRow = { team_id: string; user_id: Num; role: string; created_at: Num }
type ProjectRow = { id: string; namespace: string; team_id: string; name: string; repo_url: string | null; created_by_user_id: Num; created_at: Num; archived_at: Num }
type ProjectMemberRow = { project_id: string; user_id: Num; role: string; created_at: Num }
type ProjectWorkspaceRow = { id: string; project_id: string; machine_id: string; root_path: string; created_by_user_id: Num; created_at: Num }
type ProjectInviteRow = { id: string; project_id: string; token_hash: string; role: string; expires_at: Num; created_by_user_id: Num; created_at: Num; accepted_at: Num }

const DEFAULT_TEAM_NAME = 'Default'
const DEFAULT_PROJECT_NAME = 'Default Project'
const PERSONAL_TEAM_NAME = 'Personal'
const PERSONAL_PROJECT_NAME = 'Personal Workspace'
const PROJECT_ROLES: ProjectRole[] = ['viewer', 'editor', 'admin', 'owner']
const num = (v: Num | undefined): number | null => v == null ? null : Number(v)
const role = (v: string): ProjectRole => PROJECT_ROLES.includes(v as ProjectRole) ? v as ProjectRole : 'viewer'
const defaultTeamId = (namespace: string): string => `default-team:${namespace}`
const defaultProjectId = (namespace: string): string => `default-project:${namespace}`
const personalTeamId = (namespace: string, ownerUserId: number): string => `personal-team:${namespace}:${ownerUserId}`
const personalProjectId = (namespace: string, ownerUserId: number): string => `personal-project:${namespace}:${ownerUserId}`
const hashInviteToken = (token: string): string => createHash('sha256').update(token).digest('hex')

function toTeam(row: TeamRow): StoredTeam { return { id: row.id, namespace: row.namespace, name: row.name, createdByUserId: num(row.created_by_user_id), createdAt: num(row.created_at) ?? 0 } }
function toTeamMember(row: TeamMemberRow): StoredTeamMember { return { teamId: row.team_id, userId: num(row.user_id) ?? 0, role: role(row.role), createdAt: num(row.created_at) ?? 0 } }
function toProject(row: ProjectRow): StoredProject { return { id: row.id, namespace: row.namespace, teamId: row.team_id, name: row.name, repoUrl: row.repo_url, createdByUserId: num(row.created_by_user_id), createdAt: num(row.created_at) ?? 0, archivedAt: num(row.archived_at) } }
function toProjectMember(row: ProjectMemberRow): StoredProjectMember { return { projectId: row.project_id, userId: num(row.user_id) ?? 0, role: role(row.role), createdAt: num(row.created_at) ?? 0 } }
function toProjectWorkspace(row: ProjectWorkspaceRow): StoredProjectWorkspace { return { id: row.id, projectId: row.project_id, machineId: row.machine_id, rootPath: row.root_path, createdByUserId: num(row.created_by_user_id), createdAt: num(row.created_at) ?? 0 } }
function toProjectInvite(row: ProjectInviteRow): StoredProjectInvite { return { id: row.id, projectId: row.project_id, tokenHash: row.token_hash, role: role(row.role), expiresAt: num(row.expires_at) ?? 0, createdByUserId: num(row.created_by_user_id), createdAt: num(row.created_at) ?? 0, acceptedAt: num(row.accepted_at) } }

export class MysqlProjectStore implements ProjectStorePort {
    constructor(private readonly target: MysqlTarget, private readonly onChange?: () => void) {}
    private async withSql<T>(fn: (sql: Bun.SQL) => Promise<T>): Promise<T> { const sql = createMysqlClient(this.target); try { await sql.connect(); return await fn(sql) } finally { await sql.close({ timeout: 1 }).catch(() => undefined) } }
    private async getTeam(sql: Bun.SQL, id: string): Promise<StoredTeam | null> { const rows = await sql.unsafe<TeamRow[]>('SELECT * FROM teams WHERE id = ? LIMIT 1', [id]); return rows[0] ? toTeam(rows[0]) : null }
    private async getProject(sql: Bun.SQL, id: string): Promise<StoredProject | null> { const rows = await sql.unsafe<ProjectRow[]>('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]); return rows[0] ? toProject(rows[0]) : null }

    private async ensureDefaultTeam(sql: Bun.SQL, namespace: string, ownerUserId: number): Promise<StoredTeam> {
        const id = defaultTeamId(namespace); const now = Date.now()
        await sql.unsafe('INSERT IGNORE INTO teams (id, namespace, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)', [id, namespace, DEFAULT_TEAM_NAME, ownerUserId, now])
        await sql.unsafe(`INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?) ON DUPLICATE KEY UPDATE role = IF(VALUES(role) = 'owner', 'owner', role)`, [id, ownerUserId, now])
        const team = await this.getTeam(sql, id); if (!team) throw new Error('Failed to ensure default team'); return team
    }

    async ensureDefaults(namespace: string, ownerUserId: number): Promise<StoredProject> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const project = await this.ensureDefaultProjectIn(tx, namespace, ownerUserId)
            await tx.unsafe('UPDATE sessions SET project_id = ?, created_by_user_id = COALESCE(created_by_user_id, ?) WHERE namespace = ? AND project_id IS NULL', [project.id, ownerUserId, namespace])
            const team = await this.ensureDefaultTeam(tx, namespace, ownerUserId)
            await tx.unsafe('UPDATE machines SET owner_user_id = COALESCE(owner_user_id, ?), team_id = COALESCE(team_id, ?) WHERE namespace = ?', [ownerUserId, team.id, namespace])
            this.onChange?.(); return project
        }))
    }

    private async ensureDefaultProjectIn(sql: Bun.SQL, namespace: string, ownerUserId: number): Promise<StoredProject> {
        const team = await this.ensureDefaultTeam(sql, namespace, ownerUserId); const id = defaultProjectId(namespace); const now = Date.now()
        await sql.unsafe('INSERT IGNORE INTO projects (id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)', [id, namespace, team.id, DEFAULT_PROJECT_NAME, ownerUserId, now])
        await this.addProjectMemberIn(sql, id, ownerUserId, 'owner')
        const project = await this.getProject(sql, id); if (!project) throw new Error('Failed to ensure default project'); return project
    }

    async ensureDefaultProject(namespace: string, ownerUserId: number): Promise<StoredProject> { return await this.withSql(async (sql) => { const r = await this.ensureDefaultProjectIn(sql, namespace, ownerUserId); this.onChange?.(); return r }) }

    async ensurePersonalProject(namespace: string, ownerUserId: number): Promise<StoredProject> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const teamId = personalTeamId(namespace, ownerUserId); const projectId = personalProjectId(namespace, ownerUserId); const now = Date.now()
            await tx.unsafe('INSERT IGNORE INTO teams (id, namespace, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)', [teamId, namespace, PERSONAL_TEAM_NAME, ownerUserId, now])
            await tx.unsafe(`INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?) ON DUPLICATE KEY UPDATE role = 'owner'`, [teamId, ownerUserId, now])
            await tx.unsafe('INSERT INTO projects (id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL) ON DUPLICATE KEY UPDATE archived_at = NULL', [projectId, namespace, teamId, PERSONAL_PROJECT_NAME, ownerUserId, now])
            await this.addProjectMemberIn(tx, projectId, ownerUserId, 'owner')
            const project = await this.getProject(tx, projectId); if (!project) throw new Error('Failed to ensure personal project'); this.onChange?.(); return project
        }))
    }

    async assignLegacySessionsToDefaultProject(namespace: string, ownerUserId: number): Promise<string> { return await this.withSql(async (sql) => { const p = await this.ensureDefaultProjectIn(sql, namespace, ownerUserId); await sql.unsafe('UPDATE sessions SET project_id = ?, created_by_user_id = COALESCE(created_by_user_id, ?) WHERE namespace = ? AND project_id IS NULL', [p.id, ownerUserId, namespace]); this.onChange?.(); return p.id }) }
    async assignLegacyMachinesToOwner(namespace: string, ownerUserId: number): Promise<void> { await this.withSql(async (sql) => { const t = await this.ensureDefaultTeam(sql, namespace, ownerUserId); await sql.unsafe('UPDATE machines SET owner_user_id = COALESCE(owner_user_id, ?), team_id = COALESCE(team_id, ?) WHERE namespace = ?', [ownerUserId, t.id, namespace]); this.onChange?.() }) }

    async createProject(namespace: string, name: string, createdByUserId: number, options?: { repoUrl?: string | null; teamId?: string | null }): Promise<StoredProject> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const team = options?.teamId ? await this.getTeam(tx, options.teamId) : await this.ensureDefaultTeam(tx, namespace, createdByUserId)
            if (!team || team.namespace !== namespace) throw new Error('Team not found')
            const id = randomUUID(); const now = Date.now()
            await tx.unsafe('INSERT INTO projects (id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', [id, namespace, team.id, name, options?.repoUrl ?? null, createdByUserId, now])
            await this.addProjectMemberIn(tx, id, createdByUserId, 'owner')
            const project = await this.getProject(tx, id); if (!project) throw new Error('Failed to create project'); this.onChange?.(); return project
        }))
    }

    async createProjectWithWorkspace(namespace: string, name: string, createdByUserId: number, workspace: { machineId: string; rootPath: string }, options?: { repoUrl?: string | null; teamId?: string | null }): Promise<StoredProject> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const team = options?.teamId ? await this.getTeam(tx, options.teamId) : await this.ensureDefaultTeam(tx, namespace, createdByUserId)
            if (!team || team.namespace !== namespace) throw new Error('Team not found')
            const id = randomUUID(); const now = Date.now()
            await tx.unsafe('INSERT INTO projects (id, namespace, team_id, name, repo_url, created_by_user_id, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', [id, namespace, team.id, name, options?.repoUrl ?? null, createdByUserId, now])
            await this.addProjectMemberIn(tx, id, createdByUserId, 'owner')
            await this.addProjectWorkspaceIn(tx, id, workspace.machineId, workspace.rootPath, createdByUserId)
            const project = await this.getProject(tx, id); if (!project) throw new Error('Failed to create project'); this.onChange?.(); return project
        }))
    }

    async updateProjectName(projectId: string, namespace: string, name: string): Promise<StoredProject | null> { return await this.withSql(async (sql) => { await sql.unsafe('UPDATE projects SET name = ? WHERE id = ? AND namespace = ? AND archived_at IS NULL', [name, projectId, namespace]); const p = await this.getProjectByNamespaceIn(sql, projectId, namespace); if (p) this.onChange?.(); return p }) }
    private async getProjectByNamespaceIn(sql: Bun.SQL, projectId: string, namespace: string): Promise<StoredProject | null> { const rows = await sql.unsafe<ProjectRow[]>('SELECT * FROM projects WHERE id = ? AND namespace = ? LIMIT 1', [projectId, namespace]); return rows[0] ? toProject(rows[0]) : null }
    async getProjectByNamespace(projectId: string, namespace: string): Promise<StoredProject | null> { return await this.withSql((sql) => this.getProjectByNamespaceIn(sql, projectId, namespace)) }
    async listProjectsForUser(namespace: string, userId: number): Promise<StoredProject[]> { return await this.withSql(async (sql) => (await sql.unsafe<ProjectRow[]>('SELECT p.* FROM projects p INNER JOIN project_members pm ON pm.project_id = p.id WHERE p.namespace = ? AND pm.user_id = ? AND p.archived_at IS NULL ORDER BY p.created_at ASC', [namespace, userId])).map(toProject)) }
    async listProjectMembers(projectId: string): Promise<StoredProjectMember[]> { return await this.withSql(async (sql) => (await sql.unsafe<ProjectMemberRow[]>('SELECT * FROM project_members WHERE project_id = ? ORDER BY created_at ASC', [projectId])).map(toProjectMember)) }

    private async addProjectMemberIn(sql: Bun.SQL, projectId: string, userId: number, memberRole: ProjectRole): Promise<StoredProjectMember> {
        const now = Date.now(); await sql.unsafe('INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [projectId, userId, memberRole, now])
        const rows = await sql.unsafe<ProjectMemberRow[]>('SELECT * FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, userId]); if (!rows[0]) throw new Error('Failed to add project member'); return toProjectMember(rows[0])
    }
    async addProjectMember(projectId: string, userId: number, memberRole: ProjectRole): Promise<StoredProjectMember> { return await this.withSql(async (sql) => { const r = await this.addProjectMemberIn(sql, projectId, userId, memberRole); this.onChange?.(); return r }) }
    async removeProjectMember(projectId: string, userId: number): Promise<boolean> { return await this.withSql(async (sql) => { const existing = await sql.unsafe<ProjectMemberRow[]>('SELECT * FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, userId]); if (!existing[0]) return false; await sql.unsafe('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]); this.onChange?.(); return true }) }
    async countProjectOwners(projectId: string): Promise<number> { return await this.withSql(async (sql) => { const rows = await sql.unsafe<Array<{ count: Num }>>("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'", [projectId]); return num(rows[0]?.count) ?? 0 }) }
    async getProjectMemberRole(projectId: string, userId: number): Promise<ProjectRole | null> { return await this.withSql(async (sql) => { const rows = await sql.unsafe<Array<{ role: string }>>('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, userId]); return rows[0] ? role(rows[0].role) : null }) }
    async hasProjectRole(projectId: string, userId: number, required: ProjectRole): Promise<boolean> { return hasProjectRole(await this.getProjectMemberRole(projectId, userId), required) }
    async listProjectWorkspaces(projectId: string): Promise<StoredProjectWorkspace[]> { return await this.withSql(async (sql) => (await sql.unsafe<ProjectWorkspaceRow[]>('SELECT * FROM project_workspaces WHERE project_id = ? ORDER BY created_at ASC', [projectId])).map(toProjectWorkspace)) }
    async listProjectWorkspacesForUser(namespace: string, userId: number, requiredRole: ProjectRole = 'viewer'): Promise<StoredProjectWorkspace[]> {
        return await this.withSql(async (sql) => (await sql.unsafe<Array<ProjectWorkspaceRow & { member_role: string }>>('SELECT pw.*, pm.role AS member_role FROM project_workspaces pw INNER JOIN projects p ON p.id = pw.project_id INNER JOIN project_members pm ON pm.project_id = p.id WHERE p.namespace = ? AND p.archived_at IS NULL AND pm.user_id = ?', [namespace, userId])).filter((row) => hasProjectRole(role(row.member_role), requiredRole)).map(toProjectWorkspace))
    }

    private async addProjectWorkspaceIn(sql: Bun.SQL, projectId: string, machineId: string, rootPath: string, createdByUserId: number): Promise<StoredProjectWorkspace> {
        const existing = await sql.unsafe<ProjectWorkspaceRow[]>('SELECT * FROM project_workspaces WHERE project_id = ? AND machine_id = ? AND root_path = ? LIMIT 1', [projectId, machineId, rootPath]); if (existing[0]) return toProjectWorkspace(existing[0])
        const id = randomUUID(); const now = Date.now(); await sql.unsafe('INSERT INTO project_workspaces (id, project_id, machine_id, root_path, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, projectId, machineId, rootPath, createdByUserId, now])
        const rows = await sql.unsafe<ProjectWorkspaceRow[]>('SELECT * FROM project_workspaces WHERE id = ? LIMIT 1', [id]); if (!rows[0]) throw new Error('Failed to add project workspace'); return toProjectWorkspace(rows[0])
    }
    async addProjectWorkspace(projectId: string, machineId: string, rootPath: string, createdByUserId: number): Promise<StoredProjectWorkspace> { return await this.withSql(async (sql) => { const r = await this.addProjectWorkspaceIn(sql, projectId, machineId, rootPath, createdByUserId); this.onChange?.(); return r }) }
    async removeProjectWorkspace(projectId: string, workspaceId: string): Promise<boolean> { return await this.withSql(async (sql) => { const existing = await sql.unsafe<ProjectWorkspaceRow[]>('SELECT * FROM project_workspaces WHERE project_id = ? AND id = ? LIMIT 1', [projectId, workspaceId]); if (!existing[0]) return false; await sql.unsafe('DELETE FROM project_workspaces WHERE project_id = ? AND id = ?', [projectId, workspaceId]); this.onChange?.(); return true }) }

    async createProjectInvite(projectId: string, inviteRole: ProjectRole, expiresAt: number, createdByUserId: number): Promise<{ invite: StoredProjectInvite; token: string }> {
        return await this.withSql(async (sql) => { const id = randomUUID(); const token = randomBytes(24).toString('base64url'); const tokenHash = hashInviteToken(token); const now = Date.now(); await sql.unsafe('INSERT INTO project_invites (id, project_id, token_hash, role, expires_at, created_by_user_id, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', [id, projectId, tokenHash, inviteRole, expiresAt, createdByUserId, now]); const rows = await sql.unsafe<ProjectInviteRow[]>('SELECT * FROM project_invites WHERE id = ? LIMIT 1', [id]); if (!rows[0]) throw new Error('Failed to create project invite'); this.onChange?.(); return { invite: toProjectInvite(rows[0]), token } })
    }
    async acceptProjectInvite(token: string, userId: number, namespace: string, now: number = Date.now()): Promise<{ ok: true; projectId: string; role: ProjectRole } | { ok: false; reason: 'not-found' | 'expired' }> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const tokenHash = hashInviteToken(token)
            const rows = await tx.unsafe<ProjectInviteRow[]>('SELECT pi.* FROM project_invites pi INNER JOIN projects p ON p.id = pi.project_id WHERE pi.token_hash = ? AND p.namespace = ? AND p.archived_at IS NULL LIMIT 1', [tokenHash, namespace])
            const row = rows[0]; if (!row) return { ok: false as const, reason: 'not-found' as const }; if ((num(row.expires_at) ?? 0) < now) return { ok: false as const, reason: 'expired' as const }
            const inviteRole = role(row.role); const current = await tx.unsafe<Array<{ role: string }>>('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [row.project_id, userId]); const currentRole = current[0] ? role(current[0].role) : null
            const finalRole = currentRole && roleRank(currentRole) >= roleRank(inviteRole) ? currentRole : inviteRole
            if (currentRole !== finalRole) await this.addProjectMemberIn(tx, row.project_id, userId, finalRole)
            await tx.unsafe('UPDATE project_invites SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?', [now, row.id])
            this.onChange?.(); return { ok: true as const, projectId: row.project_id, role: finalRole }
        }))
    }
}

export type { ProjectRole, StoredProject, StoredProjectMember, StoredProjectWorkspace, StoredTeam, StoredTeamMember }
