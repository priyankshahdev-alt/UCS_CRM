import {
  generateBeneficiaryCode, createBeneficiary, getBeneficiaryById, getBeneficiaryByCode,
  updateBeneficiary, listBeneficiaries, exportBeneficiaries, searchBeneficiaries, getBeneficiaryOverview,
  searchByQRToken, searchByMobile, markKitGiven, deleteBeneficiaries, listKitGivenEvents,
  listBeneficiaryOccupations,
  setBeneficiaryCollectionOtp, setBeneficiaryOtpVerified,
} from '../models/beneficiaryModel.js';
import { assignCategories, getBeneficiaryCategories } from '../models/beneficiaryCategoryModel.js';
import { getDisabilities, addDisability, removeDisability } from '../models/beneficiaryDisabilityModel.js';
import { getFamilyMembers } from '../models/beneficiaryFamilyModel.js';
import { getEducation } from '../models/beneficiaryEducationModel.js';
import { getEmployment } from '../models/beneficiaryEmploymentModel.js';
import { getAssistances } from '../models/beneficiaryAssistanceModel.js';
import { getDocuments } from '../models/beneficiaryDocumentModel.js';
import { getCards, getActiveCard } from '../models/beneficiaryCardModel.js';
import { getBiometricStatus, getFingerprintImages } from '../models/biometricModel.js';
import { getSourceRecords } from '../models/beneficiarySourceModel.js';
import { getBeneficiaryDistributionHistory } from '../models/distributionModel.js';
import { getBeneficiaryPrograms } from '../models/programBeneficiaryModel.js';
import { logAuditEvent, getAuditLogs } from '../models/auditLogModel.js';
import { getBnfOperatorBySession } from '../models/bnfOperatorModel.js';
import { getTodayAssignment, listOperatorEvents, demoOperatorEvent } from '../models/operatorModel.js';
import { getCatalogItem } from '../models/bnfCatalogModel.js';
import { extractAadhaarFromPhoto, ALL_KEYS } from '../utils/aadhaarPhotoOcr.js';
import { randomInt, timingSafeEqual } from 'crypto';
import db from '../config/db.js';

const DOC_BUCKET = 'beneficiary-documents';

// Collection OTPs are valid for 15 minutes after they are generated.
export const COLLECTION_OTP_TTL_MS = 15 * 60 * 1000;

// Beneficiaries-app sessions: JWT has department 'operator' and no ngo_id
// (CRM worker tokens always include ngo_id).
export const isBeneficiariesAppSession = (user) =>
  user?.client === 'beneficiaries' ||
  (user?.department === 'operator' && user?.ngo_id === undefined);

const ensureDocBucket = async () => {
  const { data: buckets } = await db.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === DOC_BUCKET);
  if (!exists) {
    await db.storage.createBucket(DOC_BUCKET, { public: true });
  }
};

// Stores a base64-encoded file (e.g. handicap-certificate camera capture)
// into the beneficiary-documents bucket and returns the public URL. Mirrors
// the operator selfie / worker onboarding upload flow.
export const uploadBeneficiaryDocumentBase64 = async (beneficiaryId, documentType, fileBase64, mimeType) => {
  if (!fileBase64) return { fileUrl: null };
  await ensureDocBucket();
  const buffer = Buffer.from(String(fileBase64), 'base64');
  const contentType = mimeType || 'image/jpeg';
  const ext = contentType.split('/')[1] || 'jpg';
  const fileName = `beneficiary_documents/${beneficiaryId}/${(documentType || 'document').replace(/[^a-z0-9]+/gi, '_')}_${Date.now()}.${ext}`;

  let { error: uploadError } = await db.storage
    .from(DOC_BUCKET)
    .upload(fileName, buffer, { contentType, upsert: true });

  if (uploadError?.message?.includes('bucket')) {
    await db.storage.createBucket(DOC_BUCKET, { public: true });
    const retry = await db.storage.from(DOC_BUCKET).upload(fileName, buffer, { contentType, upsert: true });
    if (retry.error) throw retry.error;
  } else if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = db.storage.from(DOC_BUCKET).getPublicUrl(fileName);
  return { fileUrl: publicUrlData?.publicUrl || null };
};

