import { getApprovedHalfDayLeave } from '../models/leaveModel.js';
import { getWorkerById } from '../models/workerModel.js';
import { getSetting } from '../models/settingsModel.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstTime(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function istDateStr(date = new Date()) {
  const ist = getIstTime(date);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

async function getOfficeStart(workerId) {
  try {
    const worker = await getWorkerById(workerId);
    if (worker?.shift_start_time) {
      const [hour, minute] = worker.shift_start_time.split(':').map(Number);
      return { hour: hour || 10, minute: minute || 0 };
    }
  } catch (_) {}
  const value = await getSetting('office_start_time');
  if (!value) return { hour: 10, minute: 0 };
  const [hour, minute] = value.split(':').map(Number);
  return { hour: hour || 10, minute: minute || 0 };
}

async function getOfficeEnd(workerId) {
  try {
    const worker = await getWorkerById(workerId);
    if (worker?.shift_end_time) {
      const [hour, minute] = worker.shift_end_time.split(':').map(Number);
      return { hour: hour || 19, minute: minute || 0 };
    }
  } catch (_) {}
  const value = await getSetting('office_end_time');
  if (!value) return { hour: 19, minute: 0 };
  const [hour, minute] = value.split(':').map(Number);
  return { hour: hour || 19, minute: minute || 0 };
}

export async function calculateAttendanceStatus({ workerId, punchInTime, punchOutTime }) {
  const date = istDateStr(new Date(punchInTime));
  const approvedHalfDay = await getApprovedHalfDayLeave(workerId, date);
  if (approvedHalfDay) return 'half-day';

  const start = await getOfficeStart(workerId);
  const startMinutes = start.hour * 60 + start.minute;
  const punchIn = getIstTime(new Date(punchInTime));
  const punchInMinutes = punchIn.getUTCHours() * 60 + punchIn.getUTCMinutes();
  const lateMinutes = Math.max(0, punchInMinutes - startMinutes);
  if (lateMinutes >= 240) return 'half-day';

  if (punchOutTime) {
    const end = await getOfficeEnd(workerId);
    const endMinutes = end.hour * 60 + end.minute;
    const punchOut = getIstTime(new Date(punchOutTime));
    const punchOutMinutes = punchOut.getUTCHours() * 60 + punchOut.getUTCMinutes();
    if (endMinutes - punchOutMinutes >= 180) return 'half-day';
  }

  return lateMinutes > 0 ? 'late' : 'present';
}
