# Version and module management

The public repository contains only generic, publishable source and synthetic examples. It excludes deployment-specific adapters and configuration, credentials, resource identifiers, recovery material, and memory data.

## Public product lines

Lite and Hybrid V8 are the currently deployable public choices. V9 is under development; a verified feature branch is not a release or a deployment. When V9 is complete, it is planned to replace V8 on `main`.

## V9 modules

| Module | Fixed scope | Public status |
| --- | --- | --- |
| V9-Infra | Client identity, access spaces, grants, authentication, audit, data lifecycle, guarded same-space key rename, and default-off server recall tools | Development branch `codex/v9-infra`; locally verified candidate, not ready for deployment, merged, or released |
| V9.1 | Client-side contextual recall trigger, query construction, filtering, injection, and experience acceptance | In development; not yet in the repository. Planned to ship with V9 when V9 replaces V8 on `main` |
| V9.2 | Deterministic low-frequency surfacing | Not started publicly |
| V9.3 | Generic configuration, install/upgrade, migration, rollback, documentation, and release candidate | Not started publicly |

`main` remains the stable public line. The V9-Infra branch contains the default-off `recall_memory` and `report_recall_feedback` server tools; an AI must choose to call them. It does not yet contain a client hook or gateway that automatically searches before every conversation turn. That layer is still being tuned and is planned to be published with V9.

Status terms are scoped: `implemented` means code exists, `verified` names the checks that passed, and `released` requires a stable-line merge and public release. The package and Worker still report `8.0.0-public.2` because V9 remains an unreleased feature branch; that version is not evidence that the V9 branch is deployable.
