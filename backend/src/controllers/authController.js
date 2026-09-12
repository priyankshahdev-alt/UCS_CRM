import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../config/db.js';
import { getWorkerByLoginId, getWorkerById, updateWorker } from '../models/workerModel.js';
import { getUserByEmail, getUserByName, getUserById, updateUser } from '../models/userModel.js';
import { getHRByEmail, getHRById, updateHR } from '../models/hrModel.js';
import { findValidImpersonationCode, markImpersonationCodeUsed } from '../models/impersonationCodeModel.js';
import { releaseOperatorSessions, getActiveSessionsForTarget, claimStations } from '../models/workAsSessionModel.js';

dotenv.config();

// CRMs / admin and salary portals get a rolling 24h session; the mobile
// (Flutter) worker login override below emits tokens with no expiry.
const TOKEN_EXPIRY = '24h';

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const token = jwt.sign(
        { id: 0, email, role: 'super_admin', name: 'Super Admin' },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );
      return res.json({ token, role: 'super_admin', user: { name: 'Super Admin', email, role: 'super_admin' }, message: 'Login successful' });
    }
    return res.status(401).json({ message: 'Invalid admin credentials' });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed' });
  }
};

// Restricted login for the salary calculator app — only the Accounts
// department (workers with department account/accounts/admin or users with
// role accounts) and the super admin may log in.
export const salaryLogin = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Identifier and password are required' });
    }
    const isEmail = identifier.includes('@');

    if (
      isEmail &&
      identifier === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const role = 'super_admin';
      const token = jwt.sign(
        { id: 0, email: identifier, role, name: 'Super Admin' },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );
      return res.json({ token, role, user: { name: 'Super Admin', email: identifier, role }, message: 'Login successful' });
    }

    const deptIsAccount = (d) => {
      const x = String(d || '').toLowerCase().trim();
      return x === 'account' || x === 'accounts' || x === 'admin';
    };

    const worker = await getWorkerByLoginId(identifier);
    if (worker) {
      if (worker.is_active === false || worker.employment_status === 'terminated') {
        return res.status(403).json({ message: 'Account is deactivated' });
      }
      if (!deptIsAccount(worker.department)) {
        return res.status(403).json({ message: 'Access denied. Only the Accounts department or Super Admin can log in.' });
      }
      const isMatch = await bcrypt.compare(password, worker.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      const role = 'accounts';
      const token = jwt.sign(
        { id: worker.id, login_id: worker.login_id, ngo_id: worker.ngo_id, role, department: worker.department },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );
      return res.json({
        token,
        role,
        user: { id: worker.id, name: worker.name, email: worker.email, login_id: worker.login_id, department: worker.department },
        message: 'Login successful',
      });
    }

    const userByEmail = isEmail ? await getUserByEmail(identifier) : null;
    const userByName = !isEmail ? await getUserByName(identifier) : null;
    const userRow = userByEmail || userByName;
    if (userRow) {
      if (userRow.is_active === false) {
        return res.status(403).json({ message: 'Account is deactivated' });
      }
      if (userRow.role !== 'accounts' && userRow.role !== 'super_admin') {
        return res.status(403).json({ message: 'Access denied. Only the Accounts department or Super Admin can log in.' });
      }
      const isMatch = await bcrypt.compare(password, userRow.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      const role = userRow.role;
      const token = jwt.sign(
        { id: userRow.id, ngo_id: userRow.ngo_id, email: userRow.email, role, name: userRow.name },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );
      const { password_hash, ...safeUser } = userRow;
      return res.json({ token, role, user: safeUser, message: 'Login successful' });
    }

    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed' });
  }
};