// Fallback proof when a beneficiary's fingerprint cannot be read. The operator
// selects the beneficiary in the app, captures a photo and submits it here.
// The photo is stored as a `distribution_proof` document (never overwriting the
// profile photo) and logged, then the URL is sent back with the kit-given call.
export const photoVerificationController = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid beneficiary id' });
    }
    const beneficiary = await getBeneficiaryById(id);
    if (!beneficiary) return res.status(404).json({ message: 'Beneficiary not found' });

    const fileBase64 = req.body?.file_base64;
    if (!fileBase64) {
      return res.status(400).json({ message: 'Photo is required' });
    }

    const { fileUrl } = await uploadBeneficiaryDocumentBase64(
      id,
      'distribution_proof',
      fileBase64,
      req.body?.mime_type || 'image/jpeg'
    );
    if (!fileUrl) {
      return res.status(500).json({ message: 'Could not store the photo' });
    }

    const verifiedAt = new Date().toISOString();
    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: id, beneficiary_id: id,
      action: 'PHOTO_FALLBACK_VERIFIED',
      details: { document_type: 'distribution_proof', file_url: fileUrl },
      performed_by: req.user?.name || req.user?.email || 'system',
    });

    return res.json({ file_url: fileUrl, verified_at: verifiedAt });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Stores the beneficiary's profile photo in the beneficiary-documents bucket
