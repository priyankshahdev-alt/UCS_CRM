# Aadhaar Scan — local OCR

A self-hosted OCR service and camera scanner. The web page is an Aadhaar scanner; the same API also reads **UDID cards** and **disability certificates** for the beneficiary app.

For an Aadhaar card, the page extracts:

- **Aadhaar number** (formatted `XXXX XXXX XXXX`, Verhoeff-checksum checked)
- **Name**
- **Date of birth**
- **Gender**
- **Address** with PIN code

The photo is read locally by [Indra OCR](https://github.com/datalab-to/indra), turned into Markdown, and then the fields are extracted. Nothing is uploaded to a cloud OCR service.

Scan the **front** first, then the **back**; the results merge. The raw Markdown lives in the **OCR** tab so every field can be checked against the source.

---

## Run it

Requires **Python 3.10+**.

### Windows (one click)

Double-click `start.bat`. It creates the virtual environment, installs the dependencies, and starts the server.

### Windows / macOS / Linux (manual)

```bash
cd ocr
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
python server.py
```

Open **http://localhost:8010**.

The first start downloads the Indra OCR models (about 100 MB with math disabled, which is the default here). The status chip in the top-right shows **Loading OCR** and then **OCR ready**. The first scan is slower while the engine warms up.

> The camera API requires a secure context. `http://localhost` counts as secure; a plain `http://192.168.x.x` address does not. For phone testing, use an HTTPS tunnel (for example `cloudflared tunnel --url http://localhost:8010`) or deploy the server behind TLS. Uploading a photo still works over plain HTTP.

---

## Deploy it

The service ships as a Docker image (`ocr/Dockerfile`). The Indra weights are downloaded **at build
time**, so a cold start needs no Hugging Face access and the running container needs no outbound
network. The image is roughly 600 MB.

### Render (blueprint)

The repository's root `render.yaml` already declares the OCR service (`ucs-ocr`):

1. Render Dashboard → **New → Blueprint** → pick this repository.
2. Render creates `ucs-openwa` and `ucs-ocr`. The OCR service builds from `ocr/` with
   `Dockerfile`, and Render generates an `OCR_API_KEY` for it.
3. Open the service's **Environment** tab and copy `OCR_API_KEY`.
4. On the Node backend (`backend/`) set:
   ```env
   INDRA_OCR_URL=https://ucs-ocr.onrender.com
   INDRA_OCR_KEY=<the generated OCR_API_KEY>
   ```
5. To use the browser scanner on the deployed URL, open
   `https://ucs-ocr.onrender.com/?key=<the generated OCR_API_KEY>` once. The page stores the key in
   an HttpOnly cookie and redirects to `/`, so the camera UI works without putting the key in JS.

**Plan sizes.** Indra OCR needs real RAM and CPU:

| Render plan | CPU / RAM | Verdict |
| --- | --- | --- |
| `free` | 0.1 CPU / 512 MB | Testing only. Sleeps after 15 min; cold start 1-3 min. |
| `0.5c-512mb` ($7/mo) | 0.5 CPU / 512 MB | Smallest sensible option, no sleep. |
| `1c-2g` ($25/mo) | 1 CPU / 2 GB | Comfortable for regular use. |

On the free plan, scans can take tens of seconds; if Render reports an out-of-memory restart, move
to `1c-2g`. A free-plan cold start (spin-up + model load) can also exceed the Node backend's default
90 s timeout, so raise it when the OCR service runs on the free plan:

```env
INDRA_OCR_TIMEOUT_MS=180000
```

### Keep the free instance awake (optional)

Render spins a Free web service down after 15 minutes without inbound traffic.
`ocr/deploy/keepalive/` is a Cloudflare Worker whose Cron Trigger pings `/api/status`
every 10 minutes (Workers Free includes 5 cron triggers per account; a run that only
waits on `fetch()` barely uses the 10 ms CPU budget).

```bash
cd ocr/deploy/keepalive
npm install
npx wrangler login
# edit TARGET_URL in wrangler.jsonc to the URL Render gave you
npx wrangler deploy
npx wrangler tail        # watch the keepalive results
```

Test it without waiting for the schedule: `npx wrangler dev --test-scheduled`, then open
`http://localhost:8787/ping`. To protect `/api/status` later, run
`npx wrangler secret put OCR_API_KEY` and the Worker will send it.

> **This does not make the free plan production-ready.** A free service kept awake 24/7 uses
> roughly 720-744 of the **750 free instance hours per workspace**, so `ucs-openwa` (also free)
> can exhaust the pool and Render suspends every free service until the next month. The keepalive
> is for demos and short testing windows; for an always-on OCR service use `0.5c-512mb` ($7/mo),
> which does not sleep at all.
>
> No-deploy alternative: point a free uptime monitor (UptimeRobot, cron-job.org) at
> `https://ucs-ocr.onrender.com/api/status` every 5-10 minutes.

### Run it at home with a free Cloudflare URL (no domain needed)

You can keep the OCR engine on your own PC and expose it with a Quick Tunnel — no port forwarding
and no domain:

```powershell
cd ocr
$env:OCR_API_KEY = "<a long random string>"
.\start.bat
```

In a second terminal:

```powershell
winget install --id Cloudflare.cloudflared --exact
cloudflared tunnel --url http://localhost:8010
```

The last command prints a random `https://*.trycloudflare.com` URL. That URL changes every time the
tunnel restarts. To get a **stable** URL without owning a domain, deploy the free Worker proxy in
`ocr/deploy/proxy/`:

```bash
cd ocr/deploy/proxy
npm install
npx wrangler login
# put the current *.trycloudflare.com URL into TARGET_URL in wrangler.jsonc
npx wrangler deploy
```

Workers give you `https://ucs-ocr-proxy.<your-subdomain>.workers.dev`, which never changes. Set the
Node backend's `INDRA_OCR_URL` to that URL once. After a tunnel restart, paste the new
`*.trycloudflare.com` URL into `TARGET_URL` and run `npx wrangler deploy` again — the public URL
stays identical. The proxy forwards cookies and rewrites the `?key=` bootstrap redirect so the
browser scanner keeps working.

To avoid the manual update entirely, run `.\start-local.ps1 -ApiKey "<key>"` from this folder after
each restart. It starts the OCR service and tunnel, reads the new tunnel URL, patches
`wrangler.jsonc`, and redeploys the proxy in one step.

Your PC must stay awake and both terminals must keep running. Cloudflare Tunnel requires no inbound
firewall rules. A permanent custom hostname like `ocr.yourdomain.com` needs a domain whose DNS is
managed by Cloudflare (or a Business/Enterprise partial setup).

### Any Docker host

```bash
cd ocr
docker build -t ucs-ocr .
docker run --rm -p 8010:8010 -e OCR_API_KEY=change-me ucs-ocr
```

The container listens on `0.0.0.0:8010` (Render's `PORT` is honoured automatically). Put TLS and
access control in front of it if it is public — the API key is the only gate.

> **Cloudflare Workers / pywrangler will not run this service.** Python Workers execute Pyodide in
> a 128 MB isolate and cannot load `onnxruntime` or `opencv-python-headless` (no PyEmscripten
> wheels), and the model weights alone exceed the bundle limit. Use a container host such as Render,
> or Cloudflare **Containers** on the paid Workers plan.

---

## How it works

```
browser camera / upload
        │  POST /api/scan (multipart image + side)
        ▼
FastAPI (server.py)
        │  grayscale image
        ▼
Indra OCR (indra-ocr, CPU ONNX) ──► page.markdown / page.text / page.lines
        │
        ▼
aadhaar.py ──► name, aadhaar, dob, gender, address, pincode
        │
        ▼
JSON back to the UI ──► merged with the other side, editable/copyable
```

- **Indra OCR** is a CPU-first OCR pipeline from Datalab. It returns Markdown, plain text, line boxes, layout blocks and confidence. This project uses the `indra-ocr` Python package (the CLI and library from the repo you linked).
- **Extraction** works on the OCR lines, so position helps: the name is often the line above the DOB, and the address is the block after an `Address` / `पता` label ending in a 6-digit PIN.
- **Document profiles.** `doc_type=aadhaar` uses the strict Aadhaar parser (Verhoeff checksum, Hindi labels, front/back merge). `doc_type=udid` reads the 18-character UDID (2 letters + 14–18 digits, or 18 digits), disability percentage and disability type. `doc_type=disability` reads the certificate number, percentage and type. `doc_type=generic` returns the common fields plus any identifier it can find. `doc_type=auto` detects the type from the text.
- **No cloud OCR.** The Aadhaar/UDID/disability path runs only on Indra. The old Gemini/OCR.space fallback is not part of this service.
- **Validation.** A 12-digit Aadhaar number is checked with the Verhoeff algorithm. A failing checksum is surfaced in the UI with a warning instead of being silently accepted.
- **No persistence.** Uploads are decoded and sent through the model in memory. There is no database and no analytics. (The web framework may briefly spool a large request body to an operating-system temp file; it is discarded when the request ends.)

---

## Project layout

```
ocr/
├─ server.py          FastAPI server, model lifetime, image decoding, JSON API
├─ aadhaar.py         OCR-line → Aadhaar field extraction + Verhoeff checksum
├─ documents.py       UDID / disability certificate / generic document fields
├─ requirements.txt
├─ start.bat          Windows helper: venv + install + run
├─ static/
│  ├─ index.html      Aadhaar camera / upload UI, result panel, About dialog
│  ├─ styles.css
│  ├─ app.js          camera, merge, copy/export, tabs
│  └─ favicon.svg
└─ tests/
   ├─ test_aadhaar.py
   └─ test_documents.py
```

Run the parser tests with:

```bash
python -m unittest discover -s tests -t . -v
```

---

## API

Two entry points use the same extraction pipeline.

### Multipart (browser / curl)

`POST /api/scan` - `multipart/form-data`

| field | type | notes |
| --- | --- | --- |
| `image` | file | JPG, PNG, WebP, BMP or TIFF |
| `side` | text | `auto`, `front` or `back` (a hint; the detected side wins) |
| `doc_type` | text | `aadhaar` (default), `udid`, `disability`, `generic`, `auto` |

```bash
curl -X POST http://localhost:8010/api/scan \
  -F "image=@card-front.jpg" \
  -F "side=front" \
  -F "doc_type=aadhaar"
```

### JSON / base64 (Node backend, mobile apps)

`POST /api/scan-base64` - `application/json`

```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ...",
  "side": "all",
  "doc_type": "udid"
}
```

`image` accepts raw base64 or a data URL. The response is the same shape as the
multipart endpoint. This is what `backend/src/utils/aadhaarPhotoOcr.js` calls.

### Document types

| `doc_type` | fields |
| --- | --- |
| `aadhaar` | `aadhaar`, `name`, `dob`, `gender`, `address`, `pincode` + checksum |
| `udid` | common fields, `udid_number`, `certificate_number`, `disability_percentage`, `disability_type` |
| `disability` | common fields, `certificate_number`, `udid_number`, `disability_percentage`, `disability_type` |
| `generic` | common fields plus any identifier found |
| `auto` | detects Aadhaar / UDID / disability from the OCR text |

Response (trimmed, Aadhaar front):

```json
{
  "ok": true,
  "doc_type": "aadhaar",
  "side": "front",
  "fields": {
    "aadhaar": { "value": "4821 9376 5049", "confidence": 0.99 },
    "name": { "value": "Ravi Kumar Sharma", "confidence": 0.72 },
    "dob": { "value": "14/08/1991", "confidence": 0.92 },
    "gender": { "value": "Male", "confidence": 0.9 },
    "address": { "value": null, "confidence": 0 },
    "pincode": { "value": null, "confidence": 0 }
  },
  "checks": { "aadhaar_valid": true },
  "warnings": ["Address not found - scan the back of the card."],
  "markdown": "## भारत सरकार / Government of India\n\n...",
  "text": "...",
  "meta": { "engine": "indra-ocr", "doc_type": "aadhaar", "elapsed_ms": 1840, "lines": 9 }
}
```

UDID and disability responses add:

```json
"udid_number": { "value": "MH1234567890123456", "confidence": 0.92 },
"certificate_number": { "value": "DL/2020/12345", "confidence": 0.9 },
"disability_percentage": { "value": "60", "confidence": 0.92 },
"disability_type": { "value": "Visual Impairment", "confidence": 0.85 }
```

The Python service also returns `text`, `markdown`, line/layout metadata and
warnings, so a caller can show the raw OCR when a field is uncertain.

### API key

Set `OCR_API_KEY` on the OCR service when it is reachable beyond the machine:

```bash
OCR_API_KEY="long-random-value" python server.py
```

Requests from `127.0.0.1` / `::1` are allowed without the key. Every other caller
must send:

```http
X-OCR-Key: long-random-value
```

The browser UI and the Node backend on the same machine are loopback and need no
key. If the Node backend runs on a different machine, set the same value as
`INDRA_OCR_KEY` there.

`GET /api/status` returns the engine state (`idle`, `loading`, `ready`, `error`),
the Indra version, `doc_types`, and whether demo mode / the API key are active.

### Beneficiary app integration

- The Node backend calls this service from `backend/src/utils/aadhaarPhotoOcr.js`.
  It reads `INDRA_OCR_URL` (default `http://127.0.0.1:8010`) and optionally
  `INDRA_OCR_KEY`.
- Existing route: `POST /api/beneficiaries/aadhaar/parse-photo`.
- Generic route: `POST /api/beneficiaries/documents/parse-photo` with
  `{ image, side, doc_type }`. It returns the flat fields the Flutter app uses:
  `name`, `dob` (YYYY-MM-DD), `gender`, `aadhaar_number`, `address_line_1`,
  `pincode`, `udid_number`, `certificate_number`, `disability_percentage`,
  `disability_type`.
- The add-beneficiary flow uses the generic route for Aadhaar, UDID and
  disability certificate scans. The edit flow keeps the Aadhaar route.
- There is no ML Kit, Gemini or OCR.space fallback in these paths: start the
  OCR service or the app shows the error.

---

## Configuration

Environment variables, all optional:

| variable | default | purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | bind address; use `0.0.0.0` for LAN testing |
| `PORT` | `8010` | server port |
| `INDRA_THREADS` | half the CPU cores | ONNX threads |
| `INDRA_MATH` | `0` | set to `1` to load Indra's math readers (larger download; not needed for cards) |
| `OCR_PRELOAD` | `1` | set to `0` to load models on the first scan instead of at startup |
| `OCR_MAX_UPLOAD_MB` | `15` | upload limit |
| `OCR_MAX_IMAGE_SIDE` | `3000` | images are downscaled to this longest side before OCR |
| `OCR_MOCK` | `0` | set to `1` for a UI demo with canned data (no models, no OCR) |
| `OCR_API_KEY` | unset | require `X-OCR-Key` from non-loopback callers |
| `INDRA_OCR_MODEL_DIR` | model cache | point at a local model folder |

Demo mode without downloading models:

```bash
# Windows PowerShell
$env:OCR_MOCK="1"; .venv\Scripts\python.exe server.py
```

---

## Privacy and scope

- Images are processed by a local Python process. The only network access is the one-time model download from Hugging Face.
- This is an **unofficial** tool. It is not affiliated with UIDAI and does not verify identity, signature, or card authenticity. It extracts the text that is printed on the card.
- Use it only on documents you are allowed to handle.
- **The server has no authentication.** It binds to `127.0.0.1` by default for a reason. If you set `HOST=0.0.0.0`, keep it on a trusted network or put your own auth and TLS in front of it. Do not expose it directly to the internet.
- Indra OCR's **code** is Apache 2.0; its **model weights** use a modified OpenRAIL-M license (free for research, personal use, and startups under $5M funding/revenue, with restrictions on competing with Datalab's API). Check the [model license](https://huggingface.co/datalab-to/indra-ocr/blob/main/LICENSE) before commercial use.

---

## Troubleshooting

**“Engine offline” / the model download failed.** Check the server console. The model download needs network access on the first run. Once cached, it works offline. Retry by restarting the server.

**The camera does not open.** The page must be on `localhost` or HTTPS. Allow camera permission in the address bar. If another app is using the camera, close it. Upload a photo instead.

**The fields are wrong or missing.** Fill the frame with the card, avoid glare and shadows, hold it flat, and use the rear camera if possible. Scan both sides. The number can be checked against the card if the checksum warning appears. Indra is built for clean print; faint or damaged cards are harder.

**No text found.** The image may be too dark, too blurry, or mostly background. Retake it closer.

**Windows note.** Indra officially tests Linux and macOS. The package is pure Python + ONNX Runtime and works on Windows in this setup, but if you hit a platform-specific issue, run the same two files on Linux/macOS.
