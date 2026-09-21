# Keeping this fork in sync with upstream

This fork tracks `stablyai/orca`, which moves several hundred commits a week, while offering most of its own changes back as pull requests. Those two goals pull in opposite directions: a pull request wants a branch cut from a _fresh_ upstream tip, and a usable local build wants _all_ the changes at once.

The split that resolves it:

- **Feature branches are the source of truth.** Each one is cut from `origin/main` and holds exactly one feature. This is what a pull request points at, and what gets rebased when upstream moves.
- **`fork/main` is an output, never a source.** It is thrown away and rebuilt from the feature branches on every sync. Never commit to it directly — the next rebuild drops the commit.
- **`.fork/features.yaml` says which branches exist and why.** Not what they changed (that is the diff) and not whether upstream merged them (that is read from GitHub).

## Commands

```bash
just fork-status     # what the fork carries; what upstream did with each pull request
just fork-check      # has anything been committed to fork main outside the manifest
just fork-test       # tests for this tooling
just sync-dry        # full sync, changing nothing local
just sync            # rebase every branch, rebuild fork main, push, report on the pull requests
```

`just sync` in order: fetch upstream → read pull request states → refuse to run if the manifest is stale → rebase each branch onto `origin/main` → rebuild `fork/main` from scratch → typecheck the result → force-push the branches and `fork/main` → print pull request mergeability.

Flags, all passed through by `just sync`: `--no-push` stops after the rebuild, `--skip-verify` skips the typecheck, `--allow-drift` discards commits made directly to `fork/main`, `--dry-run` rebases nothing and publishes nothing. Every command starts with a fetch, `--dry-run` included, so remote-tracking refs do move.

Two side effects worth knowing about, both deliberate:

- `just sync` sets `rerere.enabled` and `rerere.autoUpdate` for this repository, which changes **all** manual merges here, not only the rebuild: a conflict you have resolved once is replayed and staged for you.
- Each rebuild is recorded at `refs/fork-sync/build`, which is also what keeps the commit from being garbage-collected once the scratch worktree is gone. `just install` refuses to install a tree that is not that build (`just install any-tree` overrides), because a checkout sitting on one feature branch builds an app missing every other feature, and nothing about the result says so.

## Why it refuses to run on a merged feature

When upstream merges a pull request it squashes it, so the original commits no longer match by patch id. Replaying such a branch does not produce an empty patch that git can drop — it conflicts with its own landed copy. Hence the hard stop: a merged feature must leave `.fork/features.yaml` before the next sync, which is also when its `why` entry stops being worth keeping.

A pull request **closed without a merge** stops the sync too, because only a human knows whether it was abandoned or upstream fixed the same thing another way.

## When a rebase conflicts

Each feature branch is checked out in its own Orca workspace, so the rebase happens there and is deliberately left mid-conflict for you to finish (`git rebase --continue`, or `--abort`). Then run `just sync` again; `rerere` is enabled, so a conflict resolved once is replayed automatically next time.

A conflict while **rebuilding `fork/main`** is a different animal: it means two of your own features clash with each other, and neither branch is wrong on its own. Resolve it in the scratch tree whose path is printed and **commit the merge there**. The tree is thrown away, but `rerere` records the resolution and replays it on every later rebuild, so this is a once-per-clash cost rather than a per-sync one.

Two practical notes for that tree:

- Generated files (`src/cli/bundled-skill-guides.ts`) are rebuilt, not merged. Run the generator **with the scratch tree as the working directory** — pointed at it by path alone, it silently reads the real checkout and reports success while the conflict markers stay.
- `node_modules` is symlinked into the scratch tree so generators and typechecks work there. Never run `pnpm run <script>` in it: pnpm runs its install lifecycle first and rebuilds native modules in the real checkout through that link. Call `node <script>` directly. Remove the link before `git worktree remove`.

## Why it typechecks before publishing

Branches that each typecheck alone can merge into a tree that does not — one renames what another calls. `fork/main` is what `just install` builds, so the rebuild is typechecked (about 15 seconds, all projects in parallel) and nothing is pushed if it fails.

## How drift is detected

Each rebuild ends with an empty `chore(fork): sync marker` commit carrying the recipe:

```
Fork-Base: <origin/main sha>
Fork-Feature: <branch> <sha>
```

So `fork/main` documents its own build with no lock file to keep in step. If the marker is not at the tip, someone committed straight to `fork/main`; `just fork-check` lists those commits, and `just sync` refuses to discard them without `--allow-drift`.

A `fork/main` with **no marker at all** — one built by hand before this tooling existed — needs the same flag, and for a stronger reason: nothing on it is known to come from the manifest, so the rebuild replaces all of it. Check `git log --oneline origin/main..refs/remotes/fork/main` before passing the flag, and move anything worth keeping into a branch listed in `.fork/features.yaml`.

## Frozen features

`kind: frozen` documents a branch that is deliberately left out of the build — not one that cannot be replayed. The Arcadia stack is the current example: it sits hundreds of commits back, but a trial merge (`git merge-tree --write-tree --name-only origin/main <branch>`) conflicts in 19 files, so reviving it is an afternoon of work rather than a rewrite. Measure before freezing, and record the number: "too far behind" guessed from a commit count is how the entry got written wrong the first time.

## What the publish step refuses to do

Everything goes out in one atomic push, so a lease that fails cannot leave the fork holding some branches from this build and some from the last one.

The obvious check — "is the remote ahead of me" — is dead exactly when a rebase happened, which is every sync: a rebased branch always carries commits the remote has never seen. `--force-with-lease` does not help either, because the lease is taken from the ref this sync just fetched, so it is satisfied by the very commit that would be lost.

The first sync of a branch the fork already carries from before this tooling existed will usually refuse, and that is working as intended: there is no record of what was published, and a rebase across a few hundred upstream commits changes patch ids enough that the old copy no longer matches. Read the listed commits, confirm they are your own, then register what the fork holds and sync again:

```bash
git update-ref refs/fork-sync/published/<branch> $(git rev-parse refs/remotes/fork/<branch>)
```

So commits are matched **by patch id, not by sha**. A commit on the fork counts as foreign only when nothing on either side we know about carries the same patch: neither the branch about to be published, nor `refs/fork-sync/published/<branch>`, which records what this tool last pushed. The first side makes the cure work — pull the foreign commit into the feature branch and the refusal clears. The second covers a rebase that resolved a conflict, which rewrites patch ids and would otherwise make our own superseded commits look like someone else's. When something is genuinely foreign, nothing is published at all — not that branch, not the others, not `fork/main`.

## Note on `node:child_process`

`AGENTS.md` requires app code to spawn through `src/shared/child-process`. This tooling calls `execFileSync` directly: it never ships in the app, runs only on a developer machine, and lives on a fork-only branch. The import-boundary ratchet scans `src/` and `.ts`/`.tsx` only, so it does not apply here.
