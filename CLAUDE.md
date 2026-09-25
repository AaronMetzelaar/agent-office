# Agent Office

## Done means pushed to origin/main

The installed app updates from `origin/main` and nothing else. A commit left on a worktree branch, or a build copied into `/Applications`, disappears at the next update.

- When a change is finished, rebase onto `origin/main`, run `pnpm typecheck` and `pnpm test`, and push to `main`. Stopping at a local commit or a branch isn't finished.
- If you can't push, because main is broken, a rebase conflicts or the push is rejected, say so in your last message and name the branch that holds your work.
- Never copy a build into `/Applications` yourself. Push, then tell the user to click Update in the app or run `pnpm app:install`.