// (never inline in the DB) and writes the resulting public URL to the
// beneficiaries.photo column. Used by both the add and edit flows.
export const uploadBeneficiaryPhotoController = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid beneficiary id' });
    }
    const beneficiary = await getBeneficiaryById(id);
    if (!beneficiary) return res.status(404).json({ message: 'Beneficiary not found' });

    const fileBase64 = req.body?.file_base64;
    if (!fileBase64) {
      return res.status(400).json({ message: 'Photo is required' });
    }

    const { fileUrl } = await uploadBeneficiaryDocumentBase64(
      id,
      'profile_photo',
      fileBase64,
      req.body?.mime_type || 'image/jpeg'
    );
    if (!fileUrl) {
      return res.status(500).json({ message: 'Could not store the photo' });
    }

    await updateBeneficiary(id, { photo: fileUrl });

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: id, beneficiary_id: id,
      action: 'BENEFICIARY_PHOTO_UPDATED',
      details: { file_url: fileUrl },
      performed_by: req.user?.name || req.user?.email || 'system',
    });

    return res.json({ file_url: fileUrl });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createNewBeneficiary = async (req, res) => {
  try {
    const {
      full_name, first_name, middle_name, last_name, date_of_birth, gender,
      mobile, alternate_mobile, email, address_line_1, address_line_2, area,
      city, district, state, pincode, photo, monthly_family_income, income_category,
      bpl_available, ration_card_available, occupation, mother_name, father_name,
      guardian_name, guardian_occupation, total_family_members, ngo_id, registration_date,
      category_ids, disabilities, family_members, education, employment, assistance_requirements,
      aadhaar_number, needed, beneficiary_type,
    } = req.body;

    if (!full_name) return res.status(400).json({ message: 'Full name is required' });

    const created_by = req.user?.name || req.user?.email || 'system';

    let beneficiary = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const beneficiary_code = await generateBeneficiaryCode();
      try {
        beneficiary = await createBeneficiary({
          beneficiary_code, full_name, first_name, middle_name, last_name,
          date_of_birth, gender, mobile, alternate_mobile, email,
          address_line_1, address_line_2, area, city, district, state, pincode, photo,
          monthly_family_income, income_category, bpl_available, ration_card_available,
          occupation, mother_name, father_name, guardian_name, guardian_occupation,
          total_family_members, ngo_id, registration_date, aadhaar_number, needed,
          beneficiary_type,
          status: 'ACTIVE', fingerprint_status: 'NOT_REGISTERED',
          created_by, updated_by: created_by,
        });
        break;
      } catch (e) {
        const msg = String(e?.message || '');
        if (attempt < 2 && (e?.code === '23505' || /duplicate key value violates unique constraint/i.test(msg))) {
          continue;
        }
        throw e;
      }
    }

    if (category_ids && category_ids.length > 0) {
      await assignCategories(beneficiary.id, category_ids);
    }

    // Persist disability records (disability_type + percentage) sent from the
    // operator app. Failures here never block the registration itself, but are
    // surfaced to the caller as warnings instead of being swallowed.
    const warnings = [];
    if (Array.isArray(disabilities)) {
      for (const d of disabilities) {
        if (!d || typeof d !== 'object') continue;
        let saved = false;
        for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
          try {
            await addDisability(beneficiary.id, {
              disability_type: String(d.disability_type || 'General'),
              disability_percentage:
                d.disability_percentage != null && d.disability_percentage !== ''
                  ? Number(d.disability_percentage)
                  : null,
              certificate_available:
                d.certificate_available != null ? Boolean(d.certificate_available) : false,
              certificate_number: d.certificate_number || null,
              certificate_issue_date: d.certificate_issue_date || null,
              certificate_validity: d.certificate_validity || null,
              issuing_authority: d.issuing_authority || null,
              remarks: d.remarks || null,
            });
            saved = true;
          } catch (e) {
            if (attempt === 3) {
              const msg = `Disability details could not be saved (${String(
                d.disability_type || 'General'
              )} — ${e.message}).`;
              console.error(`[beneficiaries] disability save failed for ${beneficiary.id}:`, e.message);
              warnings.push(msg);
            } else {
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }
        }
      }
    }

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: beneficiary.id,
      beneficiary_id: beneficiary.id, action: 'CREATED',
       details: { beneficiary_code: beneficiary.beneficiary_code }, performed_by: created_by,
    });

    return res.status(201).json({
      message: 'Beneficiary created',
      beneficiary,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// True when the beneficiary collected their kit within the last 3 calendar
// months — the window in which an event-kit should only be handed out after
// an explicit operator override. Calendar months (not flat 90 days) match the
// app's cutoff: given on Mar 10 → window ends Jun 10.
export function isWithinThreeMonths(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(date);
  cutoff.setMonth(cutoff.getMonth() + 1);
  return Date.now() <= cutoff.getTime();
}

// Assembles the fully-enriched beneficiary shape (base row + every
// sub-resource) used both by GET /:id and the QR lookup endpoint.
const buildFullBeneficiary = async (id) => {
  const beneficiary = await getBeneficiaryById(id);
  if (!beneficiary) return null;

  const categories = await getBeneficiaryCategories(beneficiary.id);
  const disabilities = await getDisabilities(beneficiary.id);
  const family = await getFamilyMembers(beneficiary.id);
  const education = await getEducation(beneficiary.id);
  const employment = await getEmployment(beneficiary.id);
  const assistances = await getAssistances(beneficiary.id);
  const documents = await getDocuments(beneficiary.id);
  const cards = await getCards(beneficiary.id);
  const activeCard = await getActiveCard(beneficiary.id);
  const biometric = await getBiometricStatus(beneficiary.id);
  const sourceRecords = await getSourceRecords(beneficiary.id);
  const distributions = await getBeneficiaryDistributionHistory(beneficiary.id);
  // A profile must still load on an installation where migration 120 never ran
  // and program_beneficiaries has no columns to query; a failure degrades to an
  // empty list instead of a 500 on the whole profile.
  const programs = await getBeneficiaryPrograms(beneficiary.id).catch(() => []);

  return {
    ...beneficiary,
    categories, disabilities, family, education, employment,
    assistances, documents, cards, activeCard, biometric,
    sourceRecords, distributions, programs,
  };
};

export const getBeneficiary = async (req, res) => {
  try {
    const beneficiary = await buildFullBeneficiary(req.params.id);
    if (!beneficiary) return res.status(404).json({ message: 'Beneficiary not found' });

    return res.json(beneficiary);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// QR / barcode lookup. Resolves the qr_token to its card, then returns the
// full enriched beneficiary so the operator app gets every detail (including
// kit_given_at) in a single request.
export const lookupBeneficiaryByToken = async (req, res) => {
  try {
    const card = await searchByQRToken(req.params.token);
    if (!card || !card.id) return res.status(404).json({ message: 'No beneficiary found for this QR code' });

    const beneficiary = await buildFullBeneficiary(card.id);
    if (!beneficiary) return res.status(404).json({ message: 'No beneficiary found for this QR code' });

    return res.json(beneficiary);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getBeneficiaryByCodeController = async (req, res) => {
  try {
    const beneficiary = await getBeneficiaryByCode(req.params.code);
    if (!beneficiary) return res.status(404).json({ message: 'Beneficiary not found' });
    return res.json(beneficiary);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Deletes one or more beneficiaries and everything attached to them (all
// "details" including fingerprints and documents). Used by both
// DELETE /beneficiaries/:id and POST /beneficiaries/bulk-delete.
export const deleteBeneficiariesController = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : req.params.id
        ? [req.params.id]
        : [];
    const cleanIds = [...new Set(ids.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0))];
    if (cleanIds.length === 0) {
      return res.status(400).json({ message: 'No valid beneficiary ids provided' });
    }

    const { deleted } = await deleteBeneficiaries(cleanIds);

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: cleanIds[0], beneficiary_id: null,
      action: 'BULK_DELETED',
      details: { ids: cleanIds, requested: cleanIds.length, deleted },
      performed_by: req.user?.name || 'system',
    });

    return res.json({ message: `Deleted ${deleted} beneficiary${deleted === 1 ? '' : 'ies'}. All related records removed (documents, fingerprints, disability, family, benefits).`, deleted });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const markBeneficiaryKitGiven = async (req, res) => {
  try {
    const beneficiary = await getBeneficiaryById(req.params.id);
    if (!beneficiary) return res.status(404).json({ message: 'Beneficiary not found' });

    // A kit may only be handed out once every 3 months. If one was given
    // within the window, only an explicit override (operator accepted the
    // "already given on X" prompt) records another handout.
    if (isWithinThreeMonths(beneficiary.kit_given_at) && req.body?.override !== true) {
      const givenOn = beneficiary.kit_given_at
        ? new Date(beneficiary.kit_given_at).toISOString().slice(0, 10)
        : null;
      return res.status(400).json({
        message: givenOn
          ? `Kit already given on ${givenOn}. Would you still want to give this beneficiary the kit?`
          : 'Kit already given. Would you still want to give this beneficiary the kit?',
        withinThreeMonths: true,
        beneficiary,
      });
    }

    // Re-issue (override) from the beneficiaries app requires the collection
    // OTP to have been verified first — the app blocks the swipe until then.
    if (
      req.body?.override === true &&
      isBeneficiariesAppSession(req.user) &&
      !beneficiary.collection_otp_verified_at
    ) {
      return res.status(403).json({ message: 'Verify the collection OTP first' });
    }

    const givenBy = req.user?.name || req.user?.email || 'system';
    const method = String(req.body?.method || 'fingerprint').trim() || 'fingerprint';
    const proofUrl = req.body?.proof_document_url
      ? String(req.body.proof_document_url).trim()
      : null;
    // A photo-fallback handout must carry the proof uploaded beforehand so the
    // audit trail always has evidence behind a fingerprint-less collection.
    if (method === 'photo_fallback' && !proofUrl) {
      return res.status(400).json({ message: 'Photo proof is required for photo fallback' });
    }

    // Capture the operator's event for the day (if one is assigned) so the
    // kit-given history on the app can show which event the kit was collected
    // at — and so the beneficiary row (kit_event_*) carries it for the admin
    // list's event column / filter. Resolved BEFORE the update for that reason.
    let eventName = null;
    let eventId = null;
    // Which kit the operator is handing out today. It lives on the day's
    // assignment (not on each beneficiary), so it is resolved here and stamped
    // onto the beneficiary row — that is what lets the admin list/PDF report
    // show what was actually given.
    let kitId = null;
    let kitName = null;
    try {
      const worker = await getBnfOperatorBySession(req.user);
      if (worker?.id != null) {
        const today = new Date().toISOString().split('T')[0];
        const assignment = await getTodayAssignment(worker.id, today);
        const ev = assignment?.operator_events;
        if (ev) {
          eventName = ev?.title || ev?.name || null;
          eventId = ev?.id != null ? Number(ev.id) : null;
        }
        if (assignment?.kit_id != null) {
          kitId = Number(assignment.kit_id);
          const kit = await getCatalogItem('kits', kitId);
          kitName = kit?.name || null;
        }
      }
      // The operator dashboard falls back to the demo event when no real
      // event exists for the day — mirror that so the history shows it too.
      if (!eventName) {
        const today = new Date().toISOString().split('T')[0];
        const events = await listOperatorEvents({ date: today });
        if (!events || events.length === 0) eventName = demoOperatorEvent.title;
      }
    } catch (_) {
      eventName = null;
      eventId = null;
    }

    const updated = await markKitGiven(beneficiary.id, givenBy, {
      id: Number.isInteger(eventId) ? eventId : null,
      name: eventName,
    }, kitId != null ? { id: kitId, name: kitName } : null, { method, proofUrl });

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: beneficiary.id,
      beneficiary_id: beneficiary.id, action: 'KIT_GIVEN',
      details: {
        beneficiary_code: beneficiary.beneficiary_code,
        event_name: eventName,
        event_id: Number.isInteger(eventId) ? eventId : null,
        kit_id: kitId,
        kit_name: kitName,
        method,
        proof_url: proofUrl,
      },
      performed_by: givenBy,
    });

    return res.json({ message: 'Kit marked as given', beneficiary: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Random 6-digit OTP for a re-issued kit ("Already collected" → Accept on the
// beneficiaries app). Stored on the row; the accounts panel's Beneficiaries
// section reads it back for verification.
export const sendCollectionOtp = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid beneficiary id' });
    }
    const beneficiary = await getBeneficiaryById(id);
    if (!beneficiary) {
      return res.status(404).json({ message: 'Beneficiary not found' });
    }

    // randomInt is CSPRNG-backed — 100000..999999 gives all 6-digit values.
    const otp = String(randomInt(100000, 1000000));
    const saved = await setBeneficiaryCollectionOtp(id, otp);

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: id,
      beneficiary_id: id, action: 'COLLECTION_OTP_SENT',
      details: { beneficiary_code: beneficiary.beneficiary_code },
      performed_by: req.user?.name || 'system',
    });

    const sentAt = saved.collection_otp_at ? new Date(saved.collection_otp_at) : new Date();
    return res.json({
      message: 'OTP sent',
      otp: saved.collection_otp,
      sent_at: saved.collection_otp_at,
      expires_at: new Date(sentAt.getTime() + COLLECTION_OTP_TTL_MS).toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Verifies the collection OTP entered on the app. Success records
// collection_otp_verified_at, which the kit-given override path requires for
// app sessions; the OTP itself expires 15 minutes after it was sent.
export const verifyCollectionOtp = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid beneficiary id' });
    }
    const beneficiary = await getBeneficiaryById(id);
    if (!beneficiary) {
      return res.status(404).json({ message: 'Beneficiary not found' });
    }

    const otp = String(req.body?.otp ?? '').trim();
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit OTP' });
    }
    if (!beneficiary.collection_otp || !beneficiary.collection_otp_at) {
      return res.status(400).json({ message: 'No OTP generated for this member' });
    }

    const sentAt = new Date(beneficiary.collection_otp_at).getTime();
    if (!Number.isFinite(sentAt) || Date.now() - sentAt > COLLECTION_OTP_TTL_MS) {
      return res.status(400).json({ message: 'OTP expired. Generate a new one.' });
    }

    const expected = Buffer.from(String(beneficiary.collection_otp));
    const given = Buffer.from(otp);
    const matches = expected.length === given.length && timingSafeEqual(expected, given);
    if (!matches) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    const saved = await setBeneficiaryOtpVerified(id);

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: id,
      beneficiary_id: id, action: 'COLLECTION_OTP_VERIFIED',
      details: { beneficiary_code: beneficiary.beneficiary_code },
      performed_by: req.user?.name || 'system',
    });

    return res.json({ verified: true, verified_at: saved.collection_otp_verified_at });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateBeneficiaryController = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.beneficiary_code;
    delete updates.created_at;
    delete updates.created_by;
    // Sub-resource payloads are applied through their own tables below — they
    // are not columns of `beneficiaries` and would break the UPDATE.
    delete updates.disabilities;
    delete updates.category_ids;
    delete updates.family_members;
    delete updates.education;
    delete updates.employment;

    const updated_by = req.user?.name || req.user?.email || 'system';
    updates.updated_by = updated_by;

    const beneficiary = await updateBeneficiary(req.params.id, updates);

    if (req.body.category_ids) {
      await assignCategories(beneficiary.id, req.body.category_ids);
    }

    // The operator app edits disabilities together, so replace the whole set
    // when the payload carries one.
    if (Array.isArray(req.body.disabilities)) {
      const existing = await getDisabilities(beneficiary.id);
      for (const d of existing) {
        await removeDisability(d.id);
      }
      for (const d of req.body.disabilities) {
        await addDisability(beneficiary.id, d);
      }
    }

    await logAuditEvent({
      entity_type: 'beneficiary', entity_id: beneficiary.id,
      beneficiary_id: beneficiary.id, action: 'UPDATED',
      details: { fields: Object.keys(updates) }, performed_by: updated_by,
    });

    return res.json({ message: 'Beneficiary updated', beneficiary });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listAllBeneficiaries = async (req, res) => {
  try {
    const { page, pageSize, search, status, ngo_id, category_id, state, city, kit_given, event_id, event_name, has_otp, occupation, occupation_detail, date_from, date_to } = req.query;

    // Beneficiaries app operators see only their own registrations. The app
    // token carries department 'operator' and no ngo_id (CRM worker tokens
    // always include ngo_id), so old app sessions are covered too.
    let created_by;
    if (isBeneficiariesAppSession(req.user)) {
      let operator = null;
      try {
        operator = await getBnfOperatorBySession(req.user);
      } catch (_) {
        operator = null;
      }
      created_by = operator?.name || req.user?.name || null;
    }

    const result = await listBeneficiaries({
      page: parseInt(page) || 1,
      pageSize: parseInt(pageSize) || 25,
       search, status, ngo_id, category_id, state, city, kit_given, event_id, event_name, has_otp,
       occupation, occupation_detail, date_from, date_to,
      created_by,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Events that appear on kit-given rows — the Kit Given page's dropdown source.
export const listKitGivenEventsController = async (_req, res) => {
  try {
    return res.json(await listKitGivenEvents());
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Distinct occupations on file — the All Beneficiaries occupation filter.
export const listOccupationsController = async (_req, res) => {
  try {
    return res.json(await listBeneficiaryOccupations());
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Export: returns every beneficiary matching the current list filters as
// display-keyed rows so the client can write the .xlsx directly (same shape
// as the Donors export in accountsController).
export const exportBeneficiariesController = async (req, res) => {
  try {
    const { search, status, ngo_id, event_id, event_name, occupation, occupation_detail, date_from, date_to } = req.query;

    let created_by;
    if (isBeneficiariesAppSession(req.user)) {
      let operator = null;
      try {
        operator = await getBnfOperatorBySession(req.user);
      } catch (_) {
        operator = null;
      }
      created_by = operator?.name || req.user?.name || null;
    }

    const rows = await exportBeneficiaries({
      search, status, ngo_id, event_id, event_name, created_by,
      occupation, occupation_detail, date_from, date_to,
    });

    const data = rows.map((b) => ({
      'Beneficiary Code': b.beneficiary_code || '',
      'Full Name': b.full_name || '',
      'Photo': (typeof b.photo === 'string' && b.photo.length <= 32767) ? b.photo : (b.photo ? 'Photo available' : ''),
       'Mobile': b.mobile || '',
       'NGO': b.ngos?.name || '',
      'Gender': b.gender || '',
      'Beneficiary Type': b.beneficiary_type || '',
      'Date of Birth': b.date_of_birth || '',
      'Occupation': b.occupation ? String(b.occupation).split(' - ')[0].trim() : '',
      'Occupation Details': b.occupation ? String(b.occupation).split(' - ').slice(1).join(' - ').trim() : '',
      'Address': b.address_line_1 || '',
      'Area': b.area || '',
      'City': b.city || '',
      'District': b.district || '',
      'State': b.state || '',
      'Pincode': b.pincode || '',
       'Aadhaar Number': b.aadhaar_number || '',
       'Status': b.status || '',
      'Kit Given': b.kit_given ? 'Yes' : 'No',
      'Kit Given On': b.kit_given_at || '',
      'Kit Given By': b.kit_given_by || '',
      'Kit Event': b.kit_event_name || '',
      'Kit': b.kit_name || '',
      'Fingerprint Status': b.fingerprint_status || '',
      'Registration Date': b.registration_date || '',
      'Registered At': b.created_at || '',
    }));

    return res.json({ data, total: data.length });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Full-data download (JSON) — no Excel 32767-char cell limit, so base64 photos
// survive intact. Used for migrating beneficiaries to another database.
export const downloadBeneficiariesController = async (req, res) => {
  try {
    const { search, status, ngo_id, event_id, event_name, occupation, occupation_detail, date_from, date_to } = req.query;
    let created_by;
    if (isBeneficiariesAppSession(req.user)) {
      let operator = null;
      try { operator = await getBnfOperatorBySession(req.user); } catch (_) { operator = null; }
      created_by = operator?.name || req.user?.name || null;
    }
    const rows = await exportBeneficiaries({
      search, status, ngo_id, event_id, event_name, created_by,
      occupation, occupation_detail, date_from, date_to,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="beneficiaries_${new Date().toISOString().slice(0, 10)}.json"`);
    return res.send(JSON.stringify({ data: rows, total: rows.length }, null, 2));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
// One request covers the whole page (`?ids=1,2,3`) instead of N per-row calls.
export const getFingerprintImagesController = async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const images = await getFingerprintImages(ids);
    return res.json({ images });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchBeneficiariesController = async (req, res) => {
  try {
    const { q } = req.query;
    // Beneficiaries app operators only search their own registrations.
    let created_by;
    if (isBeneficiariesAppSession(req.user)) {
      let operator = null;
      try { operator = await getBnfOperatorBySession(req.user); } catch (_) { operator = null; }
      created_by = operator?.name || req.user?.name || null;
    }
    const results = await searchBeneficiaries(q, created_by);
    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getOverview = async (req, res) => {
  try {
    // Optional ?category_id= scopes every stat to one beneficiary type so the
    // dashboard's type filter and the cards show the same numbers.
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    const overview = await getBeneficiaryOverview({ categoryId: Number.isFinite(categoryId) ? categoryId : null });
    return res.json(overview);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchByQR = async (req, res) => {
  try {
    const { token } = req.query;
    const result = await searchByQRToken(token);
    if (!result) return res.status(404).json({ message: 'No beneficiary found for this QR code' });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const searchByMobileController = async (req, res) => {
  try {
    const { mobile } = req.query;
    const results = await searchByMobile(mobile);
    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getAuditTrail = async (req, res) => {
  try {
    const logs = await getAuditLogs(req.params.id);
    return res.json(logs);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Aadhaar QR decoding now lives at POST /api/aadhaar/decode-qr
// (src/aadhaar/routes.js) using @xone-labs/aadharjs with the legacy XML
// decoder as fallback.

// OCRs a photo of an Aadhaar card and returns the same field shape as
// decodeAadhaarQr so the mobile app auto-fills the form. Accepts a base64 JPEG
// (/data:image;base64,... or raw). Uses Gemini vision first, falls back to
// OCR.space + regex heuristics. If everything fails, `detail` explains which
// OCR engine was missing/broken so the operator can fix it server-side.
export const parseAadhaarPhotoController = async (req, res) => {
  try {
    const { image, side } = req.body || {};
    if (!image) {
      return res.status(400).json({ message: 'image is required' });
    }

    // side: 'front' | 'back' | anything else → 'all' (scrape every visible
    // detail, used when a single uploaded Aadhaar document must autofill).
    const sideKey = side === 'front' ? 'front' : side === 'back' ? 'back' : 'all';
    const { fields, via, errors } = await extractAadhaarFromPhoto(String(image), sideKey);
    if (!fields || Object.keys(fields).length === 0) {
      return res.status(422).json({
        message: 'Could not read this card. Make sure the photo is sharp, well-lit, and shows the whole Aadhaar card.',
        detail: errors.join('; ') || 'No OCR engine returned usable text.',
      });
    }

    await logAuditEvent({
      entity_type: 'aadhaar_scan',
      action: 'AADHAAR_PHOTO_SCANNED',
      details: { found: Object.keys(fields).filter((k) => fields[k]).length, via },
      performed_by: req.user?.name || req.user?.email || 'system',
    });

    const discarded = [...new Set([...ALL_KEYS].filter((k) => !(k in fields)))];
    console.log(`[aadhaar OCR] via=${via} found=${Object.keys(fields).join(',')} missing=${discarded.join(',')}`);
    return res.json(fields);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