export const unifiedLogin = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    console.log('[LOGIN] identifier:', JSON.stringify(identifier), 'endsWith @ufs:', identifier?.endsWith('@ufs'));
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Identifier and password are required' });
    }

    const isUfsLogin = identifier.endsWith('@ufs');
    const isEmail = !isUfsLogin && identifier.includes('@');
    // /auth/worker/login is used by the Flutter apps -> token never expires;
    // every CRM login (/auth/login) -> 24h.
    const expiry = req.route?.path === '/worker/login' ? undefined : TOKEN_EXPIRY;
    const signOptions = expiry ? { expiresIn: expiry } : {};

    if (isUfsLogin) {
      const worker = await getWorkerByLoginId(identifier);
      if (!worker) {
        return res.status(401).json({ message: 'Invalid login ID' });
      }
      if (worker.is_active === false || worker.employment_status === 'terminated') {
        return res.status(403).json({ message: 'Account is deactivated' });
      }
      const isMatch = await bcrypt.compare(password, worker.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      const dept = (worker.department || '').toLowerCase().trim();
      let role;
      if (dept === 'hr') role = 'hr';
      else if (dept.includes('recruit')) role = 'recruiter';
      else if (dept === 'admin') role = 'accounts';
      else if (dept === 'fro') role = 'fro';
      else if (dept === 'ngo admin') role = 'admin';
      else if (dept === 'digital' || dept.includes('develop')) role = 'digital';
      else if (dept.includes('event')) role = 'event_head';
      else role = 'worker';
      const token = jwt.sign(
        { id: worker.id, login_id: worker.login_id, ngo_id: worker.ngo_id, name: worker.name, role, department: worker.department },
        process.env.JWT_SECRET,
        signOptions
      );
      return res.json({
        token,
        role,
        user: { id: worker.id, name: worker.name, email: worker.email, login_id: worker.login_id, ngo_id: worker.ngo_id, gender: worker.gender, dob: worker.dob, department: worker.department },
        message: 'Login successful',
      });
    }

    if (isEmail) {
      if (
        identifier === process.env.ADMIN_EMAIL &&
        password === process.env.ADMIN_PASSWORD
      ) {
        const token = jwt.sign(
          { id: 0, email: identifier, role: 'super_admin', name: 'Super Admin' },
          process.env.JWT_SECRET,
          signOptions
        );
        return res.json({ token, role: 'super_admin', user: { name: 'Super Admin', email: identifier, role: 'super_admin' }, message: 'Login successful' });
      }

      if (
        identifier === process.env.USER_EMAIL &&
        password === process.env.USER_PASSWORD
      ) {
        const token = jwt.sign(
          { id: -1, email: identifier, role: 'user', name: 'User' },
          process.env.JWT_SECRET,
          signOptions
        );
        return res.json({ token, role: 'user', user: { name: 'User', email: identifier, role: 'user' }, message: 'Login successful' });
      }

      const user = await getUserByEmail(identifier);
      if (user) {
        if (user.is_active === false) {
          return res.status(403).json({ message: 'Account is deactivated' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
          return res.status(401).json({ message: 'Invalid password' });
        }
        const token = jwt.sign(
          { id: user.id, ngo_id: user.ngo_id, email: user.email, role: user.role, name: user.name },
          process.env.JWT_SECRET,
          signOptions
        );
        const { password_hash, ...safeUser } = user;
        return res.json({ token, role: user.role, user: safeUser, message: 'Login successful' });
      }

      const hr = await getHRByEmail(identifier);
      if (hr) {
        if (hr.is_active === false) {
          return res.status(403).json({ message: 'Account is deactivated' });
        }
        const isMatch = await bcrypt.compare(password, hr.password_hash);
        if (!isMatch) {
          return res.status(401).json({ message: 'Invalid password' });
        }
        const token = jwt.sign(
          { id: hr.id, ngo_id: hr.ngo_id, email: hr.email, role: 'hr', name: hr.name },
          process.env.JWT_SECRET,
          signOptions
        );
        const { password_hash, ...safeHR } = hr;
        return res.json({ token, role: 'hr', user: safeHR, message: 'Login successful' });
      }

      // Allow workers to log in with custom ids like ngo@fro (not @ufs). This covers renamed NGO admin logins.
      const workerByLogin = await getWorkerByLoginId(identifier);
      if (workerByLogin) {
        if (workerByLogin.is_active === false || workerByLogin.employment_status === 'terminated') {
          return res.status(403).json({ message: 'Account is deactivated' });
        }
        const isMatch = await bcrypt.compare(password, workerByLogin.password);
        if (!isMatch) {
          return res.status(401).json({ message: 'Invalid password' });
        }
        const dept = (workerByLogin.department || '').toLowerCase().trim();
        let wRole;
        if (dept === 'hr') wRole = 'hr';
        else if (dept.includes('recruit')) wRole = 'recruiter';
        else if (dept === 'admin') wRole = 'accounts';
        else if (dept === 'fro') wRole = 'fro';
        else if (dept === 'ngo admin') wRole = 'admin';
        else if (dept === 'digital' || dept.includes('develop')) wRole = 'digital';
        else if (dept.includes('event')) wRole = 'event_head';
        else wRole = 'worker';
        const token = jwt.sign(
          { id: workerByLogin.id, login_id: workerByLogin.login_id, ngo_id: workerByLogin.ngo_id, name: workerByLogin.name, role: wRole, department: workerByLogin.department },
          process.env.JWT_SECRET,
          signOptions
        );
        return res.json({
          token,
          role: wRole,
          user: { id: workerByLogin.id, name: workerByLogin.name, email: workerByLogin.email, login_id: workerByLogin.login_id, ngo_id: workerByLogin.ngo_id, department: workerByLogin.department },
          message: 'Login successful',
        });
      }

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const userFromName = await getUserByName(identifier);
    if (userFromName) {
      if (userFromName.is_active === false) {
        return res.status(403).json({ message: 'Account is deactivated' });
      }
      const isMatch = await bcrypt.compare(password, userFromName.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      const token = jwt.sign(
        { id: userFromName.id, ngo_id: userFromName.ngo_id, email: userFromName.email, role: userFromName.role, name: userFromName.name },
        process.env.JWT_SECRET,
        signOptions
      );
      const { password_hash, ...safeUser } = userFromName;
      return res.json({ token, role: userFromName.role, user: safeUser, message: 'Login successful' });
    }

    const worker = await getWorkerByLoginId(identifier);
    if (!worker) {
      return res.status(401).json({ message: 'Invalid login ID' });
    }
    if (worker.is_active === false || worker.employment_status === 'terminated') {
      return res.status(403).json({ message: 'Account is deactivated' });
    }
    const isMatch = await bcrypt.compare(password, worker.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    const dept = (worker.department || '').toLowerCase().trim();
    let role;
    if (dept === 'hr') role = 'hr';
    else if (dept.includes('recruit')) role = 'recruiter';
    else if (dept === 'admin') role = 'accounts';
    else if (dept === 'fro') role = 'fro';
    else if (dept === 'ngo admin') role = 'admin';
    else if (dept === 'digital' || dept.includes('develop')) role = 'digital';
    else if (dept.includes('event')) role = 'event_head';
    else role = 'worker';
    const token = jwt.sign(
      { id: worker.id, login_id: worker.login_id, ngo_id: worker.ngo_id, role, department: worker.department },
      process.env.JWT_SECRET,
      signOptions
    );
    return res.json({
      token,
      role,
      user: { id: worker.id, name: worker.name, email: worker.email, login_id: worker.login_id, ngo_id: worker.ngo_id, gender: worker.gender, dob: worker.dob, department: worker.department },
      message: 'Login successful',
    });
  } catch (error) {
    console.error('[LOGIN] Error:', error);
    return res.status(500).json({ message: 'Login failed', detail: error.message });
  }
};

// Super admin, NGO admin, or FRO may "work as" an FRO. The impersonated token
// keeps the operator's identity (imposter_id) so collection credit, accounts
// verification, and notifications follow the operator, while donor/assignment
// ownership follows the impersonated FRO (token id). Absconded / deactivated
// FROs (is_active=false, employment_status='absconded') remain coverable via
// work-as — direct login as the absconder stays blocked, but replacement FROs
// take over their stations through this flow.
export const impersonateFRO = async (req, res) => {
  try {
    const { worker_id } = req.body;
    if (!worker_id) return res.status(400).json({ message: 'worker_id is required' });

    // workers.id is a UUID — never parseInt it (that would truncate ids like
    // "108a3f4e-..." to 108 and fail the uuid comparison in Postgres).
    const target = await getWorkerById(String(worker_id).trim());
    if (!target) return res.status(404).json({ message: 'Worker not found' });

    const targetDept = String(target.department || '').toLowerCase().trim();
    if (targetDept !== 'fro') {
      return res.status(400).json({ message: 'Only FRO workers can be impersonated' });
    }

    // Any staff role may work as any FRO (the list shows everyone): each switch
    // is gated by a fresh single-use admin-generated code below, which is the
    // real authorization. Deactivated / absconded FROs intentionally stay
    // selectable via work-as so another FRO can cover their stations; the
    // absconder's own login remains blocked (is_active=false).
    const operatorRole = req.user.role;
    if (!['fro', 'super_admin', 'master', 'admin', 'accounts', 'hr'].includes(operatorRole)) {
      return res.status(403).json({ message: 'Not allowed to impersonate an FRO' });
    }

    // "Who are you?" step: the operator optionally identifies which FRO worker
    // they are so credit goes to the correct person. When imposter_worker_id is
    // provided, validate it and use it as the imposter identity in the JWT.
    let imposterId = req.user.id;
    let imposterName = req.user.name || '';
    // Resolve the operator's display name. New worker tokens carry it, but older
    // sessions / admin accounts may not — fall back to a DB lookup.
    if (!imposterName && req.user.id != null) {
      const opWorker = await getWorkerById(String(req.user.id));
      if (opWorker?.name) imposterName = opWorker.name;
      else {
        const opUser = await getUserById(req.user.id);
        if (opUser?.name) imposterName = opUser.name;
      }
    }
    const { imposter_worker_id } = req.body;
    if (imposter_worker_id && String(imposter_worker_id) !== String(req.user.id)) {
      const imposterWorker = await getWorkerById(String(imposter_worker_id).trim());
      if (!imposterWorker) return res.status(404).json({ message: 'Acting FRO worker not found' });
      const impDept = String(imposterWorker.department || '').toLowerCase().trim();
      if (impDept !== 'fro') return res.status(400).json({ message: 'Acting FRO must be an FRO worker' });
      imposterId = imposterWorker.id;
      imposterName = imposterWorker.name || '';
    } else if (imposter_worker_id && String(imposter_worker_id) === String(req.user.id)) {
      // Picking yourself — use the JWT's existing identity, no worker validation needed.
    }

    // Work-as FRO requires a valid admin-generated 4-digit code (single use, 5-min expiry).
    const { code } = req.body;
    const codeStr = String(code || '').trim();
    if (!/^\d{4}$/.test(codeStr)) {
      return res.status(400).json({ message: 'A 4-digit code is required to impersonate an FRO' });
    }

    const codeRow = await findValidImpersonationCode(codeStr);
    if (!codeRow) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    const used = await markImpersonationCodeUsed(codeRow.id, req.user.id || null);
    if (!used) {
      return res.status(409).json({ message: 'Code was already used. Generate a new one.' });
    }

    // Station-scoped work-as: the operator picks which of the target's stations
    // they will work. Claimed pairs are locked for the session duration so
    // another operator acting as the same FRO cannot take them too. Omitted
    // stations field = unrestricted (legacy behaviour).
    let actStations = null;
    const rawStations = Array.isArray(req.body?.stations) ? req.body.stations : null;
    if (rawStations) {
      const { data: owned, error: ownErr } = await db
        .from('fro_station_assignments')
        .select('station, ngo_id')
        .eq('fro_worker_id', target.id);
      if (ownErr) throw ownErr;
      const ownedKeys = new Map((owned || []).map((a) => [`${a.ngo_id ?? ''}|${String(a.station).trim()}`, { ngo_id: a.ngo_id, station: a.station }]));
      if (ownedKeys.size === 0) {
        return res.status(400).json({ message: `${target.name} has no stations assigned to work on` });
      }

      let wantedPairs;
      if (rawStations.includes('all')) {
        wantedPairs = [...ownedKeys.values()];
      } else {
        wantedPairs = [];
        for (const r of rawStations) {
          // Strict shape check: rejects PowerShell/JSON-mangled entries like
          // "@{ngo_id=...;station=...}" that would otherwise poison the JWT
          // claim and silently blind the whole session.
          if (!r || typeof r !== 'object' || r.station == null) {
            return res.status(400).json({ message: 'Invalid stations payload: each entry must be {ngo_id, station}' });
          }
          const key = `${r.ngo_id ?? ''}|${String(r.station).trim()}`;
          if (!ownedKeys.has(key)) {
            return res.status(400).json({ message: `Station ${r.station} is not assigned to ${target.name}` });
          }
          wantedPairs.push(ownedKeys.get(key));
        }
      }

      // Switching targets frees this operator's previous work-as sessions first.
      await releaseOperatorSessions(req.user.id);
      const claim = await claimStations({
        targetWorkerId: target.id,
        pairs: wantedPairs,
        operatorUserId: req.user.id,
        operatorName: imposterName,
      });
      if (claim.conflict?.length > 0) {
        return res.status(409).json({
          message: 'Some selected stations are already being worked by others',
          conflicts: claim.conflict,
        });
      }
      actStations = claim.ok;
    } else {
      // Unrestricted switch still supersedes any earlier scoped session.
      await releaseOperatorSessions(req.user.id);
    }

    const tokenPayload = {
      id: target.id,
      login_id: target.login_id,
      ngo_id: target.ngo_id,
      role: 'fro',
      department: target.department || 'fro',
      name: target.name,
      impersonation: true,
      imposter_id: imposterId,
      imposter_name: imposterName,
    };
    if (actStations && actStations.length > 0) tokenPayload.act_stations = actStations;

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    const userPayload = {
      id: target.id,
      name: target.name,
      email: target.email,
      login_id: target.login_id,
      ngo_id: target.ngo_id,
      role: 'fro',
      department: target.department,
      impersonation: true,
      imposter_id: imposterId,
      imposter_name: imposterName,
    };
    if (actStations && actStations.length > 0) userPayload.act_stations = actStations;

    return res.json({
      token,
      role: 'fro',
      user: userPayload,
      message: `Working as ${target.name}`,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// FROs the current user is allowed to impersonate (for the "Work as" picker).
// Every worker whose department normalises to 'fro' is listed — including
// deactivated ones, which the UI marks Inactive. btrim/lower matching so
// padded or differently-cased departments never hide a name. Every FRO is
// listed regardless of NGO or active status — each switch is individually
// authorized by a fresh admin-generated 4-digit code anyway.
export const getFroWorkersForImpersonation = async (req, res) => {
  try {
    const { rows, error } = await db._pool.query(
      `SELECT id, name, login_id, ngo_id, department, is_active, employment_status
         FROM workers
        WHERE lower(btrim(coalesce(department, ''))) = 'fro'
        ORDER BY name ASC`
    );
    if (error) throw error;

    return res.json({ workers: (rows || []).filter((w) => String(w.id) !== String(req.user.id)) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Stations of the FRO the operator wants to work as, with live availability:
// which pairs are already claimed by other operators (and by whom). Powers the
// station picker in the Work As flow.
export const getFroWorkAsStations = async (req, res) => {
  try {
    const { workerId } = req.params;
    const target = await getWorkerById(String(workerId || '').trim());
    if (!target) return res.status(404).json({ message: 'Worker not found' });

    const targetDept = String(target.department || '').toLowerCase().trim();
    if (targetDept !== 'fro') {
      return res.status(400).json({ message: 'Only FRO workers can be worked as' });
    }

    const { data: assigns, error: aErr } = await db
      .from('fro_station_assignments')
      .select('station, ngo_id')
      .eq('fro_worker_id', target.id)
      .order('station', { ascending: true });
    if (aErr) throw aErr;

    let ngoNames = {};
    const ngoIds = [...new Set((assigns || []).map((a) => a.ngo_id).filter(Boolean))];
    if (ngoIds.length > 0) {
      const { data: ngos } = await db.from('ngos').select('id, name').in('id', ngoIds);
      for (const n of ngos || []) ngoNames[n.id] = n.name;
    }

    const sessions = await getActiveSessionsForTarget(target.id);
    const holderByKey = new Map();
    for (const s of sessions) {
      for (const st of s.stations || []) {
        holderByKey.set(`${st.ngo_id ?? ''}|${String(st.station ?? '').trim()}`, {
          taken_by: s.operator_name || 'another operator',
          mine: String(s.operator_user_id) === String(req.user.id),
        });
      }
    }

    const stations = (assigns || []).map((a) => {
      const key = `${a.ngo_id ?? ''}|${String(a.station).trim()}`;
      const holder = holderByKey.get(key) || null;
      return {
        station: a.station,
        ngo_id: a.ngo_id,
        ngo_name: ngoNames[a.ngo_id] || null,
        available: !holder,
        taken_by: holder?.taken_by || null,
        mine: holder?.mine || false,
      };
    });

    return res.json({
      stations,
      all_taken: stations.length > 0 && stations.every((s) => !s.available),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Release every active work-as session the caller holds (Exit work-as button).
export const releaseWorkAs = async (req, res) => {
  try {
    const operatorId = req.user.impersonation && req.user.imposter_id ? req.user.imposter_id : req.user.id;
    const released = await releaseOperatorSessions(operatorId);
    return res.json({ message: 'Work-as sessions released', released });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// POST /auth/change-password  { currentPassword, newPassword }
// Lets any DB-backed user (worker | users | hrs) change their own password by
// confirming the current one. Super admin (env-based) and the env 'user' have no
// DB row, so they are rejected — their credentials are managed elsewhere.
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    // Super admin & env user have no DB-backed identity to update.
    if (req.user.role === 'super_admin' || req.user.id == null || req.user.id === -1 || req.user.id === 0) {
      return res.status(403).json({ message: 'Password change is not supported for this account.' });
    }

    let source = null; // { id, table, passwordColumn, currentHash }
    if (req.user.login_id) {
      const worker = await getWorkerByLoginId(req.user.login_id) || await getWorkerById(req.user.id);
      if (worker) source = { id: worker.id, update: (h) => updateWorker(worker.id, { password: h }), currentHash: worker.password };
    } else if (req.user.role === 'hr') {
      const hr = await getHRById(req.user.id) || await getHRByEmail(req.user.email);
      if (hr) source = { id: hr.id, update: (h) => updateHR(hr.id, { password_hash: h }), currentHash: hr.password_hash };
    } else {
      const user = await getUserById(req.user.id) || await getUserByEmail(req.user.email);
      if (user) source = { id: user.id, update: (h) => updateUser(user.id, { password_hash: h }), currentHash: user.password_hash };
    }

    if (!source) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, source.currentHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    await source.update(hashed);

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
