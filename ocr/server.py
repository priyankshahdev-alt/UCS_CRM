"""Local Indra OCR backend for Aadhaar, UDID and disability documents.

Run:  python server.py
Open: http://localhost:8010
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import numpy as np
import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from documents import DOC_TYPES, extract_document, normalize_doc_type

# No photo leaves the machine, and no model-download telemetry is needed.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


def _load_local_env(path: Path) -> None:
    """Load KEY=VALUE pairs from ocr/.env without overriding the real env."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8", errors="surrogateescape").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export ") :].strip()
        value = value.strip().strip('"').strip("'")
        if " #" in value:
            value = value.split(" #", 1)[0].strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_local_env(BASE_DIR / ".env")

MAX_UPLOAD_BYTES = int(os.getenv("OCR_MAX_UPLOAD_MB", "15")) * 1024 * 1024
MAX_IMAGE_SIDE = int(os.getenv("OCR_MAX_IMAGE_SIDE", "3000"))
MOCK = os.getenv("OCR_MOCK", "0") == "1"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s")
log = logging.getLogger("aadhaar-ocr")


# --------------------------------------------------------------------------
# Demo data (used only with OCR_MOCK=1, for checking the UI without models)
# --------------------------------------------------------------------------

DEMO_FRONT = """## भारत सरकार / Government of India

**Name:** Ravi Kumar Sharma

**DOB:** 14/08/1991

**Gender:** Male

**Aadhaar:** 4821 9376 5049

आधार — आपकी पहचान का एक कार्ड
"""

DEMO_BACK = """**Address:** S/O Ram Kumar Sharma, House No. 24, Sector 12, Vasant Nagar,
Bengaluru, Karnataka - 560001

**Aadhaar:** 4821 9376 5049
"""

DEMO_UDID = """UNIQUE DISABILITY ID CARD
Government of India
Name: Ravi Kumar Sharma
UDID No: MH12 3456 7890 1234 56
DOB: 14/08/1991
Gender: Male
Address: S/O Ram Kumar Sharma, House No. 24, Sector 12, Vasant Nagar, Bengaluru, Karnataka - 560001
Disability: Locomotor 45%
"""

DEMO_DISABILITY = """GOVERNMENT OF INDIA
DISABILITY CERTIFICATE
Certificate No: DL/2020/12345
Name: Ravi Kumar Sharma
Date of Birth: 14/08/1991
Gender: Male
Address: S/O Ram Kumar Sharma, House No. 24, Sector 12, Vasant Nagar, Bengaluru, Karnataka - 560001
Disability Type: Visual Impairment
Disability Percentage: 60%
"""


class ScanPayload(BaseModel):
    image: str
    side: str = "auto"
    doc_type: str = "aadhaar"


# --------------------------------------------------------------------------
# OCR engine
# --------------------------------------------------------------------------


class ScanError(Exception):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _line_boxes(page: Any, scale_x: float, scale_y: float) -> list[dict[str, Any]]:
    """Convert Indra line boxes into image-pixel coordinates for UI overlays.

    Indra returns boxes as [x1, y1, x2, y2] for the image it actually read. The
    app displays the original photo, so boxes are scaled back up when the photo
    was resized before OCR.
    """
    boxes: list[dict[str, Any]] = []
    for index, line in enumerate(getattr(page, "lines", []) or []):
        text = str(getattr(line, "text", "") or "").strip()
        raw_box = getattr(line, "box", None)
        if not text or raw_box is None:
            continue
        try:
            coords = [float(value) for value in list(raw_box)[:4]]
        except (TypeError, ValueError):
            continue
        if len(coords) != 4:
            continue
        x1, y1, x2, y2 = coords
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        item: dict[str, Any] = {
            "index": index,
            "text": text,
            "box": [
                round(x1 * scale_x, 1),
                round(y1 * scale_y, 1),
                round(x2 * scale_x, 1),
                round(y2 * scale_y, 1),
            ],
        }
        conf = getattr(line, "conf", None)
        if isinstance(conf, (int, float)):
            item["conf"] = round(float(conf), 4)
        boxes.append(item)
    return boxes


def _mock_line_boxes(text: str) -> list[dict[str, Any]]:
    """Simple demo boxes so the scanner UI can be tested with OCR_MOCK=1."""
    result: list[dict[str, Any]] = []
    for index, value in enumerate(
        [line.strip() for line in text.splitlines() if line.strip()]
    ):
        width = min(760, max(140, len(value) * 11))
        top = 54 + index * 72
        result.append(
            {
                "index": index,
                "text": value,
                "box": [60.0, float(top), float(60 + width), float(top + 40)],
                "conf": 0.99,
            }
        )
    return result


