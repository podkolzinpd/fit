# invite-client

Authenticated trainer-only Edge Function that:

1. verifies ownership of the active client with the caller's JWT;
2. creates a Supabase Auth invitation using the server-only service role key;
3. links the newly invited Auth user to `clients.auth_user_id`;
4. removes the newly created Auth user if linking loses an optimistic race.

The function intentionally refuses to link an already registered email: an
existing account must never be attached to a trainer's client record without a
separate proof-of-control flow.

Local invocation requires the standard local Supabase secrets and optionally:

```text
CLIENT_INVITE_REDIRECT_URL=http://127.0.0.1:5173/auth/callback
```
