# Orca CLI

This discovery stub loads the version-matched guide from the Orca executable used for this session.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get orca-cli
```

When the guide names a reference such as `references/browser.md`, load it with
`ORCA skills get orca-cli --reference browser`; it is not a file on disk. If that binary
rejects `--reference`, run `ORCA skills get orca-cli --full` and read the named reference.

<!-- shared: no-guessing -->
