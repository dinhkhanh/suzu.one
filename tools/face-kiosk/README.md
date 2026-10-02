# SuZu face kiosk

> **Superseded by the kiosk inside SuZu One** (Attendance → Face kiosk, `/attendance/kiosk`): an
> HR administrator opens it on the wall tablet itself, faces are recognised in the tablet's browser
> and enrolled in the app. Nothing runs on the NAS. This container keeps working through the same
> device-push API until it is switched off.

Face check-in at the office door. A tablet on the wall shows the camera; a container on the
Synology NAS recognises the face, asks the person to turn their head (so a photo or a phone screen
cannot check in), and sends the punch to SuZu One. SuZu One files it like any time-clock punch:
same timesheet, same merge rules, same "whose ID is whose" page.

```
Tablet (browser, /kiosk) ──LAN, HTTPS──▶ NAS container (this folder) ──HTTPS + device token──▶ SuZu One
   camera + screen                         InsightFace buffalo_l (SCRFD + ArcFace)              /api/attendance/device/punches
                                           SQLite: faces as numbers, punch outbox                /api/attendance/device/roster
```

- **Nothing the camera sees is stored.** Frames are turned into numbers and dropped. Enrolment
  keeps one 512-number embedding per photo, never the photo. SuZu One receives only "employee
  code + time".
- **No punch is lost.** Punches wait in the outbox until SuZu One has them. If the internet is
  down they go later. SuZu One ignores a punch it already has, so resending is safe.
- **"Không phải tôi / Not me"** cancels a punch during the 8 seconds before it is sent.
- **Offboarding is automatic.** Someone unmapped from the device in SuZu One stops being
  recognised at the next roster sync (every 10 minutes). Their faces are deleted 30 days later.

## What you need

- The NAS: DS1522+ (or any Container Manager model). The image is about 2.5 GB and uses about
  1 GB of RAM.
- A tablet for the door: an Android tablet with Chrome, or an iPad. Mount it at face height, with
  the camera facing people as they come in, and keep it on its charger.
- Light from the front. A window behind the person makes faces dark.

## 1. In SuZu One

1. Go to **Chấm công → Máy chấm công** (Attendance → Time clocks) and add a device, for example
   "Face kiosk – cửa chính". It needs a mapping profile like every clock; any profile will do,
   because the kiosk sends its punches directly.
2. Open the device. Under **"Gán nhiều mã theo mã nhân viên" (Map many at once by employee
   code)**, map everyone who will use the kiosk. Use the employee code as the device ID too: one line per person, e.g.
   ```
   SZM-0004, SZM-0004
   SZM-0007, SZM-0007
   ```
3. Under **"Tự gửi lượt chấm" (Sends its own punches)**, press **Cấp mã (Issue token)**. Copy
   `SUZU_URL` and `SUZU_DEVICE_TOKEN`. The token is shown only once. If you lose it, issue a new
   one; the old one stops working.

## 2. On the NAS

1. Install **Container Manager** from the Package Center.
2. Copy this folder to the NAS as `/volume1/docker/face-kiosk` (File Station, or
   `git clone` and copy `tools/face-kiosk`).
3. Copy `.env.example` to `.env` in the same folder and fill it in. `.env` holds the secrets and
   is never committed:
   - `SUZU_DEVICE_TOKEN` from step 1.3;
   - `KIOSK_KEY` and `ADMIN_PASSWORD`: two different long random strings
     (`openssl rand -hex 32`).

   `SUZU_URL` and the other settings stay in `docker-compose.yml`.
4. **Container Manager → Project → Create**. Name it `face-kiosk`, set the path to
   `/volume1/docker/face-kiosk`, and choose "Use existing docker-compose.yml". The first build
   takes 10–15 minutes, because it downloads the face models into the image.
5. Check `http://<nas-ip>:8080/healthz`. It should answer `{"ok":true,…}`.

### HTTPS (the tablet's camera needs it)

