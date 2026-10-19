# Version and module management

The public repository contains only generic, publishable source and synthetic examples. Private production adapters, configuration, credentials, identifiers, recovery material, and memory data stay outside this repository.

## Public product lines

Lite and Hybrid V8 are the currently deployable public choices. V9 is under development; a verified feature branch is not a release or a deployment.

## V9 modules

| Module | Fixed scope | Public status |
| --- | --- | --- |
| V9-Infra | Client identity, access spaces, grants, authentication, audit, and data lifecycle | Verified public feature branch `codex/v9-infra`; not merged, released, or deployed |
| V9.1 | Contextual recall trigger, query construction, filtering, injection, and experience acceptance | Current next module; no public integration in this branch |
| V9.2 | Deterministic low-frequency surfacing | Not started publicly |
| V9.3 | Generic configuration, install/upgrade, migration, rollback, documentation, and release candidate | Not started publicly |

One commit or push must belong to one module. The branch names are `codex/v9-infra`, `codex/v9-recall`, `codex/v9-surface`, and `codex/v9-productization`. `main` remains the stable public line; feature-branch verification never implies a merge, release, or deployment.

Status terms are scoped: `implemented` means code exists, `verified` names the checks that passed, `candidate` means eligible for a later Gate, and `released` requires an approved stable-line merge and public release. Private production verification and public source status are separate facts.
