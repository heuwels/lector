Lector reads and studies text in a target language. This document describes the
HTTP API. The Lector web client and every personal access token use this same
API.

## Authentication

Each `/api/*` endpoint needs a credential. Two kinds work:

- A personal access token, sent as `Authorization: Bearer <token>`. Create a
  token in Settings, under API tokens. Scripts and integrations use this kind.
- A session cookie, which the browser client sends. Lector Cloud only.

Each token carries scopes. Every endpoint below states the scope that it needs.
Some resources have no scope at all. A token cannot reach those resources, so
this document leaves them out. Token management, billing, moderation and the
admin console are browser-only surfaces.

## Languages

Lector separates your data by language. Most endpoints accept an optional
`language` query parameter. Give it a language pack code, for example `af`, `es`
or `grc`. If you omit the parameter, the API uses the active language of the
account.

## Errors

An error response carries a JSON body with an `error` string. A `429` response
also names the plan limit that stopped the call.

## Accounts

The cloud sign-in, sign-up, verification and two-factor endpoints are at
`/api/auth/*`. Better Auth serves those endpoints and documents its own
contract. This document does not describe them.
