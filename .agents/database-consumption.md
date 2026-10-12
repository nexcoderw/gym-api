# Database Package Consumption

## Standards

Consume only explicit public exports from an immutable `@nexcoderw/gym-db` version. Register its
documented Nest module once, enable shutdown hooks, preserve tenant transactions, and translate
database results into API DTOs. Request schema changes in `gym-db` and deploy them in its documented
compatibility order.

## Forbidden practices

No Prisma schema, migrations, generators, local Prisma client, private package paths, duplicate
connections, startup migrations, `db push`, or fabricated exports.

## Example and checklist

After `gym-db@0.2.0` exposes Organization, install that exact version and use its public API. Confirm
version, exported contract, tenant context, error mapping, lifecycle, and rollout prerequisite.
