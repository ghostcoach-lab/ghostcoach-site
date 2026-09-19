# Domain Docs

This is a single-context repository. Domain language belongs in `CONTEXT.md` at the repository root, and durable architectural decisions belong in `docs/adr/`.

## Before exploring

- Read root `CONTEXT.md` when it exists.
- Read ADRs under `docs/adr/` that affect the area being changed.
- If these files do not exist, proceed silently. Do not suggest creating them preemptively; `/domain-modeling` creates them when terminology or decisions need to be recorded.

## Expected layout

```text
/
|-- CONTEXT.md
|-- docs/
|   `-- adr/
`-- application source
```

## Vocabulary

Use domain terms exactly as defined in `CONTEXT.md` in issue titles, plans, tests, code, and documentation. Avoid introducing synonyms for established concepts.

If a needed concept is absent, first decide whether the new term is unnecessary. If it represents a real domain gap, record it through `/domain-modeling`.

## ADR conflicts

Surface any conflict with an existing ADR explicitly rather than silently overriding it. Name the ADR and explain why the decision may need to be reopened.
