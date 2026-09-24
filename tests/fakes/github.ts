import type { Run } from '../../src/main/review/git'

export function createFakeGithub() {
  const github = {
    search: [] as unknown[],
    nodes: [] as unknown[],
    missing: false,
    calls: [] as string[][],
    run: (async (_command, args) => {
      github.calls.push(args)
      if (github.missing) throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
      if (args[0] === 'search') return JSON.stringify(github.search)
      if (args[0] === 'api') return JSON.stringify({ data: { viewer: { login: 'aaron' }, nodes: github.nodes } })
      throw Object.assign(new Error('fake gh'), { stderr: 'no pull requests found' })
    }) as Run,
  }
  return github
}
