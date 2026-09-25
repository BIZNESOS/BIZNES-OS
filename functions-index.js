/**
 * Ledgerly — Firebase Cloud Functions
 * Deploy with: firebase deploy --only functions
 *
 * The Telegram Bot Token is NEVER placed in this file or in index.html.
 * Set it once via Secret Manager:
 *    firebase functions:secrets:set TELEGRAM_BOT_TOKEN
 * and it is injected into this function's environment at runtime only.
 */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
admin.initializeApp();
const db = admin.firestore();

const TELEGRAM_BOT_TOKEN = functions.config().telegram?.bot_token || process.env.TELEGRAM_BOT_TOKEN;

/* ------------------------------------------------------------
   1) requestTelegramVerification
      - generates a one-time 6-digit code
      - stores it in telegram_verification/{login} with expiry + attempts=0
      - sends it via Telegram Bot API to the given chat/username
   ------------------------------------------------------------ */
exports.requestTelegramVerification = functions.https.onCall(async (data, context) => {
  const { login, telegramUsername } = data;
  if (!login || !telegramUsername) {
    throw new functions.https.HttpsError("invalid-argument", "login and telegramUsername are required");
  }

  const settingsDoc = await db.collection("settings").doc("telegram").get();
  const settings = settingsDoc.exists ? settingsDoc.data() : { codeLifetime: 10, maxAttempts: 5, verificationEnabled: true };
  if (settings.verificationEnabled === false) {
    throw new functions.https.HttpsError("failed-precondition", "Telegram verification is disabled");
  }

  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + (settings.codeLifetime || 10) * 60 * 1000);

  await db.collection("telegram_verification").doc(login).set({
    code,                     // never exposed to the frontend — this whole collection is locked in firestore.rules
    telegramUsername,
    attempts: 0,
    maxAttempts: settings.maxAttempts || 5,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    consumed: false,
  });

  // Resolve a chat id: in production you'd look up a stored chat_id captured
  // when the user pressed /start on the bot. This example sends directly to
  // a @username via the Bot API's sendMessage (requires the user to have
  // started a conversation with the bot at least once).
  const text = `Ledgerly verification code: ${code}\nExpires in ${settings.codeLifetime || 10} minutes.`;
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramUsername, text }),
  });
  const result = await resp.json();
  if (!result.ok) {
    throw new functions.https.HttpsError("internal", "Failed to send Telegram message: " + (result.description || "unknown error"));
  }
  return { sent: true };
});

/* ------------------------------------------------------------
   2) verifyTelegramCode
      - checks expiry + attempt limit server-side
      - marks the record consumed on success so it cannot be replayed
   ------------------------------------------------------------ */
exports.verifyTelegramCode = functions.https.onCall(async (data, context) => {
  const { login, code } = data;
  if (!login || !code) {
    throw new functions.https.HttpsError("invalid-argument", "login and code are required");
  }
  const ref = db.collection("telegram_verification").doc(login);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "No pending verification");
  const rec = snap.data();

  if (rec.consumed) throw new functions.https.HttpsError("failed-precondition", "Code already used");
  if (rec.expiresAt.toMillis() < Date.now()) throw new functions.https.HttpsError("deadline-exceeded", "Code expired");
  if (rec.attempts >= rec.maxAttempts) throw new functions.https.HttpsError("resource-exhausted", "Too many attempts");

  if (rec.code !== code) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
    return { valid: false };
  }
  await ref.update({ consumed: true });
  return { valid: true };
});

/* ------------------------------------------------------------
   3) setUserRole — admin-only, sets custom claim `admin: true/false`
      This is the ONLY way roles change; never trust a client Firestore
      write to grant admin rights (see firestore.rules).
   ------------------------------------------------------------ */
exports.setUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
  const { uid, role } = data;
  await admin.auth().setCustomUserClaims(uid, { admin: role === "admin" });
  await db.collection("users").doc(uid).update({ role });
  return { ok: true };
});

/* ------------------------------------------------------------
   4) testTelegramBot — admin-only connectivity check ("Test Telegram Bot" button)
   ------------------------------------------------------------ */
exports.testTelegramBot = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const result = await resp.json();
    return { ok: !!result.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ------------------------------------------------------------
   5) bootstrapFirstAdmin — one-time callable to grant the very first
      admin their custom claim (run once manually, then remove/restrict it).
      Do NOT ship this open in production — gate it behind a deploy-time
      secret or delete the function after first use.
   ------------------------------------------------------------ */
exports.bootstrapFirstAdmin = functions.https.onCall(async (data, context) => {
  const BOOTSTRAP_SECRET = functions.config().admin?.bootstrap_secret;
  if (!BOOTSTRAP_SECRET || data.secret !== BOOTSTRAP_SECRET) {
    throw new functions.https.HttpsError("permission-denied", "Invalid bootstrap secret");
  }
  await admin.auth().setCustomUserClaims(data.uid, { admin: true });
  await db.collection("users").doc(data.uid).update({ role: "admin" });
  return { ok: true };
});
