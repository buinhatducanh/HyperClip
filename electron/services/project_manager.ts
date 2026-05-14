/**
 * Project Manager — HyperClip (2026-05-14)
 *
 * Manages up to 200 GCP projects organized in projects/{id}/ folder structure.
 * Each project = 1 folder containing config.json, token.json, stats.json.
 *
 * Responsibilities:
 * 1. Load all project configs from projects/ directory
 * 2. Auto-assign channels to projects (round-robin, 2 projects/channel)
 * 3. Track quota stats per project (stats.json)
 * 4. Auto-disable exhausted projects
 * 5. Smart rotation: getLeastUsedProject() for detection
 * 6. Midnight UTC reset: re-enable all projects
 *
 * Storage layout:
 *   HyperClip-Data/
 *     projects/
 *       proj-001/config.json   ← credentials
 *       proj-001/token.json   ← OAuth token
 *       proj-001/stats.json   ← quota stats
 *       proj-002/
 *       ...
 */

import fs from 'fs'
import path from 'path'
import { devLog } from './dev_log.js'
import {
  getProjectsDir,
  getProjectDir,
  getProjectConfigPath,
  getProjectTokenPath,
  getProjectStatsPath,
  getChannelsDir,
  getChannelListPath,
} from './paths.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GCPProjectConfig {
  projectId: string
  projectName: string
  gmailAccount: string
  clientId: string
  clientSecret: string
  apiKey: string
  status: 'active' | 'exhausted' | 'unauthorized' | 'pending_auth'
  assignedChannels: string[]
  createdAt: string
  lastUsedAt: string | null
  totalQuotasUsed: number
}

export interface GCPProjectToken {
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
}

export interface GCPProjectStats {
  usedToday: number
  errors: number
  lastUsed: number
  lastResetAt: string
  unauthorized: boolean
}

export interface GCPProject extends GCPProjectConfig {
  token?: GCPProjectToken
  stats: GCPProjectStats
}

export interface ChannelAssignment {
  channelId: string
  primaryProjectId: string
  backupProjectId: string
}

export interface ProjectManagerStatus {
  total: number
  active: number
  exhausted: number
  pendingAuth: number
  unauthorized: number
  totalQuotaRemaining: number
  totalQuotaUsedToday: number
  assignments: ChannelAssignment[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_UNITS_PER_PROJECT = 9500
const EXHAUSTION_ERROR_THRESHOLD = 5
const QUOTA_WARNING_PCT = 80
const MIDNIGHT_RESET_HOUR_UTC = 0

// ─── Project Manager ───────────────────────────────────────────────────────────

class ProjectManager {
  private _projects: Map<string, GCPProject> = new Map()
  private _assignments: ChannelAssignment[] = []
  private _lastResetUTCDate: string = ''
  private _initialized: boolean = false

  constructor() {
    this._ensureDirs()
  }

  // ── Initialization ───────────────────────────────────────────────────────────

  /** Ensure required directories exist */
  private _ensureDirs(): void {
    const dirs = [
      getProjectsDir(),
      getChannelsDir(),
    ]
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }

  /** Initialize: load all projects and channel assignments */
  init(): void {
    if (this._initialized) return

    // Load all projects from projects/ folder
    this._loadAllProjects()

    // Load channel assignments
    this._loadAssignments()

    // Check midnight reset
    this._checkReset()

    this._initialized = true
    devLog(`[ProjectManager] Initialized: ${this._projects.size} projects loaded`)
    this._logSummary()
  }

  /** Load all project configs from projects/{id}/config.json */
  private _loadAllProjects(): void {
    const projectsDir = getProjectsDir()

    if (!fs.existsSync(projectsDir)) {
      fs.mkdirSync(projectsDir, { recursive: true })
      devLog('[ProjectManager] Created projects/ directory')
      return
    }

    const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const projectId = entry.name
      const configPath = getProjectConfigPath(projectId)

      if (!fs.existsSync(configPath)) continue

      try {
        const config: GCPProjectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        const stats = this._loadProjectStats(projectId)
        const token = this._loadProjectToken(projectId)

        const project: GCPProject = {
          ...config,
          token,
          stats,
        }

        this._projects.set(projectId, project)
      } catch (e) {
        console.warn(`[ProjectManager] Failed to load project ${projectId}:`, e)
      }
    }
  }

  private _loadProjectStats(projectId: string): GCPProjectStats {
    const statsPath = getProjectStatsPath(projectId)
    if (fs.existsSync(statsPath)) {
      try {
        return JSON.parse(fs.readFileSync(statsPath, 'utf-8'))
      } catch {}
    }
    return this._defaultStats()
  }

  private _loadProjectToken(projectId: string): GCPProjectToken | undefined {
    const tokenPath = getProjectTokenPath(projectId)
    if (fs.existsSync(tokenPath)) {
      try {
        const token: GCPProjectToken = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'))
        // Empty token = not authorized
        if (!token.access_token) return undefined
        return token
      } catch {}
    }
    return undefined
  }

  private _defaultStats(): GCPProjectStats {
    return {
      usedToday: 0,
      errors: 0,
      lastUsed: 0,
      lastResetAt: this._todayUTCDate(),
      unauthorized: false,
    }
  }

  // ── Channel Assignments ───────────────────────────────────────────────────────

  /** Load channel assignments from channels/ directory */
  private _loadAssignments(): void {
    const assignmentsFile = path.join(getChannelsDir(), 'assignments.json')
    if (fs.existsSync(assignmentsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(assignmentsFile, 'utf-8'))
        this._assignments = data.assignments || []
      } catch {
        this._assignments = []
      }
    } else {
      this._assignments = []
    }
  }

