import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type Database from 'better-sqlite3'
import type { RuleView } from '../../shared/permissions'
import type { Engine, SessionPermissions } from '../sessions/manager'
import { repoRoot } from './repo-root'

export const alwaysAsk = ['WebFetch', 'WebSearch']

const askOnly = (rule: string) => alwaysAsk.some((tool) => rule === tool || rule.startsWith(`${tool}(`))

export function alwaysAllowRules(toolName: string, suggestions: PermissionUpdate[] = []): string[] {
  if (alwaysAsk.includes(toolName)) return []
  return suggestions
    .flatMap((update) => (update.type === 'addRules' && update.behavior === 'allow' ? update.rules : []))
    .map((rule) => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName))
    .filter((rule) => !askOnly(rule))
}

interface Row {
  id: number
  account_id: string
  repo_root: string
  rule: string
  created_at: number
}

export type Rules = ReturnType<typeof createRules>

export function createRules(sql: Database.Database, engine: Pick<Engine, 'running' | 'setPermissions'>, rootOf = repoRoot) {
  sql.exec(`create table if not exists rules (
    id integer primary key,
    account_id text not null,
    repo_root text not null,
    rule text not null,
    created_at integer not null,
    unique (account_id, repo_root, rule)
  )`)
  const insert = sql.prepare('insert or ignore into rules (account_id, repo_root, rule, created_at) values (?, ?, ?, ?)')
  const forRepo = sql.prepare('select rule from rules where account_id = ? and repo_root = ? order by id')
  const all = sql.prepare('select * from rules order by repo_root, id')
  const byId = sql.prepare('select * from rules where id = ?')
  const remove = sql.prepare('delete from rules where id = ?')
  const roots = new Map<string, string>()
  const sessions = new Map<string, { accountId: string; root: string }>()

  const root = (cwd: string) => {
    const known = roots.get(cwd) ?? rootOf(cwd)
    if (known) roots.set(cwd, known)
    return known
  }
  const permissions = (accountId: string, repo: string): SessionPermissions => ({
    allow: (forRepo.all(accountId, repo) as Pick<Row, 'rule'>[]).map((row) => row.rule),
    ask: alwaysAsk,
  })

  function refresh(accountId: string, repo: string): Promise<void> {
    const next = permissions(accountId, repo)
    const updates: Promise<void>[] = []
    for (const [chatId, session] of sessions) {
      if (!engine.running(chatId)) sessions.delete(chatId)
      else if (session.accountId === accountId && session.root === repo) updates.push(engine.setPermissions(chatId, next).catch(() => {}))
    }
    return Promise.all(updates).then(() => {})
  }

  return {
    root,

    forSession(chatId: string, accountId: string, cwd: string): SessionPermissions {
      const repo = root(cwd) ?? cwd
      sessions.set(chatId, { accountId, root: repo })
      return permissions(accountId, repo)
    },

    add(accountId: string, cwd: string, rules: string[]): Promise<void> {
      const repo = root(cwd)
      if (!repo) {
        console.warn(`[rules] git timed out finding the repository for ${cwd}, so the rule wasn’t saved`)
        return Promise.resolve()
      }
      const now = Date.now()
      for (const rule of rules) if (!askOnly(rule)) insert.run(accountId, repo, rule, now)
      return refresh(accountId, repo)
    },

    list: (): RuleView[] =>
      (all.all() as Row[]).map((row) => ({ id: row.id, accountId: row.account_id, repoRoot: row.repo_root, rule: row.rule, createdAt: row.created_at })),

    async revoke(id: unknown): Promise<void> {
      const row = typeof id === 'number' ? (byId.get(id) as Row | undefined) : undefined
      if (!row) return
      remove.run(row.id)
      await refresh(row.account_id, row.repo_root)
    },
  }
}
