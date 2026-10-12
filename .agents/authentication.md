# Authentication

## Standards

Use proven session/token protocols, secure HttpOnly/Secure/SameSite cookies for browsers, CSRF defense
where cookies authenticate, short-lived scoped mobile tokens, revocation, rotation, recovery controls,
login throttling, and MFA for privileged accounts. Hash managed passwords with an approved adaptive
algorithm and parameters reviewed at implementation time.

## Forbidden practices

No custom crypto, localStorage browser bearer tokens by default, secrets in logs, long-lived
unrevocable tokens, account enumeration, or authentication inferred from tenant context.

## Example and checklist

A valid session identifies a principal but still needs organization authorization. Review credential
storage, fixation, expiry, logout/revocation, CSRF, MFA, recovery, and audit behavior.