class OcrEngine:
    def __init__(self) -> None:
        self.state = "idle"  # idle | loading | ready | error
        self.detail = "Starting…"
        self.error: str | None = None
        self.converter: Any = None
        self.threads = int(os.getenv("INDRA_THREADS", "0")) or max(2, (os.cpu_count() or 4) // 2)
        self.use_math = os.getenv("INDRA_MATH", "0") == "1"
        self.model_dir = os.getenv("INDRA_OCR_MODEL_DIR") or None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()

    def start(self) -> None:
        if MOCK:
            self.state = "ready"
            self.detail = "Demo mode — no models loaded"
            return
        if os.getenv("OCR_PRELOAD", "1") == "0":
            self.state = "idle"
            self.detail = "Loads on first scan"
            return
        threading.Thread(target=self.load, name="indra-loader", daemon=True).start()

    def load(self) -> None:
        with self._load_lock:
            if self.state in ("ready", "error"):
                return
            self.state = "loading"
            self.detail = "Loading Indra OCR models — first run downloads about 100 MB"
            started = time.perf_counter()
            try:
                import indra_ocr  # noqa: PLC0415 - import is intentionally lazy

                kwargs: dict[str, Any] = {"threads": self.threads, "math": self.use_math}
                if self.model_dir:
                    kwargs["path"] = self.model_dir
                self.converter = indra_ocr.load(**kwargs)
                try:
                    with self._run_lock:
                        self.converter.ocr(np.full((32, 128), 255, dtype=np.uint8))
                    log.info("Warm-up page done")
                except Exception:  # warm-up failure is not fatal
                    log.warning("Warm-up page failed", exc_info=True)
                self.state = "ready"
                self.detail = "Engine ready"
                log.info("Indra OCR ready in %.1fs (%s threads)", time.perf_counter() - started, self.threads)
            except Exception as exc:  # pragma: no cover - depends on local install
                self.state = "error"
                self.error = str(exc)
                self.detail = "OCR engine failed to load"
                log.exception("Could not load indra-ocr")
                return

    def ensure_loaded(self) -> None:
        if MOCK:
            return
        if self.state == "ready":
            return
        if self.state == "idle":
            self.load()
        while self.state == "loading":
            time.sleep(0.15)
        if self.state == "error":
            raise ScanError(
                "The OCR engine could not start. Check the server console, then run "
                "pip install -r requirements.txt in the ocr folder.",
                503,
            )

    def scan(self, data: bytes, side: str, doc_type: str = "aadhaar") -> dict[str, Any]:
        started = time.perf_counter()
        try:
            requested = normalize_doc_type(doc_type)
        except ValueError as exc:
            raise ScanError(str(exc), 400)

        if MOCK:
            if requested == "udid":
                text = DEMO_UDID
            elif requested == "disability":
                text = DEMO_DISABILITY
            elif requested == "aadhaar":
                text = DEMO_BACK if side == "back" else DEMO_FRONT
            else:
                text = DEMO_FRONT
            parsed, resolved = extract_document(text, requested, side)
            return {
                "ok": True,
                "doc_type": resolved,
                "side": parsed.side,
                "fields": parsed.as_dict()["fields"],
                "checks": parsed.checks,
                "warnings": parsed.warnings,
                "markdown": text,
                "text": text,
                "lines": _mock_line_boxes(text),
                "meta": {
                    "engine": "demo",
                    "doc_type": resolved,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                    "mock": True,
                },
            }

        if not data:
            raise ScanError("The photo was empty. Take another picture.", 400)

        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise ScanError("That file is not a readable image. Use a JPG, PNG or WebP photo.", 415)

        image = ImageOps.exif_transpose(image)
        if image.mode not in ("L", "RGB"):
            image = image.convert("RGB")

        width, height = image.size
        source_width, source_height = width, height
        longest = max(width, height)
        if longest > MAX_IMAGE_SIDE:
            ratio = MAX_IMAGE_SIDE / longest
            image = image.resize((max(1, int(width * ratio)), max(1, int(height * ratio))), Image.LANCZOS)
            width, height = image.size

        scale_x = source_width / width if width else 1.0
        scale_y = source_height / height if height else 1.0
        gray = np.array(image.convert("L"), dtype=np.uint8)

        self.ensure_loaded()
        if self.converter is None:
            raise ScanError("The OCR engine is not available.", 503)

        with self._run_lock:
            try:
                page = self.converter.ocr(gray)
            except Exception:
                log.exception("OCR failed")
                raise ScanError("The OCR engine could not read this photo. Try again with a sharper picture.", 500)

        text = getattr(page, "text", "") or ""
        markdown = getattr(page, "markdown", "") or text
        if not text.strip():
            raise ScanError(
                "No text was found in this photo. Fill the frame with the document, avoid glare, and hold it flat.",
                422,
            )

        parsed, resolved = extract_document(text, requested, side)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        result = parsed.as_dict()
        result.update(
            {
                "ok": True,
                "doc_type": resolved,
                "markdown": markdown,
                "text": text,
                # Boxes are scaled to the original photo, not the resized copy
                # Indra read, so the Flutter overlay lines up exactly.
                "lines": _line_boxes(page, scale_x, scale_y),
                "meta": {
                    "engine": "indra-ocr",
                    "doc_type": resolved,
                    "elapsed_ms": elapsed_ms,
                    "image": {"width": source_width, "height": source_height},
                    "ocr_image": {"width": width, "height": height},
                    "lines": len(getattr(page, "lines", []) or []),
                    "source": getattr(page, "source", None),
                    "mock": False,
                },
            }
        )
        return result


engine = OcrEngine()


def _is_loopback(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1", "localhost"} or host.startswith("127.")


def _supplied_key(request: Request) -> str:
    """The X-OCR-Key header, or the cookie set by the ?key= bootstrap below."""
    return request.headers.get("X-OCR-Key") or request.cookies.get("ocr_key", "")


def _require_ocr_key(request: Request) -> None:
    """When OCR_API_KEY is set, non-loopback callers must send X-OCR-Key."""
    expected = os.getenv("OCR_API_KEY", "").strip()
    if not expected or _is_loopback(request):
        return
    if not hmac.compare_digest(_supplied_key(request).encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Missing or invalid X-OCR-Key header.")


def _decode_base64_image(raw: str) -> bytes:
    if not raw or not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="image must be a base64-encoded JPEG or PNG.")
    payload = raw.strip()
    if payload.startswith("data:"):
        if "," not in payload:
            raise HTTPException(status_code=400, detail="Malformed data URL in image.")
        payload = payload.split(",", 1)[1]
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        try:
            data = base64.b64decode(payload)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="image is not valid base64.") from exc
    if not data:
        raise HTTPException(status_code=400, detail="image decoded to an empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    return data


def _requested_doc_type(value: str) -> str:
    try:
        return normalize_doc_type(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine.start()
    yield


app = FastAPI(title="Indra OCR Service", version="1.0.0", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.middleware("http")
async def security_headers(request, call_next):
    # Browser convenience: open /?key=<OCR_API_KEY> once and the key is stored in an
    # HttpOnly cookie, so the scanner UI keeps working when the service is not on
    # loopback (Render, a LAN address, a tunnel). The key never reaches app.js.
    expected = os.getenv("OCR_API_KEY", "").strip()
    supplied = request.query_params.get("key")
    if expected and supplied and hmac.compare_digest(supplied.encode(), expected.encode()):
        params = dict(request.query_params)
        params.pop("key", None)
        target = str(request.url.replace(query=urlencode(params)))
        response = RedirectResponse(target, status_code=303)
        response.set_cookie(
            "ocr_key",
            expected,
            max_age=30 * 24 * 60 * 60,
            httponly=True,
            secure=request.url.scheme == "https",
            samesite="lax",
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(self)"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/status")
async def status() -> dict[str, Any]:
    version = None
    try:
        from importlib.metadata import version as package_version

        version = package_version("indra-ocr")
    except Exception:
        pass
    return {
        "state": engine.state,
        "detail": engine.detail,
        "error": engine.error,
        "engine": "demo" if MOCK else "indra-ocr",
        "version": version,
        "mock": MOCK,
        "threads": engine.threads,
        "doc_types": list(DOC_TYPES),
        "api_key_required": bool(os.getenv("OCR_API_KEY", "").strip()),
    }


@app.post("/api/scan", dependencies=[Depends(_require_ocr_key)])
async def scan(
    image: UploadFile = File(...),
    side: str = Form("auto"),
    doc_type: str = Form("aadhaar"),
) -> dict[str, Any]:
    if side not in ("auto", "front", "back"):
        side = "auto"
    requested = _requested_doc_type(doc_type)
    data = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"That photo is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB. Try a smaller picture.",
        )
    try:
        return await asyncio.to_thread(engine.scan, data, side, requested)
    except ScanError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@app.post("/api/scan-base64", dependencies=[Depends(_require_ocr_key)])
async def scan_base64(payload: ScanPayload) -> dict[str, Any]:
    """JSON entry point for the Node backend (base64 photo + document type)."""
    side = payload.side if payload.side in ("auto", "front", "back") else "auto"
    requested = _requested_doc_type(payload.doc_type)
    data = _decode_base64_image(payload.image)
    try:
        return await asyncio.to_thread(engine.scan, data, side, requested)
    except ScanError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.head("/", include_in_schema=False)
@app.head("/api/status", include_in_schema=False)
async def head_probe() -> Response:
    """HEAD probes for Render's port scan and uptime monitors (FastAPI does not add HEAD)."""
    return Response(status_code=200)


@app.get("/favicon.svg", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon_ico() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8010"))
    print()
    print("  Indra OCR  -  local service")
    print(f"  http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}")
    print("  Ctrl+C to stop")
    print()
    uvicorn.run(app, host=host, port=port, reload=False)
