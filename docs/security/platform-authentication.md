# Platform Administrator Authentication

## Implemented flow

The browser at `admin.gym.rw` calls `api.gym.rw` directly with credentials enabled. Password login
normalizes email, performs an Argon2id comparison even for unknown identities, and requires an active,
email-verified user with an active `PlatformStaff` assignment. Successful password verification creates
only a five-minute MFA challenge; it never creates an administrative session.

Accepted password hashes are Argon2id v19 with 64–256 MiB memory, three to six iterations, and one to
four lanes. Password request bodies are capped at 1,024 characters. Password provisioning remains a
separate controlled workflow.

MFA verification accepts either a confirmed TOTP factor or one unused recovery code. AES-256-GCM
authenticated decryption uses the credential's stored key identifier and version. TOTP acceptance,
recovery-code consumption, challenge consumption, and session creation occur within a serializable
transaction. Conditional updates prevent challenge, TOTP-step, and recovery-code replay.

The session endpoint checks absolute expiry, idle expiry, revocation, password-change time, active user
and staff status, and current role-permission relationships. A staff identity with no effective
permission is denied. Role names never grant implicit authority. Logout digests the presented cookie,
revokes only the matching record, and clears the cookie with the original attributes.

## Browser and CSRF model

Production sessions use `__Host-nexcode-platform-session` with `Secure`, `HttpOnly`,
`SameSite=Strict`, `Path=/`, and no `Domain`. Consequently, sibling subdomains cannot receive or set
that cookie. The API requires the exact configured `Origin` on login, MFA verification, and logout.
Login returns a random CSRF value and sets the same value in an API-host-only readable cookie; the
frontend sends the response value in `X-Platform-CSRF-Token` for MFA. Successful MFA rotates that value
for later logout. CORS is browser policy and never establishes authentication or authorization.

Authentication throttling keys the network source from the server socket and ignores forwarded IP
headers. A future trusted-proxy deployment needs an explicit reviewed proxy-hop configuration; until
then a reverse proxy may make the limiter deliberately more restrictive, never easier to bypass.

A future Next.js Backend-for-Frontend would terminate the browser session on the admin origin and use
a separate server-to-server credential to call the API. That architecture must not forward this API
cookie or silently broaden it to `.gym.rw`.

## Keys and rotation

`PLATFORM_AUTH_TOKEN_PEPPER` is a managed 32-byte base64 secret used for keyed database digests.
Changing it invalidates outstanding challenges, recovery-code lookup, and sessions, so rotation needs
an explicit sign-out plan.

`PLATFORM_TOTP_KEYRING` is a comma-separated `key-id=base64-key` list. Decryption selects the exact key
stored in `PlatformTotpCredential.encryptionKeyId`; old keys remain until credentials are re-encrypted
through a future controlled enrollment/rotation workflow. Version 1 binds ciphertext to staff ID, key
ID, and encryption version as AES-GCM additional authenticated data. Keys never belong in PostgreSQL,
Git, logs, or examples.

## Release and deployment prerequisites

1. Verify that the immutable `@nexcoderw/gym-db` package contains the Step 4 Prisma client and public
   exports. The repository currently says `0.1.1` but has no matching release tag.
2. Review and deploy `20261012235203_platform_auth_persistence` through the database runbook before the
   API release. The API never executes migrations.
3. Install the exact approved database version and regenerate `package-lock.json` through npm.
4. Supply production database, pepper, dummy Argon2id hash, TOTP keyring, exact admin Origin, and secure
   cookie settings through managed configuration.
5. Keep one API replica. The current account limiter is in process; multiple replicas are blocked from
   production readiness until a distributed limiter is implemented.
6. Provision and enroll the first administrator through a separate human-controlled workflow. There is
   no sign-up, bootstrap, password-reset, invitation, or MFA-enrollment endpoint here.

## Local development

Use an isolated disposable database and fictional administrator. Local HTTP deliberately uses
`nexcode-platform-session` and `nexcode-platform-csrf` without `Secure`; production validation always
requires secure `__Host-` cookies and HTTPS Origin. Never use production identities or keys locally.

Operational security messages contain event names and internal staff/challenge identifiers only. They
exclude email, passwords, tokens, MFA values, cookies, decrypted secrets, recovery codes, and keys.
They are not a substitute for the future tamper-resistant privileged audit system.