  /** Persist channel assignments */
  private _saveAssignments(): void {
    const assignmentsFile = path.join(getChannelsDir(), 'assignments.json')
    fs.writeFileSync(assignmentsFile, JSON.stringify({ assignments: this._assignments }, null, 2), 'utf-8')
  }

  /**
   * Auto-assign channels to projects (round-robin).
   * Call after channel add/remove or project add/remove.
   *
   * Strategy:
   * - Each channel gets 2 projects (primary + backup)
   * - Projects assigned round-robin: proj-000, proj-200, proj-001, proj-201, ...
   * - So primary projects are evenly distributed, backup is always +200
   */
  autoAssignChannels(channelIds: string[]): void {
    const activeProjects = this.getActiveProjects()
    if (activeProjects.length === 0) {
      devLog('[ProjectManager] No active projects — cannot assign channels')
      return
    }

    const newAssignments: ChannelAssignment[] = []
    const projectCount = activeProjects.length

    for (let i = 0; i < channelIds.length; i++) {
      const channelId = channelIds[i]
      const primaryIdx = i % projectCount
      const backupIdx = (i + projectCount) % projectCount

      // If we have fewer than 2 projects, reuse the same project
      const primaryProject = activeProjects[primaryIdx]
      const backupProject = activeProjects[backupIdx] || activeProjects[primaryIdx]

      newAssignments.push({
        channelId,
        primaryProjectId: primaryProject.projectId,
        backupProjectId: backupProject.projectId,
      })
    }

    this._assignments = newAssignments
    this._saveAssignments()

    // Also update assignedChannels in each project config
    for (const project of this._projects.values()) {
      const assigned = newAssignments
        .filter(a => a.primaryProjectId === project.projectId || a.backupProjectId === project.projectId)
        .map(a => a.channelId)
      project.assignedChannels = [...new Set(assigned)]
      this._saveProjectConfig(project)
    }

    devLog(`[ProjectManager] Assigned ${channelIds.length} channels to ${projectCount} projects`)
  }

  /** Get assignments for a specific channel */
  getAssignmentForChannel(channelId: string): ChannelAssignment | null {
    return this._assignments.find(a => a.channelId === channelId) || null
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  /** Add a new project from config (used by bulk import + Settings UI) */
  addProject(config: Omit<GCPProjectConfig, 'assignedChannels' | 'lastUsedAt' | 'totalQuotasUsed'>): GCPProject {
    const { projectId } = config
    const projectDir = getProjectDir(projectId)

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }

    const project: GCPProject = {
      ...config,
      assignedChannels: [],
      lastUsedAt: null,
      totalQuotasUsed: 0,
      stats: this._defaultStats(),
    }

    this._projects.set(projectId, project)
    this._saveProjectConfig(project)
    this._saveProjectStats(project)

    devLog(`[ProjectManager] Added project: ${projectId} (${config.projectName})`)
    return project
  }

  /** Update project config */
  updateProject(projectId: string, patch: Partial<GCPProjectConfig>): GCPProject | null {
    const project = this._projects.get(projectId)
    if (!project) return null

    Object.assign(project, patch)
    this._saveProjectConfig(project)
    return project
  }

