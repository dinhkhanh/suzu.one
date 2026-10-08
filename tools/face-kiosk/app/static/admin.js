// The admin page: status, roster, enrolment and the punch log. Talks to /api/admin/* with the
// browser's Basic credentials, which it already holds from opening /admin.
"use strict";

const $ = (id) => document.getElementById(id);
const PROBLEMS = {
  no_face: "không thấy khuôn mặt · no face found",
  several_faces: "có nhiều khuôn mặt · more than one face",
  face_unclear: "khuôn mặt mờ hoặc quá nhỏ · face blurred or too small",
  not_an_image: "không phải ảnh · not an image",
  looks_like_someone_else: "giống một người khác đã đăng ký · looks like someone already enrolled",
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" }) : "—");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "class") node.className = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value);
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child ?? "")));
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { body });
  return body;
}

function card(label, value, small = false) {
  return el("div", { class: "card" }, el("div", { class: "k" }, label), el("div", { class: small ? "v small" : "v" }, value));
}

async function loadStatus() {
  const s = await api("/api/admin/status");
  const st = s.status || {};
  $("status").replaceChildren(
    card("SuZu One", s.suzuConfigured ? `${st.device_name || "—"} · ${s.suzuUrl}` : "Chưa cấu hình · Not configured", true),
    card("Đã đăng ký · Enrolled faces", s.enrolled),
    card("Chờ gửi · Waiting to send", s.pending),
    card("Gửi gần nhất · Last push", st.last_push || "—", true),
    card("Danh sách · Last roster sync", st.last_roster || "—", true),
    card("Lỗi gần nhất · Last error", st.last_error || "—", true),
    card("Mô hình · Model", `${s.modelPack} · ngưỡng ${s.threshold} · liveness ${s.liveness ? "on" : "off"}`, true),
  );
}

async function loadPeople() {
  const people = await api("/api/admin/people");
  $("people").replaceChildren(
    ...people.map((p) =>
      el(
        "tr",
        {},
        el("td", {}, el("code", {}, p.user_id)),
        el(
          "td",
          {},
          p.full_name,
          p.employee_code && p.employee_code !== p.user_id ? el("span", { class: "muted" }, ` · ${p.employee_code}`) : "",
          p.active ? "" : el("span", { class: "pill warn", style: "margin-left:6px" }, "không còn trên SuZu · off the roster"),
        ),
        el("td", {}, el("span", { class: p.faces >= 3 ? "pill ok" : "pill bad" }, p.faces)),
        el("td", {}, p.consent_at ? fmt(p.consent_at) : "—"),
        el(
          "td",
          { class: "row" },
          el("button", { onclick: () => openEnrol(p) }, "Đăng ký ảnh · Enrol"),
          p.faces ? el("button", { class: "danger", onclick: () => clearFaces(p) }, "Xoá ảnh · Delete faces") : "",
          p.source === "manual" ? el("button", { class: "danger", onclick: () => removePerson(p) }, "Xoá · Remove") : "",
        ),
      ),
    ),
  );
  if (people.length === 0)
    $("people").replaceChildren(el("tr", {}, el("td", { colspan: 5, class: "muted" }, "Chưa có ai. Gán người cho máy này trên SuZu One rồi bấm Đồng bộ. · Nobody yet: map people to this device in SuZu One, then Sync.")));
}

async function loadEvents() {
  const events = await api("/api/admin/events");
  $("events").replaceChildren(
    ...events.map((e) => {
      const status = e.cancelled
        ? el("span", { class: "pill" }, "đã huỷ · cancelled")
        : e.sent_at
          ? el("span", { class: "pill ok" }, "đã gửi · sent")
          : e.failed_at
            ? el("span", { class: "pill bad", title: e.error || "" }, "bị từ chối · refused")
            : el("span", { class: "pill warn", title: e.error || "" }, e.error ? `đang thử lại · retrying (${e.error})` : "đang chờ · waiting");
      return el(
        "tr",
        {},
        el("td", {}, fmt(e.at)),
        el("td", {}, e.full_name, el("span", { class: "muted" }, ` · ${e.user_id}`)),
        el("td", {}, status),
        el("td", {}, e.failed_at ? el("button", { onclick: () => retry(e.id) }, "Gửi lại · Retry") : ""),
      );
    }),
  );
}

