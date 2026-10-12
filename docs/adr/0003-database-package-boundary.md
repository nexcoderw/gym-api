# ADR 0003: Consume an Exclusive Database Package

- Status: Accepted
- Date: 2026-10-12

Schema, migrations, client generation, and connection lifecycle belong solely to `gym-db`. This API
will consume an exact published `@nexcoderw/gym-db` version through public exports, translate models to
DTOs, and never migrate on startup. Integration waits for publication rather than fabricating exports.
