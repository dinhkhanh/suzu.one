// The tablet at the door. Sends a frame, shows what the service answers, sends the next one.
// Opened once with /kiosk#key=…&id=…, which it remembers; the key never sits in the address bar.
"use strict";

const TEXT = {
  vi: {
    idle: ["Xin chào", "Nhìn vào camera để chấm công"],
    closer: ["Lại gần hơn một chút", "Đưa khuôn mặt vào khung"],
    looking: ["Đang nhận diện…", ""],
    unknown: ["Chưa nhận ra bạn", "Hãy nhờ HR đăng ký khuôn mặt, hoặc chấm công trên ứng dụng"],
    challenge: (name, dir) => [`${name}, quay đầu sang ${dir === "left" ? "trái" : "phải"}`, dir === "left" ? "←" : "→"],
    done: (name, time) => [`Xin chào, ${name}`, `Đã chấm công lúc ${time}`],
    repeat: (name, time) => [name, `Bạn đã chấm công lúc ${time}`],
    failed: { timeout: "Hết thời gian, thử lại nhé", wrong_way: "Quay ngược hướng rồi, thử lại nhé", changed: "Mỗi lần một người thôi nhé" },
    failedTitle: "Chưa xong",
    undo: "Không phải tôi",
    undone: ["Đã huỷ lượt chấm", "Thử lại khi bạn sẵn sàng"],
    offline: "Mất kết nối với máy chủ chấm công. Đang thử lại…",
    camera: "Không mở được camera. Trang này cần HTTPS và quyền dùng camera.",
    setup: "Máy chưa được cài đặt. Mở đường link từ trang quản trị (/admin) trên máy tính bảng này.",
  },
  en: {
    idle: ["Hello", "Look at the camera to check in"],
    closer: ["Come a little closer", "Put your face inside the frame"],
    looking: ["Recognising…", ""],
    unknown: ["We don't recognise you yet", "Ask HR to enrol your face, or check in on the app"],
    challenge: (name, dir) => [`${name}, turn your head ${dir}`, dir === "left" ? "←" : "→"],
    done: (name, time) => [`Hello, ${name}`, `Checked in at ${time}`],
    repeat: (name, time) => [name, `You checked in at ${time}`],
    failed: { timeout: "Time's up, try again", wrong_way: "Other way, try again", changed: "One person at a time, please" },
    failedTitle: "Not quite",
    undo: "Not me",
    undone: ["Check-in cancelled", "Try again when you're ready"],
    offline: "Lost the connection to the check-in server. Retrying…",
    camera: "Could not open the camera. This page needs HTTPS and camera permission.",
    setup: "This kiosk is not set up. Open the link from the admin page (/admin) on this tablet.",
  },
};

const $ = (id) => document.getElementById(id);
const store = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

// The setup link carries the key in the fragment, which never reaches a server log.
const params = new URLSearchParams(location.hash.slice(1));
if (params.get("key")) {
  store.set("kioskKey", params.get("key"));
  if (params.get("id")) store.set("kioskId", params.get("id"));
  history.replaceState(null, "", location.pathname);
}
const key = store.get("kioskKey");
const kioskId = store.get("kioskId") || "door";
let t = TEXT.vi;
let undoSeconds = 8;
let heldUntil = 0;

const video = $("video");
const canvas = document.createElement("canvas");
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(t === TEXT.vi ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit" });

function tick() {
  const now = new Date();
  const locale = t === TEXT.vi ? "vi-VN" : "en-GB";
  $("time").textContent = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}
setInterval(tick, 1000);

function setup(message) {
  $("setup").hidden = false;
  $("setup-text").textContent = message;
}

function show(state, title, sub, arrow = false) {
  $("kiosk").dataset.state = state;
  $("title").textContent = title;
  const subEl = $("sub");
  subEl.textContent = sub;
  subEl.className = arrow ? "sub arrow" : "sub";
}

let undoTimer = 0;
function render(view) {
  const undo = $("undo");
  if (view.state !== "done") {
    undo.hidden = true;
    clearTimeout(undoTimer);
  }
  switch (view.state) {
    case "challenge": {
      const [title, arrow] = t.challenge(view.name, view.direction);
      return show("challenge", title, arrow, true);
    }
    case "done": {
      const [title, sub] = (view.repeat ? t.repeat : t.done)(view.name, fmtTime(view.at));
      show("done", title, sub);
      if (!view.repeat && undo.dataset.punch !== String(view.punchId)) {
        undo.dataset.punch = String(view.punchId);
        undo.textContent = t.undo;
        undo.hidden = false;
        clearTimeout(undoTimer);
        undoTimer = setTimeout(
          () => {
            undo.hidden = true;
          },
          Math.max(1, undoSeconds - 1) * 1000,
        );
      }
      return;
    }
    case "failed":
      return show("failed", t.failedTitle, t.failed[view.reason] || "");
    default: {
      const [title, sub] = t[view.state] || t.idle;
      return show(view.state, title, sub);
    }
  }
}

$("undo").addEventListener("click", async () => {
  const undo = $("undo");
  undo.hidden = true;
  try {
    const response = await fetch("/api/kiosk/undo", { method: "POST", headers: { "content-type": "application/json", "x-kiosk-key": key }, body: JSON.stringify({ punchId: Number(undo.dataset.punch) }) });
    const body = await response.json();
    if (body.cancelled) {
      show("failed", ...t.undone);
      heldUntil = Date.now() + 3000;
    }
  } catch {
    /* the punch stands; HR can correct it */
  }
});

async function frame() {
  const width = 640;
  const height = Math.round((video.videoHeight / video.videoWidth) * width) || 480;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

async function loop() {
  let wait = 120;
  try {
    if (video.readyState >= 2 && Date.now() >= heldUntil) {
      const body = await frame();
      const response = await fetch("/api/kiosk/frame", { method: "POST", headers: { "content-type": "image/jpeg", "x-kiosk-key": key, "x-kiosk-id": kioskId }, body });
      if (response.status === 401) return setup(t.setup);
      if (!response.ok) throw new Error(String(response.status));
      $("banner").classList.remove("show");
      render(await response.json());
    }
  } catch {
    $("banner").textContent = t.offline;
    $("banner").classList.add("show");
    wait = 2000;
  }
  setTimeout(loop, wait);
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch {
    /* not supported or not allowed */
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") keepAwake();
});

async function start() {
  if (!key) return setup(TEXT.vi.setup + "\n\n" + TEXT.en.setup);
  try {
    const response = await fetch("/api/kiosk/info", { headers: { "x-kiosk-key": key } });
    if (response.status === 401) return setup(TEXT.vi.setup + "\n\n" + TEXT.en.setup);
    const info = await response.json();
    t = TEXT[info.lang] || TEXT.vi;
    undoSeconds = info.undoSeconds || 8;
    document.documentElement.lang = info.lang || "vi";
  } catch {
    /* render offline below */
  }
  tick();
  render({ state: "idle" });
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch {
    return setup(t.camera);
  }
  keepAwake();
  loop();
}
start();
