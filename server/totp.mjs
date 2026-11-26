import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Generates a random Base32-encoded TOTP secret without padding.
 * @param {number} byteLength
 * @returns {string}
 */
export function generateBase32Secret(byteLength = 20) {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decodes a Base32 string (case-insensitive, ignores spaces/=) into a Buffer.
 * @param {string} encoded
 * @returns {Buffer}
 */
export function base32Decode(encoded) {
  const clean = String(encoded || "")
    .toUpperCase()
    .replace(/[\s=]+/g, "");
  let bits = 0;
  let value = 0;
  const out = [];

  for (let i = 0; i < clean.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error("Invalid Base32 character in TOTP secret.");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTotpForCounter(secretKeyBuf, counter, digits = 6) {
  const counterBuf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBuf.writeUInt32BE(high, 0);
  counterBuf.writeUInt32BE(low, 4);

  const hmac = crypto.createHmac("sha1", secretKeyBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, "0");
}

/**
 * Generates an RFC 6238 6-digit TOTP code using HMAC-SHA1.
 * @param {string} secret
 * @param {number} [timeMs]
 * @param {number} [stepSeconds]
 * @param {number} [digits]
 * @returns {string}
 */
export function generateTotpCode(secret, timeMs = Date.now(), stepSeconds = 30, digits = 6) {
  const keyBuf = base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  return generateTotpForCounter(keyBuf, counter, digits);
}

/**
 * Verifies an RFC 6238 TOTP code with timing-safe comparison and step-replay guard.
 * @param {string} secret
 * @param {string} code
 * @param {{ window?: number, timeMs?: number, lastUsedStep?: number|null, stepSeconds?: number, digits?: number }} [options]
 * @returns {{ valid: boolean, step?: number }}
 */
export function verifyTotpCode(
  secret,
  code,
  { window = 1, timeMs = Date.now(), lastUsedStep = null, stepSeconds = 30, digits = 6 } = {}
) {
  const normalizedCode = String(code || "").trim();
  if (!new RegExp(`^[0-9]{${digits}}$`).test(normalizedCode)) {
    return { valid: false };
  }

  let keyBuf;
  try {
    keyBuf = base32Decode(secret);
  } catch {
    return { valid: false };
  }

  const currentStep = Math.floor(timeMs / 1000 / stepSeconds);
  const providedBuf = Buffer.from(normalizedCode, "utf8");

  for (let delta = -window; delta <= window; delta += 1) {
    const step = currentStep + delta;
    if (step < 0) continue;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;

    const expected = generateTotpForCounter(keyBuf, step, digits);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: true, step };
    }
  }

  return { valid: false };
}

/**
 * Builds a standard otpauth:// TOTP provisioning URI.
 * @param {{ issuer: string, accountName: string, secret: string }} params
 * @returns {string}
 */
export function buildOtpAuthUri({ issuer, accountName, secret }) {
  const cleanIssuer = encodeURIComponent(issuer);
  const cleanAccount = encodeURIComponent(accountName);
  const label = `${cleanIssuer}:${cleanAccount}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
