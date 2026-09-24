import { emptyUsage, type ChatRow, type ChatView } from '../../src/shared/chat'

let seq = 0
const ok = (text: string) => ({ text, isError: false })
const failed = (text: string) => ({ text, isError: true })
const user = (text: string): ChatRow => ({ kind: 'user', id: `u${++seq}`, text })
const say = (text: string, parentToolUseId?: string): ChatRow => ({ kind: 'text', id: `m${++seq}`, text, ...(parentToolUseId ? { parentToolUseId } : {}) })
const tool = (name: string, input: Record<string, unknown>, result?: { text: string; isError: boolean }, parentToolUseId?: string): ChatRow => ({
  kind: 'tool',
  id: `t${++seq}`,
  name,
  input,
  ...(result ? { result } : {}),
  ...(parentToolUseId ? { parentToolUseId } : {}),
})
const bash = (command: string, description: string, result?: { text: string; isError: boolean }, extra: Record<string, unknown> = {}) => tool('Bash', { command, description, ...extra }, result)
const read = (path: string, lines: number, parent?: string) => tool('Read', { file_path: `/repo/${path}` }, ok(`${Array.from({ length: lines }, (_, i) => `${i + 1}\t…`).join('\n')}`), parent)
const edit = (path: string, old_string: string, new_string: string) => tool('Edit', { file_path: `/repo/${path}`, old_string, new_string }, ok(`The file /repo/${path} has been updated.`))
const notification = (toolUseId: string, summary: string): ChatRow =>
  user(`<task-notification>\n<task-id>b7x2k</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`)

const agent = tool(
  'Agent',
  { description: 'Find callers of useAuctionPoll', subagent_type: 'Explore', prompt: 'List every caller of useAuctionPoll and how it uses the result.' },
  ok('useAuctionPoll is used in BidFlow.vue, AuctionCard.vue and LotHeader.vue. Only BidFlow.vue enables a button from the response.'),
)
const background = bash('for i in $(seq 20); do pnpm playwright test bid-flow --reporter=line || break; done', 'Run the bid flow e2e test 20 times', ok('Command running in background with ID: b7x2k'), { run_in_background: true })

