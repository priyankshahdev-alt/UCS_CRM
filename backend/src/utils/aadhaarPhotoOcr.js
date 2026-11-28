// Bridge between the Node backend and the local Indra OCR service.
//
// The service runs on the same machine (ocr/server.py, default :8010) and owns
// the model, so this file only sends the base64 photo and maps the returned
// fields into the shape the beneficiary app already consumes. There is no cloud
// OCR fallback: if Indra is down, the caller gets a clear 503/502 instead of a
// silently different engine.

const DOC_TYPES = new Set(['aadhaar', 'udid', 'disability', 'generic', 'auto']);

export const ALL_KEYS = [
  'name', 'dob', 'gender', 'address_line_1', 'vtc', 'aadhaar_number', 'pincode',
  'udid_number', 'certificate_number', 'disability_percentage', 'disability_type',
];

const AADHAAR_KEYS = ['name', 'dob', 'gender', 'address_line_1', 'vtc', 'aadhaar_number', 'pincode'];
const UDID_KEYS = [
  'name', 'dob', 'gender', 'address_line_1', 'vtc', 'pincode',
  'udid_number', 'certificate_number', 'disability_percentage', 'disability_type',
];
const DISABILITY_KEYS = [
  'name', 'dob', 'gender', 'address_line_1', 'vtc', 'pincode',
  'certificate_number', 'udid_number', 'disability_percentage', 'disability_type',
];

function keysFor(docType, side) {
  if (docType === 'aadhaar') {
    if (side === 'front') return ['name', 'dob', 'gender', 'aadhaar_number'];
    if (side === 'back') return ['address_line_1', 'vtc', 'pincode'];
    return AADHAAR_KEYS;
  }
  if (docType === 'udid') return UDID_KEYS;
  if (docType === 'disability') return DISABILITY_KEYS;
  return ALL_KEYS;
}

function parseDob(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  const match = value.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!match) return null;

  let [day, month, year] = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  if (day > 31 && month <= 12) {
    const swap = day;
    day = month;
    month = swap;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function cleanFields(parsed, allowedKeys) {
  const cleaned = {};
  for (const key of allowedKeys) {
    const value = parsed?.[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) cleaned[key] = text;
  }

  if (cleaned.aadhaar_number) {
    cleaned.aadhaar_number = cleaned.aadhaar_number.replace(/[^0-9]/g, '').slice(0, 12);
    if (cleaned.aadhaar_number.length !== 12) delete cleaned.aadhaar_number;
  }

  if (cleaned.dob) {
    const dob = parseDob(cleaned.dob);
    if (dob) cleaned.dob = dob;
    else delete cleaned.dob;
  }

  if (cleaned.pincode) {
    const pin = cleaned.pincode.replace(/[^0-9]/g, '').slice(0, 6);
    if (pin.length === 6) cleaned.pincode = pin;
    else delete cleaned.pincode;
  }

  if (cleaned.udid_number) {
    cleaned.udid_number = cleaned.udid_number.replace(/[\s-]/g, '').toUpperCase();
  }

  if (cleaned.disability_percentage) {
    const percent = parseInt(String(cleaned.disability_percentage).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(percent) && percent >= 1 && percent <= 100) {
      cleaned.disability_percentage = String(percent);
    } else {
      delete cleaned.disability_percentage;
    }
  }

  return cleaned;
}

function mapIndraFields(fields = {}) {
  const value = (key) => fields?.[key]?.value ?? null;
  return {
    name: value('name'),
    dob: value('dob'),
    gender: value('gender'),
    address_line_1: value('address'),
    pincode: value('pincode'),
    aadhaar_number: value('aadhaar'),
    udid_number: value('udid_number'),
    certificate_number: value('certificate_number'),
    disability_percentage: value('disability_percentage'),
    disability_type: value('disability_type'),
  };
}

function ocrServiceUrl() {
  const configured = process.env.INDRA_OCR_URL || 'http://127.0.0.1:8010';
  return configured.replace(/\/+$/, '');
}

function serviceError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Send one card/document photo to Indra and return the flat app field shape.
 *
 * @param {string} base64   raw base64 or a data URL
 * @param {string} docType  aadhaar | udid | disability | generic | auto
 * @param {string} side     front | back | all
 * @returns {Promise<{fields: object, via: string, errors: string[], warnings: string[], doc_type: string, lines: Array<{index: number, text: string, box: number[], conf: number|null}>, meta: object|null}>}
 */
export async function extractDocumentFromPhoto(base64, docType = 'aadhaar', side = 'all') {
  if (!base64 || typeof base64 !== 'string') {
    throw serviceError('image is required', 400);
  }
  if (!DOC_TYPES.has(docType)) {
    throw serviceError(`Unsupported doc_type "${docType}".`, 400);
  }

  const url = `${ocrServiceUrl()}/api/scan-base64`;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.INDRA_OCR_KEY) headers['X-OCR-Key'] = process.env.INDRA_OCR_KEY;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: base64,
        side: side === 'all' ? 'auto' : side,
        doc_type: docType,
      }),
      signal: AbortSignal.timeout(Number(process.env.INDRA_OCR_TIMEOUT_MS || 90000)),
    });
  } catch (error) {
    throw serviceError(
      `Indra OCR service is unreachable at ${url}. Start ocr/server.py and check INDRA_OCR_URL.`,
      502,
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message || `Indra OCR HTTP ${response.status}`;
    throw serviceError(String(detail), response.status === 401 ? 502 : response.status);
  }

  const mapped = mapIndraFields(data?.fields);
  const fields = cleanFields(mapped, keysFor(docType, side));
  return {
    fields,
    via: 'indra',
    errors: [],
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    doc_type: data?.doc_type || docType,
    lines: sanitizeLines(data?.lines),
    meta: data?.meta && typeof data.meta === 'object' ? data.meta : null,
  };
}

/**
 * Keep only the geometry the Flutter overlay needs. The OCR service is local,
 * but this payload crosses the Worker proxy, so nothing unexpected is forwarded.
 */
function sanitizeLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((line, index) => {
      const text = String(line?.text ?? '').trim();
      const raw = Array.isArray(line?.box) ? line.box : [];
      const box = raw.slice(0, 4).map((n) => Number(n));
      if (!text || box.length !== 4 || box.some((n) => !Number.isFinite(n))) return null;
      return {
        index: Number.isInteger(line?.index) ? line.index : index,
        text,
        box,
        conf: typeof line?.conf === 'number' && Number.isFinite(line.conf) ? line.conf : null,
      };
    })
    .filter(Boolean);
}

// Backwards-compatible wrapper for the existing Aadhaar route/callers.
export async function extractAadhaarFromPhoto(base64, side = 'all') {
  return extractDocumentFromPhoto(base64, 'aadhaar', side);
}
