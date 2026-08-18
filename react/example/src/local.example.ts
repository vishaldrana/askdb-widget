/**
 * Copy to `local.ts` and fill in.
 *
 * `local.ts` is gitignored because `hash` is not a public value: it is an HMAC
 * of a user id with the embed's secret, so anybody holding one can be that
 * customer. The publishable key beside it genuinely is public — it identifies
 * the configuration and grants nothing on its own — but the two travel
 * together, so the whole file stays out.
 */
export const LOCAL = {
  publicKey: "pk_live_replace_me",
  apiUrl: "http://127.0.0.1:8000",
  // In a real app this comes from your server, per request. Hard-coded here
  // because this demo has no server — the one thing about it that is not how
  // you would do it.
  user: {
    id: "cus_0001",
    name: "Example Customer",
    hash: "replace_with_HMAC_SHA256(embed_secret, user_id)",
  },
}
