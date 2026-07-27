import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.110.8"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

type InviteRequest = {
  client_id: string
  email: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new HttpError(500, `${name.toLowerCase()}_not_configured`)
  return value
}

function parseRequest(value: unknown): InviteRequest {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "request_body_required")
  }
  const body = value as Record<string, unknown>
  const clientId = body.client_id
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : ""
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (typeof clientId !== "string" || !uuidPattern.test(clientId)) {
    throw new HttpError(400, "invalid_client_id")
  }
  if (!emailPattern.test(email) || email.length > 254) {
    throw new HttpError(400, "invalid_email")
  }
  return { client_id: clientId, email }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS })
  }

  try {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405)
    }

    const authorization = request.headers.get("Authorization")
    if (!authorization) throw new HttpError(401, "authentication_required")

    const supabaseUrl = requiredSecret("SUPABASE_URL")
    const publishableKey = requiredSecret("SUPABASE_ANON_KEY")
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY")
    const redirectTo = Deno.env.get("CLIENT_INVITE_REDIRECT_URL") ??
      "http://127.0.0.1:5173/auth/callback"
    const input = parseRequest(await request.json())

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) {
      throw new HttpError(401, "authentication_required")
    }

    const { data: client, error: clientError } = await userClient
      .from("clients")
      .select("id,trainer_id,auth_user_id")
      .eq("id", input.client_id)
      .eq("trainer_id", authData.user.id)
      .is("archived_at", null)
      .maybeSingle()
    if (clientError) throw new HttpError(500, "client_lookup_failed")
    if (!client) throw new HttpError(404, "client_not_found")
    if (client.auth_user_id) throw new HttpError(409, "client_already_linked")

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const { data: invite, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(input.email, {
        redirectTo,
      })
    if (inviteError) {
      const alreadyExists = inviteError.message.toLowerCase().includes("already")
      throw new HttpError(
        alreadyExists ? 409 : 502,
        alreadyExists ? "email_already_registered" : "invite_delivery_failed",
      )
    }

    const invitedUserId = invite.user.id
    const { data: linked, error: linkError } = await adminClient
      .from("clients")
      .update({ auth_user_id: invitedUserId })
      .eq("id", input.client_id)
      .eq("trainer_id", authData.user.id)
      .is("auth_user_id", null)
      .select("id")
      .maybeSingle()

    if (linkError || !linked) {
      const { error: cleanupError } =
        await adminClient.auth.admin.deleteUser(invitedUserId)
      if (cleanupError) {
        console.error("invite-client cleanup failed", cleanupError)
      }
      throw new HttpError(409, "client_link_conflict")
    }

    return json({
      data: {
        client_id: linked.id,
        invited_user_id: invitedUserId,
        email: input.email,
      },
    })
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status)
    }
    if (error instanceof SyntaxError) {
      return json({ error: "invalid_json" }, 400)
    }
    console.error("invite-client failed", error)
    return json({ error: "internal_error" }, 500)
  }
})
