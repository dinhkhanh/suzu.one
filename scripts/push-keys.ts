// Prints a fresh VAPID key pair for web push: pnpm push:keys → paste into .env.local / Vercel.
import { generateVapidKeys } from "../src/modules/platform/notifications/web-push";

const keys = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
