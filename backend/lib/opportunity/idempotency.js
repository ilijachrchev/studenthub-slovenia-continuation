/**
 * Idempotency-key support for mutating opportunity endpoints.
 *
 * Clients may send an `Idempotency-Key` header on unsafe requests (create,
 * transition). If the same (scope, key, user) triple is replayed:
 *   - with an identical request body, the original response is returned
 *     verbatim and no new work is performed;
 *   - with a different request body, the request is rejected with 422 —
 *     reusing a key for a different operation is a client bug, not a retry.
 *
 * Storage is transactional: the key is reserved with an INSERT inside the
 * same DB transaction as the business logic, so a crash between "record
 * intent" and "commit" cannot leave an orphaned key — either both commit or
 * neither does.
 */

const crypto = require("crypto");

const MAX_KEY_LENGTH = 255;

function hashRequest(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || null)).digest("hex");
}

function extractKey(req) {
  const header = req.get ? req.get("Idempotency-Key") : req.headers["idempotency-key"];
  if (typeof header !== "string") {
    return null;
  }
  const trimmed = header.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
    return null;
  }
  return trimmed;
}

/**
 * Looks up a stored response for (scope, key, userId). Returns:
 *  - { replay: true, status, body } if an identical request was already handled
 *  - { replay: false, conflict: true } if the key was reused with a different payload
 *  - { replay: false, conflict: false } if this is a fresh key (or no key supplied)
 */
async function checkIdempotency(client, { scope, key, userId, requestBody }) {
  if (!key) {
    return { replay: false, conflict: false, key: null };
  }

  const requestHash = hashRequest(requestBody);
  const { rows } = await client.query(
    `SELECT response_status, response_body, request_hash
     FROM idempotency_key
     WHERE scope = $1 AND idempotency_key = $2 AND user_id = $3`,
    [scope, key, userId]
  );

  if (rows.length === 0) {
    return { replay: false, conflict: false, key, requestHash };
  }

  const existing = rows[0];
  if (existing.request_hash !== requestHash) {
    return { replay: false, conflict: true, key, requestHash };
  }

  return {
    replay: true,
    status: existing.response_status,
    body: existing.response_body,
  };
}

/**
 * Persists the response for a handled idempotency key. Must be called within
 * the same transaction as the mutation it guards, before COMMIT.
 */
async function storeIdempotentResponse(client, { scope, key, userId, requestHash, status, body }) {
  if (!key) {
    return;
  }
  await client.query(
    `INSERT INTO idempotency_key (scope, idempotency_key, user_id, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (scope, idempotency_key, user_id) DO NOTHING`,
    [scope, key, userId, requestHash, status, JSON.stringify(body)]
  );
}

module.exports = {
  extractKey,
  hashRequest,
  checkIdempotency,
  storeIdempotentResponse,
};
