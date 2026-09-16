<!-- Thanks for the PR. CONTRIBUTING.md has the details; this is the short version. -->

## What this changes

<!-- One paragraph. If it fixes an issue, "Fixes #123". -->

## Why

<!-- The problem it solves, not the diff restated. -->

## What a reviewer should be suspicious of

<!-- The part you are least sure about, the case you could not test, the assumption you made. This field is the point of the template. -->

## How you verified it

<!-- What you actually ran. Not "it should work". -->

- [ ] `pnpm ci` passes (typecheck, tests, build, `npm pack --dry-run`)
- [ ] Verified by hand:
      <!-- e.g. a real panel run, a real `consensus install` into a host, `node dist/cli.js <cmd> --help` -->

## Checklist

- [ ] One concern per PR — no behaviour change bundled with a refactor
- [ ] New behaviour has a test; a bug fix has a test that fails without the fix
- [ ] Docs updated in this PR (README stays short; detail goes in `docs/`)
- [ ] Every factual claim in the docs still matches the code (flags, defaults, paths, error text)
- [ ] `dist/` rebuilt and included, if `src/` changed
- [ ] `sh -n install.sh` passes, if the installer changed — POSIX `sh`, bash 3.2 safe, no non-ASCII right after a `$VAR`
- [ ] No new benchmark or quality claim without the suite and the run behind it
- [ ] The subscription rate-limit and vendor-terms disclosure is unchanged, or the change makes it more honest rather than softer
