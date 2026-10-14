# Publishing to npm

The bindings are published as five npm packages with the same version:

| Package | Contents | Installed on |
| --- | --- | --- |
| `edifabric-x12` | the bindings; optional dependencies on the four packages below | every platform |
| `@edifabric/x12-win32-x64` | `edifabric-x12-tools.dll` | Windows x64 |
| `@edifabric/x12-linux-x64` | `edifabric-x12-tools.so` | Linux x64, glibc 2.34+ |
| `@edifabric/x12-linux-arm64` | `edifabric-x12-tools.so` | Linux arm64, glibc 2.34+ |
| `@edifabric/x12-darwin-arm64` | `edifabric-x12-tools.dylib` | macOS 12+ on Apple silicon |

npm installs only the platform package whose `os`, `cpu`, and `libc` match the machine, and
`edifabric-x12.js` loads the library from it when no other library is found. The libraries come
from the public downloads at `https://www.edifabric.com/download/`, so publish a release only
after the native build for that version is uploaded there.

| File | Purpose |
| --- | --- |
| `package.json` | metadata and version for all five packages |
| `scripts/fetch-natives.ps1`, `.sh` | download the four libraries into `natives/<rid>/` |
| `scripts/build-packages.mjs` | generate the five packages into `dist/npm/` |
| `scripts/smoke-test.cjs` | check that an installed package loads its bundled library |
| `scripts/release.ps1`, `.sh` | fetch, build, smoke-test, and publish from your machine |
| `.github/workflows/publish-npm.yml` | the same pipeline in GitHub Actions, with a smoke test on every platform |

## One-time setup

1. Sign in to [npmjs.com](https://www.npmjs.com) with the EdiFabric account and create the
   organization `edifabric` (**Add organization**), which owns the `@edifabric` scope. The free
   plan is enough for public packages.
2. Create a granular access token with read and write access to `edifabric-x12` and the
   `@edifabric` scope, and add it to the GitHub repository as the secret `NPM_TOKEN`
   (**Settings > Secrets and variables > Actions**). Create the environment `npm`
   (**Settings > Environments**) and add required reviewers if releases need approval.
3. The first release creates the five packages, so it must use the token. After it, switch each
   package to [trusted publishing](https://docs.npmjs.com/trusted-publishers): on npmjs.com open
   the package, **Settings > Trusted publisher > GitHub Actions**, owner `EdiFabric`, repository
   `edifabric-nodejs-bindings`, workflow `publish-npm.yml`, environment `npm`. Then delete the
   `NPM_TOKEN` secret.
4. For publishing from your machine only: run `npm login` with an account that has publish
   rights to the packages.

## Release

1. Upload the new native build to `https://www.edifabric.com/download/`.
2. Set `version` in `package.json` to the native library version, for example `1.1.1`, and
   commit.
3. Validate the packages:
   - GitHub: **Actions > Publish to npm > Run workflow** with **dry-run** checked
   - or locally: `./scripts/release.ps1 -DryRun` (Windows) or `scripts/release.sh --dry-run`
4. Optionally publish a prerelease under the `next` dist-tag: run the workflow with dry-run
   cleared and tag `next`, or `./scripts/release.ps1 -Tag next`, then test it with
   `npm install edifabric-x12@next`.
5. Create a GitHub release with the tag `v<version>`, for example `v1.1.1`. Publishing the
   release runs the workflow and publishes under `latest`; the workflow fails if the tag and the
   version differ. Locally, the equivalent is `./scripts/release.ps1` or `scripts/release.sh`.

The platform packages are published before `edifabric-x12`, so its optional dependencies
resolve as soon as it appears. npm never accepts the same version twice, so the scripts and the
workflow skip any package whose version is already published; if a release fails halfway, fix
the cause and run it again to publish the rest.

The local scripts need Node.js 18 or later. Workflow runs from GitHub Actions attach
[provenance](https://docs.npmjs.com/generating-provenance-statements) to every package.