const refresh = () => Promise.all([loadStatus(), loadPeople(), loadEvents()]).catch((error) => console.error(error));

async function clearFaces(p) {
  if (!confirm(`Xoá toàn bộ ảnh khuôn mặt của ${p.full_name}? · Delete all of ${p.full_name}'s faces?`)) return;
  await api(`/api/admin/people/${encodeURIComponent(p.user_id)}/faces`, { method: "DELETE" });
  refresh();
}

async function removePerson(p) {
  if (!confirm(`Xoá ${p.full_name} khỏi máy? · Remove ${p.full_name} from the kiosk?`)) return;
  await api(`/api/admin/people/${encodeURIComponent(p.user_id)}`, { method: "DELETE" });
  refresh();
}

async function retry(id) {
  await api(`/api/admin/events/${id}/retry`, { method: "POST" });
  setTimeout(refresh, 1500);
}

$("sync").addEventListener("click", async () => {
  $("sync").disabled = true;
  try {
    const r = await api("/api/admin/sync", { method: "POST" });
    alert(`Đã đồng bộ ${r.people} người · Synced ${r.people} people`);
  } catch (error) {
    alert(error.message === "not_configured" ? "Đặt SUZU_URL và SUZU_DEVICE_TOKEN trong docker-compose.yml · Set SUZU_URL and SUZU_DEVICE_TOKEN" : `Lỗi · Failed: ${error.body?.status?.last_error || error.message}`);
  } finally {
    $("sync").disabled = false;
    refresh();
  }
});

$("link").addEventListener("click", async () => {
  const { url } = await api("/api/admin/kiosk-link", { method: "POST" });
  $("link-out").replaceChildren(el("code", {}, url));
  navigator.clipboard?.writeText(url).catch(() => {});
});

$("manual").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/admin/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
  event.target.reset();
  refresh();
});

// ── Enrolment ────────────────────────────────────────────────────────────────────────────

let current = null;
let stream = null;

async function openEnrol(p) {
  current = p;
  $("enrol-title").textContent = `${p.full_name} · ${p.user_id}`;
  $("consent").checked = !!p.consent_at;
  $("enrol-result").textContent = "";
  $("enrol-problems").replaceChildren();
  $("enrol").showModal();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false });
    $("enrol-video").srcObject = stream;
  } catch {
    $("enrol-result").textContent = "Không mở được camera (cần HTTPS); hãy tải ảnh lên. · No camera (HTTPS needed); upload photos instead.";
  }
}

$("enrol").addEventListener("close", () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  refresh();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snapshot() {
  const video = $("enrol-video");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function send(files) {
  if (!$("consent").checked) {
    $("enrol-result").textContent = "Cần xác nhận văn bản đồng ý trước. · Confirm the consent form first.";
    return;
  }
  const form = new FormData();
  files.forEach((file, index) => form.append("photos", file, file.name || `photo-${index + 1}.jpg`));
  form.append("consent", "true");
  $("enrol-result").textContent = "Đang xử lý… · Processing…";
  try {
    const result = await api(`/api/admin/people/${encodeURIComponent(current.user_id)}/faces`, { method: "POST", body: form });
    $("enrol-result").textContent = `Đã thêm ${result.added} ảnh · Added ${result.added} faces`;
    $("enrol-problems").replaceChildren(...result.problems.map((p) => el("li", {}, `${p.photo}: ${PROBLEMS[p.problem] || p.problem}${p.who ? ` (${p.who})` : ""}`)));
  } catch (error) {
    $("enrol-result").textContent = error.message === "consent_required" ? "Cần văn bản đồng ý. · Consent required." : `Lỗi · Failed: ${error.message}`;
  }
}

$("capture").addEventListener("click", async () => {
  if (!stream) return;
  $("capture").disabled = true;
  const shots = [];
  for (let index = 0; index < 5; index++) {
    $("enrol-result").textContent = `Ảnh ${index + 1}/5 · Photo ${index + 1}/5`;
    await sleep(700);
    shots.push(new File([await snapshot()], `camera-${index + 1}.jpg`, { type: "image/jpeg" }));
  }
  $("capture").disabled = false;
  send(shots);
});

$("upload-btn").addEventListener("click", () => $("upload").click());
$("upload").addEventListener("change", (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) send(files);
});

refresh();
setInterval(() => Promise.all([loadStatus(), loadEvents()]).catch(() => {}), 10000);
