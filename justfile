# Local install of Orca from these sources, for this fork only.
#
# `just install` builds the current working tree and replaces /Applications/Orca.app with it.
# The replacement runs detached on purpose: it quits Orca, and this command is usually typed into
# a terminal that Orca itself owns, so an attached script would be killed halfway through.
#
# The installed app keeps bundle id com.stablyai.orca, so it shares the official app's profile
# (~/Library/Application Support/orca) — same workspaces, settings and accounts.
#
# NOTE: this file exists only in the fork. Branch from `origin/main`, not from this branch,
# when preparing a pull request, or it rides along in the diff.

install_dir := env_var('HOME') / '.orca-local-install'
backup_app := install_dir / 'Orca-previous.app'
# The signed release, kept from the first install only: after that every backup is a local build,
# and without this copy there is no way back to a notarized app except a fresh download.
original_app := install_dir / 'Orca-original.app'
install_log := install_dir / 'install.log'
build_ref := 'refs/fork-sync/build'

[private]
default:
    @just --list

# Build a .app from the current working tree (no install).
build:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "just build targets macOS; use pnpm build:linux elsewhere." >&2
      exit 1
    fi
    # Why not plain `pnpm install`: build:mac packages x64 and arm64, and a host-only install
    # makes electron-builder's beforePack guard fail on the slice whose natives are missing.
    pnpm install:release
    pnpm build:mac
    echo "Built: $(just _built-app)"

# Build the current working tree and install it over /Applications/Orca.app.
# `just install any-tree` installs a tree that is not the rebuilt fork main.
install force="": (_assert-build-tree force) build swap

# What just sync rebuilt is the only tree that carries every feature; a checkout sitting on one
# feature branch builds an app missing the rest, and nothing about the result says so.
[private]
_assert-build-tree force:
    #!/usr/bin/env bash
    set -euo pipefail
    # Positional and spelled exactly, not `force=yes`: just reads that form as the argument's value,
    # so the override silently did nothing — and a typo must not be what disables the check.
    if [[ -n "{{ force }}" ]]; then
      if [[ "{{ force }}" != "any-tree" ]]; then
        echo "Unknown argument \"{{ force }}\". To install this tree anyway: just install any-tree" >&2
        exit 1
      fi
      echo "any-tree: installing this tree, whatever it holds."
      exit 0
    fi
    built="$(git rev-parse --verify --quiet {{ build_ref }} || true)"
    if [[ -z "$built" ]]; then
      echo "No build recorded at {{ build_ref }}. Run: just sync (or: just install any-tree)" >&2
      exit 1
    fi
    if [[ "$(git rev-parse HEAD)" != "$built" ]]; then
      echo "This tree is $(git rev-parse --abbrev-ref HEAD), not the fork main just sync rebuilt." >&2
      echo "Installing it would ship only the features on this branch." >&2
      echo "Build from the sync output:" >&2
      echo "  git worktree add --detach /tmp/orca-build {{ build_ref }}" >&2
      echo "  cd /tmp/orca-build && just install" >&2
      echo "Or override: just install any-tree" >&2
      exit 1
    fi

