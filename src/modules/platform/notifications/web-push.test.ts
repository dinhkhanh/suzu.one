import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPayload, generateVapidKeys, MAX_PAYLOAD_BYTES, vapidAuthorization } from "./web-push";

const b64 = (text: string) => Buffer.from(text, "base64url");

describe("encryptPayload", () => {
  // RFC 8291, Appendix A.
  const rfc = {
    plaintext: "When I grow up, I want to be a watermelon",
    senderPrivateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    receiverPrivateKey: b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
    body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  it("reproduces the RFC 8291 example byte for byte", () => {
    const body = encryptPayload(Buffer.from(rfc.plaintext), { p256dh: rfc.p256dh, auth: rfc.auth }, { salt: rfc.salt, senderPrivateKey: rfc.senderPrivateKey });
    expect(body.toString("base64url")).toBe(rfc.body);
  });

  it("produces a message the subscriber can decrypt, different every time", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.from("0123456789abcdef");
    const keys = { p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
    const message = Buffer.from(JSON.stringify({ title: "Đơn nghỉ phép chờ duyệt", link: "/approvals" }));
    const first = encryptPayload(message, keys);
    expect(encryptPayload(message, keys).equals(first)).toBe(false);

    // The receiving side of RFC 8291.
    const salt = first.subarray(0, 16);
    const senderPublic = first.subarray(21, 21 + first[20]);
    const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
    const ikm = hmac(hmac(auth, receiver.computeSecret(senderPublic)), Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), senderPublic, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
    const record = first.subarray(21 + first[20]);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(record.subarray(record.length - 16));
    const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
    expect(plain.at(-1)).toBe(2);
    expect(plain.subarray(0, -1).toString()).toBe(message.toString());
  });

  it("refuses malformed keys and oversized payloads", () => {
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: rfc.auth })).toThrow("malformed");
    expect(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), { p256dh: rfc.p256dh, auth: rfc.auth })).toThrow("too large");
  });
});

describe("vapidAuthorization", () => {
  it("signs a token for the push service's origin that verifies with the public key", () => {
    const keys = generateVapidKeys();
    const now = new Date("2026-09-20T00:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:it@suzu.one" }, now);
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(keys.publicKey);
    const [head, claims, signature] = token.split(".");
    expect(JSON.parse(b64(head).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b64(claims).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: now.getTime() / 1000 + 43_200, sub: "mailto:it@suzu.one" });
    const raw = b64(keys.publicKey);
    const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") } });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b64(signature))).toBe(true);
  });
});
