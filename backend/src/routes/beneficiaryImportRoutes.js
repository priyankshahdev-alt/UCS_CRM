import { Router } from 'express';
import { authenticateRole, authenticate } from '../middleware/authMiddleware.js';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { createImportBatch, getImportBatch, updateImportBatch, addImportRows, getImportRows, updateImportRow, listImportBatches } from '../models/importBatchModel.js';
import { generateBeneficiaryCode, createBeneficiary, updateBeneficiary } from '../models/beneficiaryModel.js';
import { addSourceRecord, findByOriginalData } from '../models/beneficiarySourceModel.js';
import { addDisability, getDisabilities } from '../models/beneficiaryDisabilityModel.js';
import { logAuditEvent } from '../models/auditLogModel.js';
import db from '../config/db.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

const text = (v) => (v == null ? '' : String(v).trim());

// Indian mobiles are frequently written with the country/STD prefix, leading
// zeros or separators ("+91 98765-43210", "098765 43210"). Reduce any of those
// to the bare 10-digit number; anything shorter is not a usable number.
const phone = (v) => {
  const digits = text(v).replace(/\D/g, '');
  if (!digits) return null;
  const local = digits.length > 10 ? digits.slice(-10) : digits.replace(/^0+/, '');
  return local.length >= 10 ? local : null;
};

const pct = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, Math.round(n * 100) / 100);
};

const ageToDob = (v) => {
  const years = Number.parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(years) || years <= 0 || years > 120) return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - Math.floor(years));
  return d.toISOString().slice(0, 10);
};

