# License and Attribution

**Language:** English | [简体中文](../../zh-CN/guide/license.md)

HAPI Nexus is an independent modified version of HAPI.

## License

This project is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). The full license text is in [LICENSE](../../../LICENSE).

AGPL-3.0 is a strong copyleft license for software that may be used over a network. In practice, for this project:

- keep the AGPL-3.0 license text in the repository
- keep upstream copyright and license notices intact
- clearly state that this repository is modified from HAPI
- license the modified project as a whole under AGPL-3.0
- when distributing binaries, provide the corresponding source code
- when operating a modified network service, provide the corresponding source code for the version users interact with

This document is a project compliance note, not legal advice.

## Upstream Attribution

This project is derived from HAPI:

- upstream source used for this fork: https://github.com/jacobs-256/hapi
- original HAPI project referenced by the upstream fork: https://github.com/tiann/hapi

HAPI itself includes lineage from Happy and happy-cli:

- Happy: https://github.com/slopus/happy
- happy-cli notice: [cli/NOTICE](../../../cli/NOTICE)

See [NOTICE.md](../../../NOTICE.md) for the project-level modification notice.

## Project Identity

HAPI Nexus is not the upstream HAPI project and is not represented as an official upstream release. It keeps the `hapi` CLI command for compatibility with the existing codebase.

Before publishing packages under a new namespace, update package metadata, release scripts, and installation docs to point to the new package/repository names.
