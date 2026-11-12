# Releasing

## Core and MCP packages

The `release.yml` workflow publishes Core first, waits for it to become available
on npm, and then publishes MCP. It uses GitHub Actions OIDC trusted publishing;
no `NPM_TOKEN`, local npm login, or per-release OTP is needed.

Configure a GitHub trusted publisher on **each** npm package:

- Packages: `@zilliz/claude-context-core` and `@zilliz/claude-context-mcp`
- Organization: `zilliztech`
- Repository: `claude-context`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allowed action: `npm publish`

New configurations must complete their first successful publish within two days.
See the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

To release, update the root, Core, and MCP package versions together, merge the
changes into `master`, and push a matching `v<version>` tag. Stable versions use
the `latest` dist-tag; prereleases use `next`. The workflow can also be started
manually from `master` with `dry_run` disabled. Published versions are skipped,
so a failed release can be retried without republishing Core.

For validation, run the workflow manually with `dry_run` enabled. It builds and
tests the packages and uploads the npm archives without publishing. A dry run
does not verify OIDC authorization or activate a new trusted publisher.

The workflow uses pnpm 10 to install, build, and pack the workspace, then npm 11
to publish the archives. Packing with pnpm resolves `workspace:*` dependencies
to concrete versions before npm sees them.

## VS Code extension

The extension has its own `release-vscode.yml` workflow and `VSCE_PAT` secret.
Push `vscode-v<extension-version>` to publish it, or start the workflow manually
from `master` with `dry_run` disabled. With `dry_run` enabled, it uploads a VSIX
for inspection. npm releases do not publish the extension.
