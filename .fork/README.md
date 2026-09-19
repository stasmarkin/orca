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
just sync-dry        # full sync, changing nothing
just sync            # rebase every branch, rebuild fork main, push, report on the pull requests
```

`just sync` in order: fetch upstream → read pull request states → refuse to run if the manifest is stale → rebase each branch onto `origin/main` → rebuild `fork/main` from scratch → typecheck the result → force-push the branches and `fork/main` → print pull request mergeability.

Flags, all passed through by `just sync`: `--no-push` stops after the rebuild, `--skip-verify` skips the typecheck, `--allow-drift` discards commits made directly to `fork/main`, `--dry-run` changes nothing.

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

## Frozen features

`kind: frozen` documents a branch that is too far behind to replay — the Arcadia stack sits 600+ commits back, across an upstream source-control refactor, so reviving it is a rewrite rather than a rebase. It stays in the manifest for the record and out of the build.

## Note on `node:child_process`

`AGENTS.md` requires app code to spawn through `src/shared/child-process`. This tooling calls `execFileSync` directly: it never ships in the app, runs only on a developer machine, and lives on a fork-only branch. The import-boundary ratchet scans `src/` and `.ts`/`.tsx` only, so it does not apply here.