// Accepts Excel dates (serial numbers, ISO strings) and the usual Indian
// dd/mm/yyyy and dd-mm-yyyy written forms.
const toDob = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    return null;
  }
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    // 2-digit years pivot at 50: 92 -> 1992, 07 -> 2007.
    const year = m[3].length === 2 ? (Number(m[3]) >= 50 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const GENDER = { m: 'MALE', male: 'MALE', man: 'MALE', f: 'FEMALE', female: 'FEMALE', woman: 'FEMALE', o: 'OTHER', other: 'OTHER', t: 'TRANSGENDER', transgender: 'TRANSGENDER' };
const gender = (v) => GENDER[text(v).toLowerCase()] || text(v).toUpperCase() || null;

// "Needed Type (NGO)" is free text in the sheet, matched against the NGO
// master list (name first, then code) so the import lands on a real ngo_id.
const loadNgoLookup = async () => {
  const lookup = new Map();
  const { data } = await db.from('ngos').select('id, name, code');
  const add = (key, id) => {
    const k = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
    if (k && !lookup.has(k)) lookup.set(k, id);
  };
  for (const n of data || []) {
    add(n.name, n.id);
    add(n.code, n.id);
  }
  return lookup;
};

const resolveNgo = (lookup, v) => {
  const k = String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  return k ? lookup.get(k) ?? null : null;
};

// Find a member already registered under the same number (either slot) so a
// re-import fills the gaps instead of creating a duplicate.
const findByNumber = async (mobile) => {
  const { data, error } = await db
    .from('beneficiaries')
    .select('*')
    .or(`mobile.eq.${mobile},alternate_mobile.eq.${mobile}`)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
};

// Upload and parse Excel
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;

    // Parse each sheet and count rows
    const sheets = {};
    for (const name of sheetNames) {
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[name]);
      sheets[name] = { rows: data.length, headers: data.length > 0 ? Object.keys(data[0]) : [] };
    }

    // Create import batch
    const batch = await createImportBatch({
      file_name: req.file.originalname,
      total_rows: Object.values(sheets).reduce((sum, s) => sum + s.rows, 0),
      status: 'PENDING',
      imported_by: req.user?.name || req.user?.email || 'system',
    });

    return res.status(201).json({
      batch,
      sheets: Object.entries(sheets).map(([name, info]) => ({
        name, rows: info.rows, headers: info.headers,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ── Member sheet import (Accounts panel → Beneficiaries → Import Members) ──
// The panel parses the workbook in the browser and posts the mapped rows, so
// this endpoint only does the parts that need the database: NGO name → ngo_id,
// Age → date_of_birth, and the create/merge itself.
//
// Sheet columns: Member Name, Number, % of Disability, Type of Disability,
// Alternate Number, Location, Needed Type (NGO), State, Age, DOB, Gender.
router.post('/members', authenticateRole('super_admin', 'admin', 'ngo', 'accounts'), async (req, res) => {
  const { rows, file_name: fileName } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'rows array is required' });
  }

  const performedBy = req.user?.name || req.user?.email || 'system';
  const created_by = req.user?.name || req.user?.email || 'system';

  let batch = null;
  let ngoLookup = new Map();
  try {
    ngoLookup = await loadNgoLookup();
    batch = await createImportBatch({
      file_name: text(fileName) || `member-import-${new Date().toISOString().slice(0, 10)}.xlsx`,
      total_rows: rows.length,
      status: 'PENDING',
      imported_by: performedBy,
    });
  } catch (e) {
    // Never let bookkeeping stop the import itself.
    console.error('[beneficiary import] batch setup failed:', e.message);
  }

  const results = [];
  const staging = [];
  const summary = { created: 0, updated: 0, no_change: 0, skipped: 0, errors: 0 };
  const imported = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const rowNumber = Number(row._rowNumber) || i + 2;
    const name = text(row.full_name || row.name);
    const mobile = phone(row.mobile);
    const alternateMobile = phone(row.alternate_mobile);
    const warnings = [];

    if (!name) {
      summary.skipped++;
      results.push({ row: rowNumber, status: 'skipped', name: '', message: 'Member Name is empty', warnings });
      staging.push({ batch_id: batch?.id ?? null, row_number: rowNumber, raw_data: row, status: 'INVALID', validation_errors: { errors: ['Member Name is empty'] } });
      continue;
    }

    try {
      const dob = toDob(row.date_of_birth) || ageToDob(row.age);
      if (!toDob(row.date_of_birth) && row.age && !dob) {
        warnings.push('Age could not be read, DOB left empty');
      }
      const location = text(row.location);
      const state = text(row.state);
      const disabilityType = text(row.disability_type);
      const disabilityPercentage = pct(row.disability_percentage);
      const g = gender(row.gender);

      const ngoId = resolveNgo(ngoLookup, row.ngo);
      if (text(row.ngo) && !ngoId) {
        warnings.push(`"${text(row.ngo)}" does not match a registered NGO — left unassigned`);
      }
      if (disabilityPercentage != null && !disabilityType) {
        warnings.push('Disability % present without a Type — recorded as "General"');
      }

      const existing = mobile ? await findByNumber(mobile) : null;

      if (existing) {
        // Merge: only fill the blanks so nothing already on file is overwritten.
        const patch = {};
        const fill = (column, value) => {
          if (value != null && value !== '' && !text(existing[column])) patch[column] = value;
        };
        fill('full_name', name);
        fill('mobile', mobile);
        fill('alternate_mobile', alternateMobile);
        fill('date_of_birth', dob);
        fill('gender', g);
        fill('address_line_1', location);
        fill('state', state);
        fill('ngo_id', ngoId);

        if (Object.keys(patch).length > 0) {
          await updateBeneficiary(existing.id, { ...patch, updated_by: created_by });
        }

        // Add the disability only when the member has none recorded yet.
        let disabilityAdded = false;
        if ((disabilityType || disabilityPercentage != null) && (await getDisabilities(existing.id)).length === 0) {
          await addDisability(existing.id, {
            disability_type: disabilityType || 'General',
            disability_percentage: disabilityPercentage,
            certificate_available: false,
          });
          disabilityAdded = true;
        }

        const changed = Object.keys(patch).length > 0 || disabilityAdded;
        if (changed) summary.updated++; else summary.no_change++;
        results.push({
          row: rowNumber, status: changed ? 'updated' : 'no_change', name,
          mobile, beneficiary_id: existing.id, beneficiary_code: existing.beneficiary_code,
          message: changed ? 'Existing member updated with the missing details' : 'Already up to date',
          warnings,
        });
        staging.push({
          batch_id: batch?.id ?? null, row_number: rowNumber, raw_data: row, mapped_data: row,
          status: changed ? 'UPDATED' : 'NO_CHANGE', beneficiary_id: existing.id,
          validation_errors: warnings.length ? { warnings } : null,
        });
        continue;
      }

      const beneficiary_code = await generateBeneficiaryCode();
      const created = await createBeneficiary({
        beneficiary_code,
        full_name: name,
        date_of_birth: dob,
        gender: g,
        mobile,
        alternate_mobile: alternateMobile,
        address_line_1: location || null,
        state: state || null,
        ngo_id: ngoId,
        status: 'ACTIVE',
        fingerprint_status: 'NOT_REGISTERED',
        created_by,
        updated_by: created_by,
      });

      if (disabilityType || disabilityPercentage != null) {
        await addDisability(created.id, {
          disability_type: disabilityType || 'General',
          disability_percentage: disabilityPercentage,
          certificate_available: false,
        });
      }

      await addSourceRecord(created.id, {
        source_type: 'IMPORT',
        source_file: batch?.file_name || text(fileName) || null,
        original_name: name,
        original_data: row,
        import_batch_id: batch?.id ?? null,
      });

      await logAuditEvent({
        entity_type: 'beneficiary', entity_id: created.id, beneficiary_id: created.id,
        action: 'IMPORTED', details: { batch_id: batch?.id ?? null, beneficiary_code },
        performed_by: performed_by,
      });

      summary.created++;
      imported.push(created);
      results.push({
        row: rowNumber, status: 'created', name, mobile,
        beneficiary_id: created.id, beneficiary_code, message: 'Member added', warnings,
      });
      staging.push({
        batch_id: batch?.id ?? null, row_number: rowNumber, raw_data: row, mapped_data: row,
        status: 'VALID', beneficiary_id: created.id,
        validation_errors: warnings.length ? { warnings } : null,
      });
    } catch (err) {
      console.error(`[beneficiary import] row ${rowNumber} failed:`, err.message);
      summary.errors++;
      results.push({ row: rowNumber, status: 'error', name, mobile, message: err.message, warnings });
      staging.push({
        batch_id: batch?.id ?? null, row_number: rowNumber, raw_data: row,
        status: 'ERROR', validation_errors: { error: err.message },
      });
    }
  }

  if (batch) {
    await updateImportBatch(batch.id, {
      valid_rows: summary.created + summary.updated,
      warning_rows: results.filter((r) => r.warnings?.length).length,
      duplicate_rows: summary.no_change,
      error_rows: summary.errors + summary.skipped,
      status: 'COMPLETED',
      imported_at: new Date().toISOString(),
    }).catch((e) => console.error('[beneficiary import] batch update failed:', e.message));
  }
  if (staging.length > 0) {
    await addImportRows(staging).catch((e) => console.error('[beneficiary import] row staging failed:', e.message));
  }

  return res.json({ summary, results, batch_id: batch?.id ?? null, imported });
});

// Map columns and preview
router.post('/:batchId/preview', authenticate, async (req, res) => {
  try {
    const batch = await getImportBatch(req.params.batchId);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    const { sheet_name, column_mapping } = req.body;
    // column_mapping: { beneficiary_full_name: 'A', mobile: 'B', ... }

    // Re-read the file to get data
    // For now, return placeholder - full implementation would re-read from S3
    return res.json({
      batch,
      message: 'Preview ready',
      column_mapping,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Import rows from batch
router.post('/:batchId/confirm', authenticate, async (req, res) => {
  try {
    const batch = await getImportBatch(req.params.batchId);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });

    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ message: 'rows array is required' });
    }

    const created_by = req.user?.name || req.user?.email || 'system';
    let validCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const importedBeneficiaries = [];

    for (const row of rows) {
      try {
        // Check for duplicates
        const duplicates = await findByOriginalData({
          mobile: row.mobile,
          full_name: row.full_name,
          date_of_birth: row.date_of_birth,
        });

        if (duplicates.length > 0) {
          duplicateCount++;
          await addImportRows([{
            batch_id: batch.id,
            row_number: row._rowNumber || 0,
            raw_data: JSON.stringify(row),
            mapped_data: JSON.stringify(row),
            status: 'DUPLICATE',
            validation_errors: JSON.stringify({ duplicates: duplicates.map(d => d.beneficiary_code) }),
          }]);
          continue;
        }

        const beneficiary_code = await generateBeneficiaryCode();
        const beneficiary = await createBeneficiary({
          beneficiary_code,
          full_name: row.full_name || row.name || '',
          first_name: row.first_name,
          last_name: row.last_name,
          date_of_birth: row.date_of_birth || null,
          gender: row.gender,
          mobile: row.mobile,
          alternate_mobile: row.alternate_mobile,
          email: row.email,
          address_line_1: row.address || row.address_line_1,
          city: row.city,
          district: row.district,
          state: row.state,
          pincode: row.pincode,
          status: row.status || 'ACTIVE',
          ngo_id: req.user?.ngo_id || null,
          created_by, updated_by: created_by,
        });

        await addSourceRecord(beneficiary.id, {
          source_type: 'IMPORT',
          source_file: batch.file_name,
          original_name: row.full_name || row.name,
          original_data: JSON.stringify(row),
          import_batch_id: batch.id,
        });

        await logAuditEvent({
          entity_type: 'beneficiary', entity_id: beneficiary.id,
          beneficiary_id: beneficiary.id, action: 'IMPORTED',
          details: { batch_id: batch.id, beneficiary_code },
          performed_by: created_by,
        });

        validCount++;
        importedBeneficiaries.push(beneficiary);
      } catch (err) {
        errorCount++;
        await addImportRows([{
          batch_id: batch.id,
          row_number: row._rowNumber || 0,
          raw_data: JSON.stringify(row),
          status: 'ERROR',
          validation_errors: JSON.stringify({ error: err.message }),
        }]);
      }
    }

    await updateImportBatch(batch.id, {
      valid_rows: validCount,
      duplicate_rows: duplicateCount,
      error_rows: errorCount,
      status: 'COMPLETED',
      imported_at: new Date().toISOString(),
    });

    return res.json({
      message: 'Import completed',
      valid: validCount,
      duplicates: duplicateCount,
      errors: errorCount,
      beneficiaries: importedBeneficiaries,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// List batches
router.get('/', authenticate, async (req, res) => {
  try {
    const { page, pageSize } = req.query;
    const result = await listImportBatches({ page: parseInt(page) || 1, pageSize: parseInt(pageSize) || 25 });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get batch detail
router.get('/:batchId', authenticate, async (req, res) => {
  try {
    const batch = await getImportBatch(req.params.batchId);
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    const rows = await getImportRows(batch.id);
    return res.json({ batch, rows });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

export default router;