# Install the most recent build without rebuilding.
swap:
    #!/usr/bin/env bash
    set -euo pipefail
    src="$(just _built-app)"
    mkdir -p "{{ install_dir }}"
    installer="{{ install_dir }}/swap.sh"
    cat > "$installer" <<'INSTALLER'
    #!/usr/bin/env bash
    set -euo pipefail
    src="$1"; dest="/Applications/Orca.app"; backup="$2"; original="$3"
    staged="/Applications/.Orca.app.incoming"
    # Gatekeeper, because only a notarized app passes it: "not ad-hoc" would also accept an unsigned
    # slice or one signed with a Developer ID found in the keychain, and either would spend the only
    # slot for the release on a copy of what we are replacing. Version cannot tell them apart —
    # this justfile does not stamp one.
    if [ ! -d "$original" ] && [ -d "$dest" ] && spctl -a -t exec "$dest" >/dev/null 2>&1; then
      echo "[$(date '+%H:%M:%S')] keeping the signed release at $original"
      ditto "$dest" "$original"
    fi
    # Why stage first: the two moves below are the only window where /Applications has no Orca.app.
    # Copying straight over the destination would leave it half-written if this process is killed.
    echo "[$(date '+%H:%M:%S')] staging $src"
    rm -rf "$staged"
    ditto "$src" "$staged"
    # Why: a locally built app is ad-hoc signed, and a stale quarantine flag would make Gatekeeper
    # refuse it without the right-click dance on every install.
    xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true
    echo "[$(date '+%H:%M:%S')] quitting Orca"
    osascript -e 'tell application "Orca" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do pgrep -x Orca >/dev/null || break; sleep 0.5; done
    if pgrep -x Orca >/dev/null; then
      echo "[$(date '+%H:%M:%S')] Orca ignored the quit request; terminating"
      pkill -x Orca || true
      sleep 2
    fi
    rm -rf "$backup"
    [ -d "$dest" ] && mv "$dest" "$backup"
    mv "$staged" "$dest"
    echo "[$(date '+%H:%M:%S')] launching"
    open -a "$dest"
    echo "[$(date '+%H:%M:%S')] done"
    INSTALLER
    chmod +x "$installer"
    echo "Installing $src over /Applications/Orca.app."
    echo "Orca will quit and reopen; this terminal goes with it."
    echo "Progress: tail -f {{ install_log }}"
    echo "Undo:     just revert"
    nohup bash "$installer" "$src" "{{ backup_app }}" "{{ original_app }}" >"{{ install_log }}" 2>&1 &
    sleep 1

# Restore the app this install replaced.
revert:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! -d "{{ backup_app }}" ]]; then
      echo "No backup at {{ backup_app }}." >&2
      exit 1
    fi
    just _swap-back

[private]
_swap-back:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{ install_dir }}"
    installer="{{ install_dir }}/revert.sh"
    cat > "$installer" <<'INSTALLER'
    #!/usr/bin/env bash
    set -euo pipefail
    backup="$1"; dest="/Applications/Orca.app"
    osascript -e 'tell application "Orca" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do pgrep -x Orca >/dev/null || break; sleep 0.5; done
    pgrep -x Orca >/dev/null && { pkill -x Orca || true; sleep 2; }
    rm -rf "$dest"
    mv "$backup" "$dest"
    open -a "$dest"
    INSTALLER
    chmod +x "$installer"
    echo "Restoring {{ backup_app }}; Orca will quit and reopen."
    nohup bash "$installer" "{{ backup_app }}" >"{{ install_log }}" 2>&1 &
    sleep 1

# Tail the detached installer's log.
logs:
    @tail -n 40 "{{ install_log }}" 2>/dev/null || echo "No install log yet."

# Rebase every feature branch onto upstream, rebuild fork main, push, report on the PRs.
sync *args:
    @node .fork/sync.mjs sync {{ args }}

# Full sync without changing or pushing anything.
sync-dry:
    @node .fork/sync.mjs sync --dry-run

# What this fork carries on top of upstream, and what upstream did with each PR.
fork-status:
    @node .fork/sync.mjs status

# Has anything been committed to fork main outside the manifest.
fork-check:
    @node .fork/sync.mjs check

# Mergeability of the open upstream pull requests.
fork-prs:
    @node .fork/sync.mjs prs

# Files are named rather than the directory: node --test reads a dot-directory as a module path.
# Tests for the sync tooling itself (the repo's vitest config does not cover .fork/).
fork-test:
    @node --test .fork/*.test.mjs

[private]
_built-app:
    #!/usr/bin/env bash
    set -euo pipefail
    # Why not `ls -dt dist/mac*`: build:mac packages x64 and arm64, so the newest directory is
    # whichever electron-builder finished last — on an Intel host that installs an arm64 bundle
    # that will not launch, after the working app has already been moved to the backup.
    case "$(uname -m)" in
      arm64) app="dist/mac-arm64/Orca.app" ;;
      x86_64) app="dist/mac/Orca.app" ;;
      *) echo "Unsupported architecture $(uname -m)." >&2; exit 1 ;;
    esac
    if [[ ! -x "$app/Contents/MacOS/Orca" ]]; then
      echo "No $(uname -m) build at $app. Run: just build" >&2
      exit 1
    fi
    printf '%s\n' "$(cd "$(dirname "$app")" && pwd)/$(basename "$app")"
