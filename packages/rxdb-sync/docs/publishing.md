# Publishing

This package currently lives inside a monorepo and exports raw TypeScript source.

That is fine for monorepo consumption.

It is not yet the full shape you usually want for a public npm package.

This guide is about the work that remains if you want to publish it cleanly.

## What Is Already In Good Shape

The package already has:

- a small public API
- a package-level README
- a focused docs set
- a clear architectural boundary

That is the important part. Packaging can be added after the API is already coherent.

## What You Will Likely Want Before Publishing

### Compiled Output

Most npm consumers will expect published JavaScript plus declaration files.

That means adding a build step that emits:

- ESM JavaScript
- `.d.ts` declarations

and pointing `exports` to the build output instead of raw `src/*.ts`.

### Package Metadata

Before publishing, add the normal public metadata:

- `version`
- `license`
- `repository`
- `homepage`
- `bugs`
- `keywords`

The current package metadata is enough for internal use, but not ideal for public distribution.

### Publish Allowlist

You will probably want a `files` field so npm only includes the relevant build output and docs.

Typical publish contents would be:

- `dist/`
- `README.md`
- `docs/`
- `LICENSE`

### Peer Dependency Strategy

Decide whether some runtime libraries should be peers instead of direct dependencies.

That decision depends on how tightly you want version alignment with the consumer app.

At minimum, review:

- `react`
- `rxdb`
- `@tanstack/db`
- `@tanstack/react-db`
- `@tanstack/rxdb-db-collection`

There is no universal answer here, but it is worth deciding intentionally before publication.

### Release Notes And Changelog

Once the package is public, even a small API deserves versioning discipline.

At minimum, decide:

- how breaking changes are communicated
- whether changelog entries are hand-written or generated
- what counts as a public API change

## A Good Publish Standard

Before publishing, a strong baseline is:

- root README explains the package clearly
- docs folder covers setup, samples, troubleshooting, and real use cases
- package builds to distributable output
- type declarations are emitted
- the npm tarball contains only the relevant files
- a smoke test proves the published build works in a clean consumer setup

That last point matters more than people think. A package that works in a monorepo can still fail once installed elsewhere if exports or bundling assumptions were too local.

## What Should Not Change During Publishing

Do not let the act of packaging distort the architecture.

The package should remain:

- headless
- API-agnostic
- storage-agnostic
- domain-agnostic

If the publish step starts pushing domain or runtime assumptions into the package just to make marketing easier, that is usually a design regression.
