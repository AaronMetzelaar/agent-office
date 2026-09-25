import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMwsMonorepo, repoInfo } from '../../src/main/departments/repo-info'
import { claudeWorktree, gitRepo, mwsMonorepo, worktree } from '../fakes/repos'

let dir: string
let elsewhere: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-repo-info-')))
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'agent-office-linked-')))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('repo info', () => {
  it('gives a repo and its subfolder the same root and top', () => {
    const repo = gitRepo(join(dir, 'shop'))
    const sub = join(repo, 'src')
    mkdirSync(sub)
    expect(repoInfo(repo)).toEqual({ root: repo, top: repo })
    expect(repoInfo(sub)).toEqual({ root: repo, top: repo })
  })

  it('maps a worktree under .claude/worktrees onto the main repo root, with the worktree as its top', () => {
    const repo = gitRepo(join(dir, 'shop'))
    const tree = claudeWorktree(repo, 'x')
    expect(repoInfo(tree)).toEqual({ root: repo, top: tree })
  })

  it('maps a linked worktree outside the repo onto the main repo root, with the linked folder as its top', () => {
    const repo = gitRepo(join(dir, 'shop'))
    const linked = worktree(repo, join(elsewhere, 'bid-flow'))
    expect(repoInfo(linked)).toEqual({ root: repo, top: linked })
  })

  it('gives nothing for a folder outside git or a missing path', () => {
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    expect(repoInfo(plain)).toBeUndefined()
    expect(repoInfo(join(dir, 'missing'))).toBeUndefined()
  })

  it('treats a repo at the home folder as no repo', () => {
    const home = gitRepo(join(dir, 'home'))
    const sub = join(home, 'notes')
    mkdirSync(sub)
    vi.stubEnv('HOME', home)
    expect(repoInfo(home)).toBeUndefined()
    expect(repoInfo(sub)).toBeUndefined()
  })

  it('reads repos, worktrees and the origin from disk, without running git', () => {
    const repo = mwsMonorepo(join(dir, 'shop'), { readme: '# Shop\n', origin: 'git@github.com:MatchWornShirt/shop.git' })
    const tree = claudeWorktree(repo, 'fix')
    vi.stubEnv('PATH', '')
    expect(repoInfo(join(tree, 'frontend', 'admin'))).toEqual({ root: repo, top: tree })
    expect(isMwsMonorepo(repo)).toBe(true)
    vi.unstubAllEnvs()
  })

  it('answers a second call from its cache without running git again', () => {
    const repo = mwsMonorepo(join(dir, 'monorepo'))
    const sub = join(repo, 'frontend', 'admin')
    const info = repoInfo(sub)
    expect(isMwsMonorepo(repo)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
    expect(repoInfo(sub)).toEqual(info)
    expect(isMwsMonorepo(repo)).toBe(true)
  })
})

describe('MWS monorepo', () => {
  const marketplace = { 'frontend/marketplace/.gitkeep': '' }

  it('recognises the README title', () => {
    expect(isMwsMonorepo(mwsMonorepo(join(dir, 'monorepo')))).toBe(true)
  })

  it('recognises a MatchWornShirt origin when nothing else mentions MWS', () => {
    const repo = mwsMonorepo(join(dir, 'monorepo'), { readme: '# Monorepo\n', origin: 'https://github.com/MatchWornShirt/monorepo.git' })
    expect(isMwsMonorepo(repo)).toBe(true)
  })

  it('recognises a package name in frontend', () => {
    const repo = gitRepo(join(dir, 'monorepo'), { ...marketplace, 'frontend/admin/package.json': JSON.stringify({ name: '@mws/admin' }) })
    expect(isMwsMonorepo(repo)).toBe(true)
  })

  it('needs frontend/marketplace', () => {
    expect(isMwsMonorepo(gitRepo(join(dir, 'monorepo'), { 'README.md': '# MWS Monorepo\n' }))).toBe(false)
  })

  it.each([
    ['mws-gate', true],
    ['mws_tools', true],
    ['matchwornshirt', true],
    ['bmwsomething', false],
    ['jmws', false],
  ])('counts the folder name %s as an MWS mention: %s', (name, mentions) => {
    expect(isMwsMonorepo(gitRepo(join(dir, name), marketplace))).toBe(mentions)
  })
})
