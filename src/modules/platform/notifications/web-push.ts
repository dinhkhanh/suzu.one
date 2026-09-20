// The Web Push protocol with node:crypto only: message encryption (RFC 8291, "aes128gcm" content
// coding of RFC 8188) and the VAPID authorization header (RFC 8292). No I/O here — `push.ts`
// does the HTTP request. The encryption is tested against the RFC's own example.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

export type PushKeys = { /** The browser's P-256 public key, base64url (65 bytes uncompressed). */ p256dh: string; /** The subscription's auth secret, base64url (16 bytes). */ auth: string };

const b64url = (data: Buffer) => data.toString("base64url");
const fromB64url = (text: string) => Buffer.from(text, "base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

const RECORD_SIZE = 4096;
/** One record carries the whole message: 4096 − 16 (tag) − 1 (delimiter) − 86 (header) leaves this much. */
export const MAX_PAYLOAD_BYTES = 3993;

/**
 * Encrypts `plaintext` for one subscription. `fixed` exists for the RFC test vector only: real
 * calls draw a fresh salt and a fresh sender key every time.
 */
export function encryptPayload(plaintext: Buffer, keys: PushKeys, fixed?: { salt: Buffer; senderPrivateKey: Buffer }): Buffer {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error("push payload too large");
  const receiverPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || authSecret.length !== 16) throw new Error("malformed push subscription keys");

  const sender = createECDH("prime256v1");
  if (fixed) sender.setPrivateKey(fixed.senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiverPublic);
  const salt = fixed?.salt ?? randomBytes(16);

  // RFC 8291 §3.4: the input keying material binds both public keys and the auth secret.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic]);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  // RFC 8188 §2.2–2.3: content-encryption key and nonce for the first (only) record.
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last record.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, body]);
}

export type VapidConfig = { /** base64url, 65 bytes uncompressed P-256 point. */ publicKey: string; /** base64url, the 32-byte private scalar. */ privateKey: string; /** "mailto:…" or an https URL the push service can reach the operator at. */ subject: string };

/** `Authorization` for one push service origin: a short-lived ES256 token signed with the VAPID key (RFC 8292). */
export function vapidAuthorization(endpoint: string, config: VapidConfig, now: Date = new Date()): string {
  const publicKey = fromB64url(config.publicKey);
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("malformed VAPID public key");
  const key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: config.privateKey, x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)) } });
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: config.subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${config.publicKey}`;
}

/** A fresh VAPID key pair, for `pnpm` scripts and tests. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}
