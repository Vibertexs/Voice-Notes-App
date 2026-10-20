# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use GitHub's
[private vulnerability reporting](../../security/advisories/new) on this repository. Include what you
found, how to reproduce it, and what you think the impact is.

## What matters most here

- **Audio must never leave the phone.** Any code path that could upload a recording is a bug.
- **One account must never read another's data.** Every server query is scoped to the signed-in
  user; assistant tokens are read-only and tied to one user.
- **Secrets** (database credentials, signing keys) live only in the server's `.env`, which is not
  committed. Tokens and refresh secrets are stored hashed.