  /** Remove a project */
  removeProject(projectId: string): boolean {
    const project = this._projects.get(projectId)
    if (!project) return false

    // Delete project directory
    const projectDir = getProjectDir(projectId)
    try {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true })
      }
    } catch (e) {
      console.warn(`[ProjectManager] Failed to remove project dir ${projectDir}:`, e)
    }

    // Remove from memory
    this._projects.delete(projectId)

    // Remove assignments
    const removedAssignments = this._assignments.filter(
      a => a.primaryProjectId === projectId || a.backupProjectId === projectId
    )
    if (removedAssignments.length > 0) {
      this._assignments = this._assignments.filter(
        a => a.primaryProjectId !== projectId && a.backupProjectId !== projectId
      )
      this._saveAssignments()
    }

    devLog(`[ProjectManager] Removed project: ${projectId}`)
    return true
  }

  // ── Token Management ─────────────────────────────────────────────────────────

  /** Save OAuth token for a project */
  saveToken(projectId: string, token: GCPProjectToken): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.token = token
    project.status = 'active'

    const tokenPath = getProjectTokenPath(projectId)
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf-8')
    this._saveProjectConfig(project)
    devLog(`[ProjectManager] Token saved for ${projectId}`)
  }

  /** Get token for a project */
  getToken(projectId: string): GCPProjectToken | null {
    const project = this._projects.get(projectId)
    if (!project?.token) return null
    if (!project.token.access_token) return null
    return project.token
  }

  // ── Stats Tracking ───────────────────────────────────────────────────────────

  /** Track 1 unit consumed by a project */
  track(projectId: string, units: number = 1): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.stats.usedToday += units
    project.stats.lastUsed = Date.now()
    project.totalQuotasUsed += units

    // Check exhaustion
    if (project.stats.usedToday >= MAX_UNITS_PER_PROJECT) {
      this.markExhausted(projectId)
    }

    this._saveProjectStats(project)
  }

  /** Record an error for a project */
  recordError(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.stats.errors++
    if (project.stats.errors >= EXHAUSTION_ERROR_THRESHOLD) {
      this.markExhausted(projectId)
    }
    this._saveProjectStats(project)
  }

  /** Record a quota error (403) */
  recordQuotaError(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    // Adding 100 units simulates hitting quota limit
    project.stats.usedToday += 100
    project.stats.errors++
    project.stats.lastUsed = Date.now()

    if (project.stats.errors >= EXHAUSTION_ERROR_THRESHOLD) {
      this.markExhausted(projectId)
    }

    this._saveProjectStats(project)
    console.warn(`[ProjectManager] Quota error on ${projectId}: errors=${project.stats.errors}, used=${project.stats.usedToday}`)
  }

  /** Mark a project as exhausted */
  markExhausted(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.status = 'exhausted'
    this._saveProjectConfig(project)
    devLog(`[ProjectManager] Project ${projectId} marked exhausted (used=${project.stats.usedToday}, errors=${project.stats.errors})`)
  }

  /** Mark a project as unauthorized (401 — token revoked) */
  markUnauthorized(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.status = 'unauthorized'
    project.stats.unauthorized = true
    this._saveProjectConfig(project)
    this._saveProjectStats(project)
    console.warn(`[ProjectManager] Project ${projectId} marked unauthorized`)
  }

  /** Mark a project as pending auth */
  markPendingAuth(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.status = 'pending_auth'
    project.token = undefined
    this._saveProjectConfig(project)
  }

  /** Reset stats for a project */
  resetProject(projectId: string): void {
    const project = this._projects.get(projectId)
    if (!project) return

    project.stats = {
      ...this._defaultStats(),
      lastResetAt: this._todayUTCDate(),
    }
    project.status = project.token ? 'active' : 'pending_auth'
    project.stats.unauthorized = false

    this._saveProjectStats(project)
    this._saveProjectConfig(project)
    devLog(`[ProjectManager] Reset stats for ${projectId}`)
  }

  /** Reset ALL projects (manual reset from Settings UI) */
  resetAll(): void {
    for (const project of this._projects.values()) {
      this.resetProject(project.projectId)
    }
    devLog('[ProjectManager] Reset all project stats')
  }

  // ── Midnight Reset ──────────────────────────────────────────────────────────

  /** Check if midnight UTC reset is needed */
  private _checkReset(): void {
    const today = this._todayUTCDate()
    if (this._lastResetUTCDate === today) return

    devLog(`[ProjectManager] Midnight reset: "${this._lastResetUTCDate}" → "${today}"`)
    this._lastResetUTCDate = today

    for (const project of this._projects.values()) {
      // Re-enable exhausted projects
      if (project.status === 'exhausted') {
        project.status = project.token ? 'active' : 'pending_auth'
        this._saveProjectConfig(project)
      }

      // Reset daily stats
      project.stats = {
        usedToday: 0,
        errors: 0,
        lastUsed: project.stats.lastUsed,
        lastResetAt: today,
        unauthorized: false,
      }
      this._saveProjectStats(project)
    }

    devLog('[ProjectManager] All projects reset for new day')
  }

  /** Check reset on interval (call every 30 min) */
  checkReset(): void {
    this._checkReset()
  }

  // ── Rotation / Selection ─────────────────────────────────────────────────────

  /** Get the primary project for a specific channel */
  getProjectForChannel(channelId: string): GCPProject | null {
    const assignment = this.getAssignmentForChannel(channelId)
    if (assignment) {
      const project = this._projects.get(assignment.primaryProjectId)
      if (project && this._isProjectUsable(project)) return project

      // Fallback to backup
      const backup = this._projects.get(assignment.backupProjectId)
      if (backup && this._isProjectUsable(backup)) return backup
    }

    // No assignment or project unavailable → use least-used active project
    return this.getLeastUsedProject()
  }

  /** Get backup project for a channel */
  getBackupProjectForChannel(channelId: string): GCPProject | null {
    const assignment = this.getAssignmentForChannel(channelId)
    if (assignment) {
      const backup = this._projects.get(assignment.backupProjectId)
      if (backup && this._isProjectUsable(backup)) return backup

      // Backup unavailable → use next-least-used
      return this.getLeastUsedProject()
    }
    return this.getLeastUsedProject()
  }

  /** Get the least-used active project (for on-demand scanning) */
  getLeastUsedProject(): GCPProject | null {
    const active = this.getActiveProjects()
    if (active.length === 0) return null

    active.sort((a, b) => a.stats.usedToday - b.stats.usedToday)
    return active[0]
  }

  /** Get all active (non-exhausted, non-unauthorized) projects */
  getActiveProjects(): GCPProject[] {
    return [...this._projects.values()].filter(p => this._isProjectUsable(p))
  }

  /** Check if a project is usable */
  private _isProjectUsable(p: GCPProject): boolean {
    if (p.status === 'exhausted') return false
    if (p.status === 'unauthorized') return false
    if (p.status === 'pending_auth') return false
    if (!p.token?.access_token) return false
    if (p.stats.usedToday >= MAX_UNITS_PER_PROJECT) return false
    if (p.stats.unauthorized) return false
    return true
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private _saveProjectConfig(project: GCPProject): void {
    const configPath = getProjectConfigPath(project.projectId)
    const { token: _token, stats: _stats, ...config } = project
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  private _saveProjectStats(project: GCPProject): void {
    const statsPath = getProjectStatsPath(project.projectId)
    fs.writeFileSync(statsPath, JSON.stringify(project.stats, null, 2), 'utf-8')
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /** Get all projects */
  getAllProjects(): GCPProject[] {
    return [...this._projects.values()]
  }

  /** Get a specific project */
  getProject(projectId: string): GCPProject | null {
    return this._projects.get(projectId) ?? null
  }

  /** Get project status summary */
  getStatus(): ProjectManagerStatus {
    let active = 0, exhausted = 0, pendingAuth = 0, unauthorized = 0
    let totalUsedToday = 0
    const totalQuota = this._projects.size * MAX_UNITS_PER_PROJECT

    for (const p of this._projects.values()) {
      totalUsedToday += p.stats.usedToday
      switch (p.status) {
        case 'active': active++; break
        case 'exhausted': exhausted++; break
        case 'pending_auth': pendingAuth++; break
        case 'unauthorized': unauthorized++; break
      }
    }

    return {
      total: this._projects.size,
      active,
      exhausted,
      pendingAuth,
      unauthorized,
      totalQuotaRemaining: totalQuota - totalUsedToday,
      totalQuotaUsedToday: totalUsedToday,
      assignments: this._assignments,
    }
  }

  /** Get projects grouped by Gmail account */
  getProjectsByGmail(): Record<string, GCPProject[]> {
    const groups: Record<string, GCPProject[]> = {}
    for (const project of this._projects.values()) {
      const gmail = project.gmailAccount || 'unknown'
      if (!groups[gmail]) groups[gmail] = []
      groups[gmail].push(project)
    }
    return groups
  }

  private _todayUTCDate(): string {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  }

  private _logSummary(): void {
    const status = this.getStatus()
    devLog(`[ProjectManager] Summary: total=${status.total}, active=${status.active}, exhausted=${status.exhausted}, pending_auth=${status.pendingAuth}`)
    devLog(`[ProjectManager] Quota: ${status.totalQuotaUsedToday}/${status.totalQuotaRemaining + status.totalQuotaUsedToday} used today`)
  }

  /** Get usedToday for a specific project */
  getUsedToday(projectId: string): number {
    return this._projects.get(projectId)?.stats.usedToday ?? 0
  }

  /** Compute timestamp of next midnight UTC reset */
  getNextResetTime(): number {
    const now = new Date()
    const msUntilMidnightUTC = (24 - now.getUTCHours()) * 3600 * 1000
      - now.getUTCMinutes() * 60000
      - now.getUTCSeconds() * 1000
      - now.getUTCMilliseconds()
    return Date.now() + msUntilMidnightUTC
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: ProjectManager | null = null

export function getProjectManager(): ProjectManager {
  if (!_instance) {
    _instance = new ProjectManager()
    _instance.init()
  }
  return _instance
}

export { ProjectManager }