export const sessionRows: ChatRow[] = [
  user('The bid flow e2e test is flaky on CI. Can you find out why and fix it?'),
  say('I’ll start with the recent CI runs and the test itself.'),
  bash('gh run list --workflow e2e.yml --limit 5', 'List recent e2e workflow runs', ok('✓ main  e2e  #4121  3m\nX main  e2e  #4119  4m\n✓ main  e2e  #4118  3m\nX main  e2e  #4115  5m\n✓ main  e2e  #4112  3m')),
  bash('gh run view 4119 --log-failed | tail -40', 'Show the failed log of run 4119', ok('bid-flow.spec.ts:48:5 › places a bid\n  TimeoutError: page.waitForResponse: Timeout 5000ms exceeded.\n  waiting for response "**/api/bids"')),
  read('tests/e2e/bid-flow.spec.ts', 64),
  read('src/components/BidFlow.vue', 212),
  tool('Grep', { pattern: 'waitForTimeout', path: 'tests/e2e' }, ok('tests/e2e/bid-flow.spec.ts:44:    await page.waitForTimeout(500)\ntests/e2e/lot.spec.ts:17:    await page.waitForTimeout(250)')),
  tool('WebFetch', { url: 'https://playwright.dev/docs/api/class-page#page-wait-for-response', prompt: 'How does waitForResponse match URLs?' }, ok('waitForResponse accepts a URL glob, regex or predicate and resolves with the first matching response.')),
  say(
    'The failure is a timeout waiting for `/api/bids`. The test clicks **Place bid** after a fixed `waitForTimeout(500)`, and on a slow runner the price poll hasn’t settled yet. Two things look suspicious:\n\n- `useAuctionPoll` refetches every 2 seconds and never cancels the request in flight\n- the button is enabled as soon as *any* poll response lands, even a stale one\n\nLet me check how the poll is wired.',
  ),
  read('src/composables/useAuctionPoll.ts', 58),
  tool('Glob', { pattern: 'src/**/useAuctionPoll*.ts' }, ok('src/composables/useAuctionPoll.ts\nsrc/composables/useAuctionPoll.test.ts')),
  agent,
  tool('Grep', { pattern: 'useAuctionPoll\\(', path: 'src' }, ok('src/components/BidFlow.vue:31\nsrc/components/AuctionCard.vue:12\nsrc/components/LotHeader.vue:9'), agent.id),
  read('src/components/AuctionCard.vue', 88, agent.id),
  read('src/components/LotHeader.vue', 41, agent.id),
  say('Only `BidFlow.vue` gates a button on the response.', agent.id),
  bash('rg -n "pollInterval" config/', 'Find where the poll interval is configured', ok('config/auction.ts:4:  pollInterval: 2000,')),
  say(
    'Found it. `useAuctionPoll` doesn’t abort the previous request when `lotId` changes, so a stale response can re-enable **Place bid** for the wrong lot. I’ll abort in-flight requests on change and make the test wait for the bid response instead of a fixed delay.',
  ),
  edit('src/composables/useAuctionPoll.ts', 'const response = await fetch(url)', 'controller?.abort()\ncontroller = new AbortController()\nconst response = await fetch(url, { signal: controller.signal })'),
  edit('tests/e2e/bid-flow.spec.ts', 'await page.waitForTimeout(500)', "await page.waitForResponse('**/api/lots/*/price')"),
  edit('tests/e2e/bid-flow.spec.ts', "await page.getByRole('button', { name: 'Place bid' }).click()", "const bid = page.waitForResponse('**/api/bids')\nawait page.getByRole('button', { name: 'Place bid' }).click()\nawait bid"),
  bash('pnpm vitest run src/composables/useAuctionPoll.test.ts', 'Run the poll unit tests', ok(' ✓ src/composables/useAuctionPoll.test.ts (6 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)')),
  bash('pnpm typecheck', 'Typecheck the project', failed("src/composables/useAuctionPoll.ts(42,7): error TS2322: Type 'AbortController | undefined' is not assignable to type 'AbortController'.\n\nFound 1 error in src/composables/useAuctionPoll.ts:42")),
  read('src/composables/useAuctionPoll.ts', 61),
  edit('src/composables/useAuctionPoll.ts', 'let controller: AbortController', 'let controller: AbortController | undefined'),
  bash('pnpm typecheck', 'Typecheck the project', ok('')),
  bash('pnpm lint src/composables tests/e2e', 'Lint the changed folders', ok('✔ No problems found')),
  say('Typecheck and lint are clean. Now I’ll run the e2e test 20 times in a row to confirm the flake is gone. That takes a few minutes, so it runs in the background.'),
  background,
  bash('git status --short', 'Show changed files', ok(' M src/composables/useAuctionPoll.ts\n M tests/e2e/bid-flow.spec.ts')),
  bash('git diff --stat', 'Summarise the diff', ok(' src/composables/useAuctionPoll.ts | 6 ++++--\n tests/e2e/bid-flow.spec.ts        | 5 +++--\n 2 files changed, 7 insertions(+), 4 deletions(-)')),
  notification(background.id, 'Background command &quot;Run the bid flow e2e test 20 times&quot; completed (exit code 0)'),
  bash('tail -3 /tmp/tasks/b7x2k.output', 'Read the end of the e2e output', ok('  20 passed (2.9m)\n\nTo open last HTML report run: npx playwright show-report')),
  say(
    'All 20 runs passed. Summary:\n\n1. **Root cause:** a stale poll response re-enabled the button for the previous lot.\n2. **Fix:** `useAuctionPoll` aborts the request in flight when `lotId` changes.\n3. **Test:** waits for the `/api/bids` response instead of `waitForTimeout(500)`.\n\n```diff\n- await page.waitForTimeout(500)\n+ const bid = page.waitForResponse(\'**/api/bids\')\n```\n\nWant me to open a PR?',
  ),
  user('Yes, open a PR'),
  say('Committing on a new branch and opening the PR.'),
  bash('git checkout -b fix/bid-flow-flake', 'Create the fix branch', ok("Switched to a new branch 'fix/bid-flow-flake'")),
  bash('git commit -am "fix(bids): abort stale auction polls"', 'Commit the fix', ok('[fix/bid-flow-flake 3f9c2e1] fix(bids): abort stale auction polls\n 2 files changed, 7 insertions(+), 4 deletions(-)')),
  bash('gh pr create --fill', 'Open the pull request'),
]

export const sessionChat = (fields: Partial<ChatView> = {}): ChatView => ({
  id: 'c1',
  accountId: 'a1',
  cwd: '/repo',
  title: 'Fix the flaky bid flow test',
  archived: false,
  state: 'working',
  stateSince: 0,
  unread: false,
  activity: '',
  pending: [],
  pendingRequests: [],
  subagents: [],
  usage: emptyUsage(),
  partial: '',
  createdAt: 0,
  lastActivityAt: 0,
  rows: sessionRows,
  ...fields,
})
