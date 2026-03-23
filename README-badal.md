# Badal Gemini CLI Notes

This document explains the long-lived Badal-specific shape of the
`badal-io/gemini-cli` fork. It is meant to capture fork-level operational and
development context, not ticket-specific work.

## What This Repo Is

- This repository is a fork of `google-gemini/gemini-cli`.
- Badal uses the fork in `badal-io/gemini-cli`.
- The `badal` branch is the effective Badal baseline branch.

Important: a lot of upstream identity still remains in the codebase.

- Package names are still largely `@google/*`.
- The root `package.json` repository URL still points at the upstream Google
  repository.
- The root `README.md` and many GitHub workflows still describe the upstream
  project rather than Badal's operational use.

## How Badal Uses This Fork

Badal does not use this repo only as a local CLI. This fork is also used as the
runtime for containerized agent sessions launched by Backstage.

The high-level Badal-specific shape is:

- a custom runtime image defined in `deploy/cloudrun/Dockerfile`
- a Badal-managed image build workflow in `.github/workflows/cloudrun-image.yml`
- bundled extensions installed into the runtime image
- extra operational tooling added to the container for agent use
- integration with Backstage, which is responsible for launching sessions and
  injecting runtime configuration

## Runtime Image

The custom runtime image is built from `deploy/cloudrun/Dockerfile`.

At a high level it:

- builds and packs the Gemini CLI monorepo packages
- installs the packed CLI artifacts globally in the runtime container
- installs operational tools used by agent sessions such as `gh`, `gcloud`,
  `terraform`, `vault`, `bun`, and `bd`
- installs extensions under `/root/.gemini/extensions`
- copies in Badal-managed Gemini settings and the container entrypoint

Known note:

- the `hookwise` / `captain-hook` extension is intentionally disabled in the
  Dockerfile because of build issues

## Extensions

Gemini CLI already supports extensions natively. The extension docs live under
`docs/extensions/`.

For Badal, extensions matter because they are part of the deployed agent
runtime, not just a user-side convenience feature.

General extension-related locations to know:

- `docs/extensions/`
- `packages/`
- `deploy/cloudrun/Dockerfile`

When working on extensions in this fork, verify both:

- the extension package itself
- whether the runtime image is bundling it correctly

## Workflows

Current workflow reality:

- the repository still contains a large inherited set of upstream Google
  workflows
- only some workflows reflect Badal-specific operational needs
- `.github/workflows/cloudrun-image.yml` is the clearest Badal-specific workflow
  today

### `cloudrun-image.yml`

Purpose:

- build and publish the `gemini-a2a` runtime image to GHCR

Behavior to verify when editing it:

- which branches trigger builds
- which pull request targets trigger builds
- which paths are included in the workflow filters
- how the image name and tags are computed

## Code Areas That Matter Most For Badal

If you need to understand or modify the Badal flavor, start here:

- `deploy/cloudrun/Dockerfile`
- `.github/workflows/cloudrun-image.yml`
- `docs/extensions/`
- `packages/`

If the work involves agent launch behavior, credentials, or session wiring, the
other repo to read is `repo-devex-backstage`, especially the Gemini agent
backend that injects runtime configuration into this container.

## Testing Notes

Useful baseline commands in this repo:

```bash
npm ci
npm run build
npm test
```

When making Badal-specific changes, also verify the behavior that matters for
the deployment path you touched, for example:

- image build behavior if you changed `deploy/cloudrun/Dockerfile`
- workflow behavior if you changed `.github/workflows/`
- extension packaging if you changed extension-related code

## Practical Takeaways

- Treat this repo as "upstream Gemini CLI plus Badal deployment/runtime
  customizations".
- Do not assume upstream docs, README badges, workflow names, or repository URLs
  reflect Badal's actual usage.
- For agent-runtime work, the Dockerfile, workflows, and extension packaging are
  more important than the upstream marketing/docs surface.
