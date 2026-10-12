# ADR 0001: Begin as a Modular Monolith

- Status: Accepted
- Date: 2026-10-12

One shared NestJS application serves all organizations. Feature-first modules provide ownership and
test boundaries while one deployment avoids premature distributed transactions, duplicated security,
and operational overhead. Extraction requires measured scaling, isolation, or team-autonomy evidence.
