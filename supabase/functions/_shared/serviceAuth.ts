// For functions that only our own functions may call (server to server).
// The caller must send `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
// The anon key and user JWTs are refused.
export function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== serviceKey.length) return false;

  // Constant-time compare, so the key can't be guessed from response times.
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ serviceKey.charCodeAt(i);
  }
  return diff === 0;
}
