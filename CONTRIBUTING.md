# Contributing

Thanks for your interest in Tab Group Sync. This project follows a spec-driven development workflow.

## Workflow

1. **Find or file an issue** describing the problem or feature.
2. **Check the spec** under `.kiro/specs/<spec-name>/`:
   - `requirements.md` — system of record for what the feature does
   - `design.md` — architecture, properties, pseudocode
   - `tasks.md` — implementation tasks and status
   - `progress.txt` — audit log of task completion
3. **Implement** against the spec. If scope changes, update the spec first.
4. **Test** — unit, property, and E2E tests are expected for non-trivial changes.
5. **Open a PR** using the template.

## Development

```bash
npm install
npm run build          # build extension into dist/
npm run watch          # rebuild on change
npm test               # unit + property tests
npm run test:e2e       # E2E tests (builds first)
```

Load the unpacked extension from `dist/` via `chrome://extensions` → Developer mode.

## Testing expectations

- **Unit tests** (Vitest) for pure logic and edge cases
- **Property tests** (fast-check) for invariants — see `tests/property/PROPERTY_COVERAGE.md`
- **E2E tests** (Playwright) interact through the popup UI only — no internal API access

## Release process

Releases are driven by git tags:

1. Bump `version` in `manifest.json` and `package.json` (must match).
2. Update `CHANGELOG.md`.
3. Merge to `main`.
4. Tag: `git tag v1.2.0 && git push origin v1.2.0`
5. The `release` workflow builds, packages `dist/` as a zip, and attaches it to a GitHub Release.
6. Upload the same zip to the Chrome Web Store.

The release workflow verifies the tag version matches `manifest.json` and fails if they drift.

## Code conventions

See `.kiro/steering/` for product, tech, and structure guidelines.