Browsers open the camera only on HTTPS pages. Choose one option:

- **Recommended: DSM reverse proxy.**
  1. Control Panel → Login Portal → Advanced → Reverse Proxy → Create. Source:
     `HTTPS`, host `kiosk.<your-name>.synology.me`, port `443`. Destination: `HTTP`,
     `localhost`, `8080`.
  2. Control Panel → Security → Certificate: add a Let's Encrypt certificate for that name, then
     assign it to the reverse-proxy entry under "Settings".
  3. Make sure the name resolves to the NAS inside the office. If the router has no NAT loopback,
     add a local DNS record pointing it at the NAS's LAN IP.
  4. Don't forward port 443 on the router for this. The kiosk is meant for the LAN only.
- **Quick, for one dedicated Android tablet:** in Chrome open
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<nas-ip>:8080`, and
  relaunch Chrome.

## 3. Enrol people

1. On a computer, open `https://kiosk.<name>.synology.me/admin`. Enter any user name, with
   `ADMIN_PASSWORD` as the password.
2. Press **Đồng bộ danh sách (Sync roster)**. The people mapped in SuZu One appear.
3. For each person, press **Đăng ký ảnh (Enrol)**:
   - tick the consent box. Collect a signed consent form first: face data is sensitive personal
     data under Law 91/2025/QH15;
   - take the 5 photos while the person looks straight, then turns slightly. You can also upload
     clear photos.

   Aim for 3–5 faces per person, taken in the light at the door.
4. Someone the kiosk confuses with a colleague: enrol more photos of both, or raise
   `MATCH_THRESHOLD` (step 0.03).

## 4. The tablet

1. In the admin page, press **Link cho máy tính bảng (Tablet link)**. Open that link once on the
   tablet. It remembers its key, and the key never stays in the address bar.
2. Allow the camera, then "Add to Home screen" and open it from there (full screen).
3. Android: Settings → Display → Screen timeout: the longest setting, or use a kiosk app (for
   example Fully Kiosk Browser) to keep the screen on and lock the tablet to the page.

A check-in goes:
1. The person looks at the camera, and the screen shows their name.
2. They turn their head the way the arrow says. It takes about 2 seconds.
3. The screen shows "Đã chấm công lúc 08:42".

Within 60 seconds the same face shows the earlier time instead of punching again.

## Settings (docker-compose.yml)

| Variable | Default | |
|---|---|---|
| `MATCH_THRESHOLD` | 0.45 | Cosine similarity needed to name a face. Higher means stricter. |
| `MATCH_MARGIN` | 0.08 | How far the best person must lead the runner-up. |
| `LIVENESS` | 1 | The head-turn check. Turning it off lets a photo check in. |
| `LIVENESS_MIN_TURN` | 0.12 | How far the head must turn (about 15°). |
| `DET_SIZE` | 320 | Detector input size. 320 is quick; use 640 if faces are far from the tablet. |
| `MIN_FACE_PX` | 110 | Smaller faces are asked to come closer. |
| `COOLDOWN_SECONDS` | 60 | |
| `UNDO_SECONDS` | 8 | |
| `PURGE_INACTIVE_DAYS` | 30 | |
| `KIOSK_LANG` | vi | `vi` or `en`. |

## Running it

- **Backups:** the `data/` folder holds the faces and the punch log. Include
  `/volume1/docker/face-kiosk/data` in Hyper Backup.
- **Updates:** copy the new folder over, keeping `data/` and your `.env`. Then
  Container Manager → Project → face-kiosk → Build.
- **Kiosk health:** SuZu One's device page shows "liên lạc gần nhất (last called in)". The kiosk
  calls in at least every 5 minutes, so a time much older than that means it is down.
- **Tests:** `docker build --target test .`
- **Clock:** punches carry the NAS's time. Keep NTP on (Control Panel → Regional Options). SuZu One
  refuses punches stamped more than an hour in the future.
