# Documentation maintenance

Keep documentation concise, attributable, and useful to the next implementation decision. The [map](../README.md) identifies the canonical owner of each contract. API shapes live in [contracts/index.ts](../../contracts/index.ts); references describe semantics instead of copying declarations.

Direction owns purpose. Decisions own rationale and alternatives. Implementation owns bounded work and dependencies. Verification owns actual checks and limitations. Research owns upstream precedents and their applicability. Active task narration and selected captures belong in the central personal store.

Update types, reference semantics, examples, navigation, and acceptance cases together when a boundary changes. A draft contract is not implemented behavior. An implemented feature is not verified until the relevant execution checks exist. Keep these statuses explicit without repeating disclaimers in every paragraph.

Fold completed review findings into their owners. Remove redundant review summaries, migration diaries, and copied before/after snapshots after preserving necessary evidence and recovery inputs. Do not erase a failure still needed to understand a risk or reproduce a bug. Keep significant superseded decisions attributable through Git or an explicit replacement decision rather than contradictory active instructions.

Use descriptive headings, unwrapped Markdown paragraphs, complete sentences, and tables for actual comparisons. Explain the subject before implementation details. Avoid marketing language, arbitrary review counts, confidence theater, and mandatory planning rituals. Add a document only when it owns a distinct useful concern. Run `pnpm check` after changes and inspect the resulting diff.

The organization follows the relevant practices reviewed in the local Skyweave and inherent.design repositories. Their project-specific permissions, approval counts, release commands, branding, and gameplay or business requirements are not inherited by Moment. Fresh clones must be usable without those sibling repositories or the author's personal store.
