import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHR } from '../store';
import { useSalaryPrivacy } from '../../../context/SalaryPrivacyContext';
import { Who, Avatar, Dropdown } from './ui';
import { Plus, Trash, Check, Flask } from '../icons';
import { api } from '../../../api/auth';
import * as XLSX from 'xlsx-js-style';
import JSZip from 'jszip';

function load() {
  try { return JSON.parse(sessionStorage.getItem('wrk') || '{}'); } catch { return {}; }
}
function save(v) {
  try { const d = load(); sessionStorage.setItem('wrk', JSON.stringify({ ...d, ...v })); } catch (e) { console.error('Error:', e.message); }
}

function isComplete(w) {
  const val = (v) => v && typeof v === 'string' && v.trim() !== '';
  const edu = w.education || w.education_details || [];
  const firstEdu = edu[0] || {};
  const fam = w.family || w.family_details || [];
  const firstFam = fam[0] || {};
  return (
    val(w.name) &&
    val(w.father_husband_name) &&
    val(w.address) &&
    val(w.phone) &&
    val(w.dob) &&
    val(w.marital_status) &&
    val(w.email) &&
    val(w.gender) &&
    val(w.aadhar_number) &&
    val(firstEdu.degree) &&
    val(firstEdu.institution) &&
    val(firstEdu.year_of_passing || firstEdu.year) &&
    val(firstEdu.percentage) &&
    val(firstFam.name) &&
    val(firstFam.relationship) &&
    val(firstFam.occupation) &&
    val(firstFam.phone)
  );
}

function allFormsHTML(w) {
  const tc = (s) => (s || '').replace(/\b\w/g, c => c.toUpperCase());
  const edu = w.education || w.education_details || [];
  const fam = w.family || w.family_details || [];
  const orgs = w.previous_organizations || [];
  const dd = w.declaration_date || w.date_of_joining || w.created_at || '';
  const pl = w.declaration_place || 'Mumbai';
  const addrWrap = (s) => s ? (s.match(/.{1,35}/g) || []).join('\n') : '';
  const eRow = edu.length ? edu.slice(0, 1).map(e => `<tr><td>${tc(e.degree)}</td><td>${tc(e.institution)}</td><td colspan="2">${e.year_of_passing || e.year || ''}</td><td>${e.percentage || ''}</td></tr>`).join('') : '<tr><td></td><td></td><td colspan="2"></td><td></td></tr>';
  const oRows = (orgs.length ? orgs.slice(0, 3) : [{}, {}, {}]).map((o, i) => `<tr><td style="text-align:center">${i + 1}</td><td style="height:40px">${tc(o.name || o.organization_name)}</td><td>${tc(o.role || o.designation)}</td><td style="text-align:center">${o.from_year || o.fromYear || ''}</td><td style="text-align:center">${o.to_year || o.toYear || ''}</td></tr>`).join('');
  const fRows = [0, 1, 2].map(i => { const f = fam[i] || {}; return `<tr><td style="text-align:center">${i + 1}</td><td style="height:35px;text-align:center">${f.name ? tc(f.name) : '-'}</td><td style="text-align:center">${f.relationship ? tc(f.relationship) : '-'}</td><td style="text-align:center">${f.occupation ? tc(f.occupation) : '-'}</td><td style="text-align:center">${f.phone || '-'}</td></tr>`; }).join('');
  const d = dd ? new Date(dd).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tc(w.name)} - All Forms</title>
<style>
@media print{body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:0}}
.pb{page-break-before:always}
${t1CSS()}${t2CSS()}${t4CSS()}${t5CSS()}${t6CSS()}${t6bCSS()}
</style></head><body>
${t1Body(w, tc, addrWrap, eRow, oRows, fRows)}
<div class="pb"></div>${t2Body()}
<div class="pb"></div>${t4Body()}
<div class="pb"></div>${t5Body(w, tc)}
<div class="pb"></div>${t6Body(w, tc, d, pl)}
<div class="pb"></div>${t6bBody(w, tc, d, pl)}
</body></html>`;
}
function t1CSS(){return`.t1 *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}.t1{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:12px 14px;overflow:hidden;display:flex;flex-direction:column}.t1 h1{text-align:center;font-size:34px;font-family:Georgia,serif}.t1 .subtitle{text-align:center;font-size:10px;margin-bottom:2px}.t1 .top-line{border-top:3px solid #7d1e1e;margin:3px 0}.t1 .form-title{text-align:center;font-size:24px;font-weight:bold;text-decoration:underline;margin-bottom:12px}.t1 table{width:100%;border-collapse:collapse}.t1 td,.t1 th{border:1px solid #666;padding:12px 8px;vertical-align:top}.t1 .section{background:#d8d8d8;font-weight:bold;font-size:18px}.t1 .label{font-weight:bold;width:25%;white-space:nowrap}.t1 .photo{width:100px;text-align:center;vertical-align:middle;font-weight:bold;font-size:27px;min-height:220px;height:220px}.t1 .edu td{height:45px}.t1 .footer{border-top:2px solid #7b2020;margin-top:auto;padding-top:3px;text-align:center;font-size:8pt;line-height:1.3}`}
function t2CSS(){return`.t2 *{box-sizing:border-box}.t2{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:12px 14px;font-family:"Times New Roman",serif;overflow:hidden;display:flex;flex-direction:column}.t2 h1{text-align:center;margin:0 0 1px;font-size:24pt}.t2 .sub{text-align:center;font-size:10pt;margin:0 0 3px}.t2 .red{height:2px;background:#7b2020;margin:2px 0 6px}.t2 .sec{color:#7b2020;font-weight:bold;font-size:12pt;margin-top:12px}.t2 .title{text-align:center;color:#1f3f73;font-size:15pt;font-weight:bold;margin:12px 0}.t2 p{font-size:10pt;line-height:1.55;text-align:justify;margin:3px 0}.t2 .footer{border-top:2px solid #7b2020;margin-top:auto;padding-top:3px;text-align:center;font-size:9pt;line-height:1.3}`}
function t4CSS(){return`.t4 *{box-sizing:border-box}.t4{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:8mm 12mm;font-family:"Times New Roman",serif;overflow:hidden;display:flex;flex-direction:column}.t4 h1{text-align:center;margin:0 0 1px;font-size:24pt}.t4 .sub{text-align:center;font-size:10pt;margin:0 0 3px}.t4 .red{height:2px;background:#7b2020;margin:1px 0 4px}.t4 .sec{color:#7b2020;font-weight:bold;font-size:12pt;margin-top:5px}.t4 p{font-size:10pt;line-height:1.25;text-align:justify;margin:1.5px 0}.t4 .footer{border-top:2px solid #7b2020;margin-top:auto;padding-top:3px;text-align:center;font-size:10pt;line-height:1.3}`}
function t5CSS(){return`.t5 *{box-sizing:border-box;font-family:'Times New Roman',Times,serif}.t5{width:210mm;height:297mm;margin:40px auto;background:#fff;border:8px double #000;padding:2mm 8mm 4mm 8mm;position:relative;overflow:hidden;display:flex;flex-direction:column}.t5 h1{margin:0;text-align:center;font-size:25px;font-family:'Times New Roman',Times,serif;font-weight:bold;line-height:1.1}.t5 .sub{text-align:center;font-size:9px;margin:0 0 0.3mm 0;line-height:1.1;letter-spacing:0.3px}.t5 .redline{border-top:2px solid #7a2020;margin:0.5mm auto;width:100%}.t5 p{font-size:11pt;line-height:1.3;text-align:justify;margin:2px 0}.t5 .section{color:#7a2020;font-weight:bold;font-size:12pt;margin:4px 0 2px 0}.t5 table{width:100%;border-collapse:collapse;margin:1.5px 0;page-break-inside:avoid}.t5 th,.t5 td{border:1px solid #000;padding:3px 5px;font-size:10.5pt;vertical-align:top;text-align:left}.t5 th{background:#d9d9d9;text-align:left}.t5 .sign{display:flex;justify-content:space-between;gap:20px;margin:2px 0}.t5 .sign .field{flex:1}.t5 .sign .field:first-child{margin-right:6px}.t5 .sign .field:last-child{margin-left:6px}.t5 .line{border-bottom:1px solid #000;height:15px;padding-left:4px}.t5 .consent{text-align:center;font-size:12px;font-weight:bold;color:#1f3f73;margin:4px 0 2px 0}.t5 .row{display:flex;align-items:center;margin:2px 0;font-size:10.5pt}.t5 .row .label{font-weight:bold;white-space:nowrap;margin-right:4px}.t5 .row .line{flex:1;border-bottom:1px solid #000;min-height:13px;padding-left:4px}.t5 .footer{border-top:2px solid #7b2020;margin-top:auto;padding-top:2px;text-align:center;font-size:8.5pt;line-height:1.3}.t5 .footer-sep{display:none}`}
function t6CSS(){return`.t6 *{box-sizing:border-box}.t6{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;position:relative;padding:10px 18px 12px 18px;overflow:hidden;font-family:"Times New Roman",serif;display:flex;flex-direction:column}.t6 .inner{border:1px solid #222;padding:6px 16px 10px 16px;flex:1;display:flex;flex-direction:column}.t6 h1{margin:0;text-align:center;font-size:34px;font-weight:700}.t6 .sub{text-align:center;font-size:15px;margin-top:4px}.t6 .red{height:3px;background:#7f2d2d;margin:5px 8px 4px}.t6 p{margin:2px 0;font-size:16px;line-height:1.3;text-align:justify}.t6 .b{font-weight:bold}.t6 .blue{font-size:26px;color:#29446f;text-align:center;font-weight:bold;margin:10px 0 6px}.t6 .row{font-size:16px;margin:1.5px 0}.t6 .line{display:inline-block;border-bottom:1px solid #000;min-width:120px;height:15px;vertical-align:bottom}.t6 .long{min-width:230px}.t6 .med{min-width:180px}.t6 .small{min-width:80px}.t6 .sigwrap{display:flex;justify-content:space-between;margin-top:20px}.t6 .sig{width:260px}.t6 .sig .l{border-bottom:1px solid #000;height:22px}.t6 .sig div:last-child{text-align:left;font-size:15px;margin-top:3px}.t6 .footer{margin-top:auto;border-top:2px solid #8b3434;padding-top:4px;text-align:center;font-size:14px;color:#333}`}
function t6bCSS(){return`.t6b *{margin:0;padding:0;box-sizing:border-box;font-family:"Times New Roman",Times,serif}.t6b{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:12px 14px;overflow:hidden;display:flex;flex-direction:column}.t6b h1{text-align:center;font-size:26px;font-weight:bold;margin-bottom:4px}.t6b .top-line{border-top:3px solid #7d1e1e;margin:6px 0 8px}.t6b .subtitle{text-align:center;font-size:10px;margin-bottom:12px}.t6b .form-title{text-align:center;font-size:22px;font-weight:bold;text-decoration:underline;margin-bottom:16px;color:#1f3f73}.t6b p{margin:8px 0;font-size:13pt;line-height:1.4;text-align:justify}.t6b .agreement{margin:12px 0;font-size:13pt;font-weight:bold}.t6b .two-column{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:10px 0}.t6b .two-column ul{margin:0;padding-left:30px;list-style-type:disc}.t6b .two-column li{margin-bottom:8px;font-size:13pt;line-height:1.4}.t6b .section{background:#d8d8d8;font-weight:bold;font-size:15px;padding:6px 8px;margin:12px 0 8px}.t6b .field{display:flex;align-items:center;margin:8px 0;font-size:13pt}.t6b .label{font-weight:bold;min-width:200px;padding-right:8px;font-size:13pt}.t6b .line{flex:1;border-bottom:1px solid #000;height:20px}.t6b .two{display:flex;gap:30px}.t6b .two .field{flex:1}.t6b .footer{border-top:2px solid #7b2020;margin-top:auto;padding-top:8px;text-align:center;font-size:8.5pt;line-height:1.35}`}
function t1Body(w,tc,aw,er,or,fr){return`<div class="t1"><h1>Being Sevak Charitable Trust</h1><div class="top-line"></div><div class="subtitle">Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G</div><div class="form-title">VOLUNTEER JOINING FORM</div><table><tbody><tr><td colspan="3" class="section">PERSONAL DETAILS</td></tr><tr><td class="label">Name :</td><td style="font-weight:600">${tc(w.name)}</td><td rowspan="4" class="photo">${w.photo_url?'<img src="'+w.photo_url+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block;margin:auto" />':'PHOTOGRAPH'}</td></tr><tr><td class="label">Father&apos;s / Husband Name :</td><td style="font-weight:600">${tc(w.father_husband_name)}</td></tr><tr><td class="label" style="height:65px">Correspondence Address :</td><td style="font-weight:600;height:65px;white-space:pre-wrap">${tc(aw(w.address))}</td></tr><tr><td class="label" style="height:65px">Permanent Address :</td><td style="font-weight:600;height:65px;white-space:pre-wrap">${tc(aw(w.permanent_address||w.address))}</td></tr><tr><td><strong>Mobile 1 :</strong> ${w.phone||''}</td><td><strong>Mobile 2:</strong> ${w.alternate_phone||''}</td><td><strong>Email ID :</strong> ${w.email||''}</td></tr><tr><td><strong>Date of Birth :</strong> ${w.dob||''}</td><td><strong>Marital Status :</strong> ${tc(w.marital_status)}</td><td><strong>Gender :</strong> ${tc(w.gender)}</td></tr><tr><td><strong>PAN Card No :</strong> ${w.pan_number||''}</td><td><strong>Aadhaar Card No :</strong> ${w.aadhar_number||''}</td><td></td></tr><tr><td colspan="3" class="section">EDUCATIONAL DETAILS (higher education)</td></tr></tbody></table><table class="edu"><tbody><tr><th>Degree</th><th>University / Institute</th><th colspan="2" width="28%">Year of Passing</th><th width="10%">%</th></tr>${er}</tbody></table><table><tbody><tr><td colspan="5" class="section">VOLUNTEER DETAILS (PREVIOUS ORGANISATIONS / AFFILIATIONS)</td></tr><tr><th width="8%">Sr.No</th><th>Organisation / Trust</th><th>Role / Designation</th><th width="14%">From</th><th width="14%">To</th></tr>${or}</tbody></table><table><tbody><tr><td colspan="5" class="section">FAMILY DETAILS / PERSONAL REFERENCE</td></tr><tr><th width="8%">S.No</th><th>Name</th><th>Relation</th><th>Occupation</th><th>Mobile No</th></tr>${fr}</tbody></table><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &apos;A&apos; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai.<br />Contact: 8879035035 / 8879034034 | E-mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}
function t2Body(){return`<div class="t2"><h1>Being Sevak Charitable Trust</h1><div class="red"></div><div class="sub">Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G</div><div class="title">VOLUNTEER GUIDELINES</div><div class="sec">1. Volunteer Association</div><p>Welcome to Being Sevak Charitable Trust. We are grateful for your decision to volunteer with us. Every volunteer plays a vital role in serving society with honesty, compassion, integrity, and dedication. This handbook outlines the policies, responsibilities, expectations, and code of conduct applicable to all volunteers associated with the Trust. Volunteers are onboarded based on the requirements of the Trust and their individual skills, qualifications, and suitability for specific projects or activities. Every volunteer shall work under the guidance of the respective Team Leader, Head of Department (HOD), Project Coordinator, or any authorized representative of the Trust. The Trust reserves the right to assign, transfer, or modify the volunteer&#39;s project, work location, or responsibilities whenever required in the interest of the Trust&#39;s operations.</p><div class="sec">2. Orientation Period</div><p>Every newly onboarded volunteer shall undergo an orientation and familiarization period during which the Trust will assess the volunteer&#39;s attendance, punctuality, discipline, communication skills, teamwork, work ethic, behaviour, and overall involvement. This orientation period is intended to familiarize volunteers with the Trust&#39;s mission, values, policies, and operational procedures. The Trust reserves the right to discontinue the volunteer&#39;s association at any time during or after the orientation period if the volunteer&#39;s conduct, involvement, or suitability is found to be unsatisfactory or inconsistent with the values and expectations of the Trust.</p><div class="sec">3. Volunteer Timings</div><p>The standard volunteer timings shall ordinarily be from 10:00 AM to 7:00 PM or 9:30 AM to 6:30 PM, inclusive of the prescribed break time, unless otherwise communicated by the Trust. Volunteers are expected to report to their assigned place of work punctually and remain available during their scheduled hours. Attendance shall be recorded through the designated attendance system or any manual process authorized by the Trust. Regular late reporting, early departures, or irregular attendance may be reviewed by the Trust coordinators and may affect the continuity of volunteer association.</p><div class="sec">4. Lunch Break</div><p>Volunteers shall be entitled to a lunch break of 30 minutes, generally scheduled between 1:30 PM and 2:00 PM, unless modified due to operational requirements. Volunteers are expected to resume their duties promptly upon completion of the lunch break and ensure that the break does not interfere with the smooth functioning of the Trust&#39;s activities.</p><div class="sec">5. Attendance</div><p>Every volunteer is expected to maintain regular attendance, report to duty on time, and record attendance through the prescribed system every working day. In the event that a volunteer is unable to attend due to unavoidable circumstances, the concerned Team Leader or coordinator must be informed at the earliest possible opportunity. Continuous absence without prior information or valid justification may be treated as abandonment of volunteer responsibilities and may result in the conclusion of the volunteer&#39;s association with the Trust.</p><div class="sec">6. Conduct at Trust Premises</div><p>Volunteers are expected to maintain the highest standards of discipline, professionalism, and ethical conduct throughout their association with the Trust. Every volunteer shall treat beneficiaries, visitors, fellow volunteers, and members of the public with dignity, courtesy, and respect. Volunteers are required to follow the reasonable instructions of their coordinators, maintain cleanliness within the Trust premises, and adhere to the prescribed attire guidelines. Activities such as personal shopping, personal grooming during working hours, excessive or unnecessary mobile phone usage, playing games, or engaging in activities unrelated to the Trust&#39;s work are strictly discouraged and may invite appropriate action if found to interfere with the Trust&#39;s activities.</p><div class="sec">7. Mobile Phone Usage</div><p>The use of personal mobile phones during volunteer hours shall be limited to emergencies or designated break periods. Volunteers are encouraged to remain focused on their assigned duties while on the Trust premises. Family members and personal contacts should communicate with volunteers during working hours only in cases of genuine emergency to avoid unnecessary interruptions to the Trust&#39;s activities.</p><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &apos;A&apos; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai.<br />Contact: 8879035035 / 8879034034 | E-mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}
function t4Body(){return`<div class="t4"><h1>Being Sevak Charitable Trust</h1><div class="red"></div><div class="sub">Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G</div><div class="sec">8. Trust Assets &amp; Resources</div><p>All assets, equipment, documents, electronic devices, identification cards, communication tools, and other property belonging to the Trust are provided solely for the Trust&#39;s work. Volunteers shall exercise due care while using such resources and shall not use them for personal or unauthorized activities. Any loss, theft, damage, or misuse resulting from negligence or misconduct may be reviewed by the Trust. Upon completion or conclusion of the volunteer association, all Trust property must be returned immediately in good condition.</p><div class="sec">9. Confidentiality</div><p>Volunteers shall maintain strict confidentiality regarding all information obtained during their association with the Trust. Confidential information includes, but is not limited to, donor details, beneficiary records, financial information, internal reports, project documentation, login credentials, CRM data, operational strategies, and any other non-public information belonging to the Trust. Volunteers shall not disclose, copy, share, or use confidential information for personal benefit or disclose it to any third party without prior written authorization from the Trust.</p><div class="sec">10. Social Media Usage</div><p>Volunteers shall not publish, post, upload, or distribute any information, photographs, videos, documents, or confidential material relating to the Trust through personal social media platforms or any public forum without obtaining prior approval from the authorized representatives of the Trust. The Trust may, however, use photographs, videos, names, testimonials, or recordings of volunteers for its official website, social media platforms, awareness campaigns, reports, newsletters, brochures, and other promotional or educational purposes unless the volunteer has submitted a written objection in advance.</p><div class="sec">11. Child &amp; Beneficiary Protection</div><p>Every volunteer is responsible for ensuring the safety, dignity, and well-being of all beneficiaries associated with the Trust. Volunteers shall treat every child, beneficiary, and community member with respect and shall refrain from any form of abuse, harassment, discrimination, intimidation, exploitation, or inappropriate behaviour. The privacy and confidentiality of beneficiaries must always be protected, and any safeguarding concern, misconduct, or suspected abuse must be reported immediately to the appropriate authority within the Trust.</p><div class="sec">12. Time Away / Absence</div><p>Volunteers are expected to inform their coordinator well in advance whenever they need to be away from their duties. Emergency absences shall be communicated immediately through appropriate means. Repeated absenteeism, unnotified absence, or continuous absence without proper information may adversely affect the volunteer&#39;s association with the Trust and may result in the conclusion of the volunteer&#39;s association.</p><div class="sec">13. Restricted Areas</div><p>Certain areas within the Trust premises are restricted to authorized personnel only. Volunteers shall not enter management cabins, the Accounts Department, coordination offices, server rooms, storage areas, or any other restricted location without obtaining prior permission from the concerned authority. Unauthorized access to restricted areas may lead to appropriate action.</p><div class="sec">14. Attire Guidelines</div><p>Volunteers are expected to maintain a clean, neat, and presentable appearance at all times while representing the Trust. Formal attire shall be worn from Monday to Friday, while smart casual attire may be permitted on Saturdays unless otherwise instructed. Volunteers are expected to present themselves in a manner consistent with the values and image of the Trust.</p><div class="sec">15. Code of Conduct</div><p>Every volunteer shall perform assigned responsibilities honestly, ethically, and responsibly while respecting fellow volunteers, coordinators, beneficiaries, donors, visitors, and members of the public. Volunteers are expected to protect Trust property, maintain punctuality, preserve confidentiality, comply with all organizational guidelines, and conduct themselves with integrity and accountability throughout their period of association with the Trust.</p><div class="sec">16. Grievance Resolution</div><p>Any volunteer experiencing concerns, disputes, or grievances relating to conduct within the Trust, operations, or interpersonal issues should first report the matter to the concerned Team Leader. If the matter remains unresolved, the volunteer may escalate the issue to the Volunteer Coordination Team or the Trustee for appropriate review and resolution. The Trust is committed to addressing genuine concerns fairly, impartially, and confidentially.</p><div class="sec">17. Voluntary Withdrawal</div><p>A volunteer who wishes to discontinue their association with the Trust should communicate their decision in writing to the appropriate authority and complete the proper handover of all assigned responsibilities, documents, equipment, identification cards, and other Trust assets before their final day of association.</p><div class="sec">18. Conclusion of Volunteer Association</div><p>The Trust reserves the right to conclude the association of any volunteer at its discretion in cases involving misconduct, repeated absenteeism, misuse of Trust property, breach of confidentiality, fraud, harassment, violation of organizational guidelines, or any conduct considered detrimental to the interests, reputation, or objectives of the Trust.</p><div class="sec">19. Volunteer Appreciation Certificate</div><p>The Trust may issue a Volunteer Appreciation Certificate or Letter of Gratitude to volunteers who have successfully completed their period of service with satisfactory involvement and conduct, subject to the applicable guidelines and approval of the Trust management.</p><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &apos;A&apos; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai.<br />Contact: 8879035035 / 8879034034 | E-mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}
function t5Body(w,tc){return`<div class="t5"><h1>Being Sevak Charitable Trust</h1><div class="redline"></div><div class="sub">Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G</div><p>You shall abide by the Trust&#39;s guidelines and volunteer policies as presented in the Volunteer Guidelines, and by all general or administrative rules, regulations, and directives of the Trust made from time to time, so long as they are not inconsistent with this agreement. For any work-related matter, issue, or communication, the volunteer must contact the concerned coordinator directly. <strong>Attire Guidelines:</strong> Monday to Friday [Formals]; Saturday [Smart Casuals].</p><div class="section">Holiday &amp; Absence Policy (Clubbing Rule)</div><p>Volunteer attendance will be considered for the entire month while determining monthly volunteer involvement. If a volunteer is absent immediately before or after a Sunday, weekly off, or declared public holiday, the intervening day(s) will also be counted as part of the absence. If a volunteer remains absent for more than 6 days in a calendar month, all Sundays, weekly offs, and public holidays during that month will also be considered. Exceptions may be reviewed by the Trust management for genuine reasons.</p><div class="section">Volunteer Timings</div><p>Volunteer timings are 10.00 AM to 7.00 PM OR 9.30 AM to 6.30 PM [including break time]; attendance is recorded through the attendance system OR manually. Lunch break is 30 minutes, between 1.30 and 2.00 PM. Half-day: reporting time is 2.00 PM and departure time is 3.00 PM; no lunch break is applicable on a half-day, and arriving late on a half-day will be recorded as absent. A cumulative grace period of 180 minutes per month is allowed for late arrival / early departure, as follows:</p><table><tr><th>Late / Early Departure Duration Per Month</th><th>Attendance Record Impact</th></tr><tr><td>Up to 180 minutes</td><td>No impact on attendance record</td></tr><tr><td>181 – 240 minutes</td><td>Recorded as half-day absence</td></tr><tr><td>241 – 480 minutes</td><td>Recorded as one-day absence</td></tr><tr><td>More than 480 minutes</td><td>Attendance reviewed by Trust management as per volunteer guidelines</td></tr></table><div class="section">Voluntary Withdrawal &amp; Separation</div><p>A volunteer who wishes to step down must complete the handover process and return all assigned duties, documents, equipment, and Trust resources. A Letter of Appreciation is issued to volunteers who have completed at least one year of satisfactory association with the Trust.</p><table><tr><th width="28%">Guideline</th><th>Description</th></tr><tr><td><b>Voluntary Withdrawal</b></td><td>Intimation Period: At least one month&#39;s advance notice is requested. Stepping down without completing the intimation period may affect the volunteer&#39;s eligibility for a Letter of Appreciation.</td></tr><tr><td><b>Discontinuation Without Intimation</b></td><td>Absence from Trust activities for seven consecutive days without any communication will be treated as abandonment of volunteer responsibilities.</td></tr><tr><td><b>Conclusion of Association</b></td><td>The association may be concluded due to non-involvement or violation of the Trust&#39;s Code of Conduct.</td></tr></table><div class="section">Acknowledgement</div><p style="margin-bottom:30px">The volunteer agrees to maintain confidentiality and indemnify the Trust from damages, claims, or disputes arising from any violation of confidentiality or obligations. Signing below confirms that the volunteer has read, understood, and accepted all terms.</p><p style="margin-bottom:8px">Yours sincerely,<br /><b style="display:block;margin-top:8px">For Being Sevak Charitable Trust – HOD</b></p><p style="margin-bottom:16px">I accept all the terms and conditions as mentioned in this letter.</p><div class="sign" style="margin-bottom:16px"><div class="field">Volunteer Name <div class="line" style="display:block;margin-top:25px;padding-bottom:4px;min-height:22px">${tc(w.name)}</div></div><div class="field">Signature <div class="line" style="display:block;margin-top:25px"></div></div></div><div class="sign"><div class="field">Manager Name / HOD <div class="line" style="display:block;margin-top:25px"></div></div><div class="field">Signature <div class="line" style="display:block;margin-top:25px"></div></div></div><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &apos;A&apos; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai.<br />Contact: 8879035035 / 8879034034 | E-mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}
function t6Body(w,tc,d,pl){return`<div class="t6"><div class="inner"><h1>Being Sevak Charitable Trust</h1><div class="red"></div><div class="sub">Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G</div><div class="blue" style="margin-top:20px">VOLUNTEER CONFIDENTIALITY / NON-DISCLOSURE AGREEMENT</div><p>This agreement is made between Being Sevak Charitable Trust and the Volunteer on <span class="line med">${tc(w.name)}</span>. While volunteering with the Trust, the Volunteer may receive Confidential Information concerning matters affecting or relating to the Trust. The Volunteer agrees as follows:</p><p><span class="b">A.</span> Confidential Information and Proprietary Data are the Trust&#39;s exclusive property. The Volunteer shall keep them confidential, take reasonable steps to protect them, and not disclose or use them for personal benefit or the benefit of others during or after association with the Trust.</p><p><span class="b">B.</span> Notes, notebooks, computer disks, pen drives, documents, equipment, and devices containing such information are the property of the Trust and must not be removed from Trust premises. They shall be returned immediately upon conclusion of the volunteer association.</p><p><span class="b">C.</span> The Volunteer shall not reproduce or commercially use Confidential Information for any purpose other than carrying out duties for the Trust.</p><p><span class="b">D.</span> The Trust may take appropriate action, including conclusion of the volunteer association, and pursue civil or criminal remedies for violations. This agreement is governed by the laws of Maharashtra (Mumbai).</p><p><span class="b">E.</span> On withdrawal, the Volunteer shall surrender all Trust assets, official WhatsApp, email ID, contact number, and other Trust-related items. Failure to comply may result in appropriate action.</p><p><span class="b">F.</span> All provisions apply only to the extent they do not violate applicable law. The Volunteer warrants that no conflicting obligation exists.</p><p style="margin-top:14px;padding-top:10px"><span class="b">Declaration :</span></p><div style="display:flex;align-items:flex-start;gap:8px"><input type="checkbox" style="margin-top:3px;width:14px;height:14px;accentColor:#7f2d2d;flexShrink:0" /><p style="margin:0">I hereby declare that the above statement made in my application is true, complete, and correct to the best of my knowledge and belief. In the event of any information being found false or incorrect at any stage, my services are liable to be terminated without notice.</p></div><div class="row" style="margin-top:12px;padding-top:8px;display:flex;align-items:center;gap:20px"><span>Date: ${d||'<span class="line small"></span>/<span class="line small"></span>/<span class="line small"></span>'}</span><span>Place: <span class="line med">${pl}</span></span></div><p style="margin-top:14px">Signing below signifies that the Volunteer agrees to the terms and conditions stated above.</p><div class="sigwrap"><div class="sig"><div class="l"></div><div>Volunteer Name &amp; Signature</div></div><div class="sig"><div class="l"></div><div>For Being Sevak Charitable Trust (Authorized Signatory)</div></div></div></div><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &apos;A&apos; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai.<br />Contact Sevak: 8879035035 / 8879034034 | E-Mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}
function t6bBody(w,tc,d,pl){return`<div class="t6b"><h1>Being Sevak Charitable Trust</h1><div class="top-line"></div><div class="subtitle">Public Charitable Trust (Reg.) E-31948 No. | Income Tax Exempted Under 80G</div><div class="form-title">VOLUNTEER PHOTO, VIDEO &amp; PUBLICITY CONSENT FORM</div><p>I, ${tc(w.name)||'________________________'}, voluntarily authorize Being Sevak Charitable Trust (&quot;the Trust&quot;) to capture and use my photographs, videos, audio recordings, name, image, voice, and testimonials for lawful purposes related to the Trust&#39;s charitable activities, including awareness campaigns, fundraising, reports, publications, training, social media, website, donor communications, and other promotional or educational materials.</p><div class="agreement">I understand and agree that:</div><div class="two-column"><ul><li>My participation is voluntary, and I have no objection to the Trust using the above materials.</li><li>I will not claim any royalty, payment, or compensation for such use.</li><li>The Trust may edit or modify the materials without misrepresenting my identity or participation.</li></ul><ul><li>All photographs, videos, and recordings created by or for the Trust shall remain the property of the Trust.</li><li>I may withdraw my consent by giving written notice. Such withdrawal will apply only to future use, wherever reasonably practicable, and will not affect materials already published or distributed.</li></ul></div><p>I confirm that I have read and understood this consent and agree to its terms. This consent shall be governed by the laws of India, and any disputes shall be subject to the jurisdiction of the courts at Mumbai, Maharashtra.</p><div class="section">VOLUNTEER DETAILS</div><div class="field"><span class="label">Volunteer Name:</span><span class="line">${tc(w.name)||''}</span></div><div class="field"><span class="label">Volunteer ID (if any):</span><span class="line"></span></div><div class="field"><span class="label">Signature:</span><span class="line"></span></div><div class="field"><span class="label">Date:</span><span class="line">${d||''}</span></div><div class="field"><span class="label">Place:</span><span class="line">${pl||'Mumbai'}</span></div><div class="section">FOR VOLUNTEERS BELOW 18 YEARS</div><p>I, ________________________, parent/legal guardian of the above volunteer, hereby give my consent on behalf of the minor.</p><div class="field"><span class="label">Parent/Guardian Signature:</span><span class="line"></span></div><div class="field"><span class="label">Date:</span><span class="line">${d||''}</span></div><div class="section">FOR BEING SEVAK CHARITABLE TRUST</div><div class="field"><span class="label">Authorized Signatory:</span><span class="line" style="flex:none;width:200px"></span></div><div class="footer">Reg. Add.: Office No. 402, 4th Floor, &quot;A&quot; Wing, New Delite Apartment, Near Chandavarkar Lane, Borivali (West), Mumbai – 400092<br />Contact: 8879035035 / 8879034034 | E-mail: being.sevak@gmail.com | Website: www.beingsevak.org</div></div>`}

function WhoWithPhoto({ name, role, photo_url }) {
  const [photoErr, setPhotoErr] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const hasPhoto = photo_url && !photoErr;
  const imgLoading = hasPhoto && !photoLoaded;
  useEffect(() => { setPhotoErr(false); setPhotoLoaded(false); }, [photo_url]);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      {imgLoading ? (
        <div className="sk" style={{ width:36, height:36, borderRadius:'50%', flexShrink:0 }} />
      ) : hasPhoto ? (
        <img src={photo_url} alt="" style={{ width:36, height:36, borderRadius:'50%', objectFit:'cover', flexShrink:0 }}
          onLoad={() => setPhotoLoaded(true)} onError={() => { setPhotoErr(true); setPhotoLoaded(true); }} />
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {!hasPhoto && !imgLoading ? <Avatar name={name} /> : null}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{name}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{role}</div>
        </div>
      </div>
    </div>
  );
}

export default function Workers({ onSelect, onOffboard, showAddForm = true, showNgoSalary = true, showBulkPrint = true, title = 'Volunteers', showPagarExport = false }) {
  const { addWorker, DEPTS, updateWorker, fetchWorkers, fetchNGOs, fetchNgoSummaryList } = useHR();
  const { formatSalary, isSalaryUnlocked, promptUnlock, lockSalary } = useSalaryPrivacy();
  const navigate = useNavigate();
  const [workers, setWorkers] = useState([]);
  const [empIdMap, setEmpIdMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [dept, setDept] = useState(DEPTS?.[0] || '');
  const [client, setClient] = useState('BSCT');
  const [isTest, setIsTest] = useState(false);
  const [err, setErr] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [search, setSearch] = useState(load().search || '');
  const [roleFilter, setRoleFilter] = useState(load().roleFilter || '');
  const [statusFilter, setStatusFilter] = useState(['active','absconded','offboarded','all'].includes(load().statusFilter) ? load().statusFilter : 'active');
  const [showTest, setShowTest] = useState(load().showTest || false);
  const [entityFilter, setEntityFilter] = useState('All');
  const [page, setPage] = useState(load().page || 1);
  const [created, setCreated] = useState(null);
  const [salaryMap, setSalaryMap] = useState({});
  const [ngos, setNgos] = useState([]);
  const [ngoSummary, setNgoSummary] = useState([]);
  const [selectedNgos, setSelectedNgos] = useState([]);
  const [workerDetails, setWorkerDetails] = useState({});
  const [pagarMonth, setPagarMonth] = useState('');
  const [showPagarModal, setShowPagarModal] = useState(false);
  const PAGE_SIZE = 20;
  const tableRef = useRef(null);

  const reload = useCallback(() => {
    setLoading(true);
    return fetchWorkers('all').then(list => {
      setWorkers(list || []);
      setLoading(false);
      api('/db/query', { method: 'POST', body: JSON.stringify({ sql: 'SELECT id, employee_id FROM workers' }), _prefix: 'ucs' })
        .then(res => {
          const map = {};
          (res.rows || []).forEach(r => { if (r.employee_id) map[r.id] = r.employee_id; });
          setEmpIdMap(map);
        })
        .catch(() => {});
      return list || [];
    }).catch((err) => { console.error('API error:', err.message); setLoading(false); return []; });
  }, [fetchWorkers]);

  useEffect(() => {
    reload().then(list => {
      Promise.all((list || []).map(w =>
        api('/workers/' + w.id, { _prefix: 'ucs' }).catch((err) => { console.error('Error:', err.message); })
      )).then(details => {
        const map = {};
        for (const d of details) { if (d) map[d.id] = d; }
        setWorkerDetails(map);
      });
    });
    fetchNGOs().then(setNgos).catch((err) => { console.error('API error:', err.message); });
    fetchNgoSummaryList().then(setNgoSummary).catch((err) => { console.error('API error:', err.message); });
    api('/salary/workers-summary', { _prefix: 'ucs' })
      .then(data => {
        const map = {};
        for (const w of data) map[w.id] = w;
        setSalaryMap(map);
      })
      .catch((err) => { console.error('Error:', err.message); });
  }, [reload]);

  const roles = [...new Set(workers.map(w => (w.department || 'Team Member')).filter(Boolean))].sort();
  const clientOf = (w) => {
    if (!w.ngo_id) return 'Other';
    const ngo = ngos.find(n => n.id === w.ngo_id);
    if (!ngo) return 'Other';
    const name = (ngo.name || '').trim().toUpperCase();
    return name === 'OTHER' ? 'Other' : (name || 'Other');
  };
  const filtered = workers.filter(w => {
    if (w.is_test && !showTest) return false;
    const role = w.department || 'Team Member';
    if (roleFilter && role !== roleFilter) return false;
    const empStatus = w.employment_status || 'active';
    if (statusFilter && statusFilter !== 'all' && empStatus !== statusFilter) return false;
    if (entityFilter && entityFilter !== 'All' && clientOf(w) !== entityFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return w.name.toLowerCase().includes(q) ||
      (w.email || '').toLowerCase().includes(q) ||
      role.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const CLIENTS = [...new Set([
    ...(ngos || []).filter(n => (n.name || '').trim().toUpperCase() !== 'TESTING')
      .map(n => (n.name || '').trim().toUpperCase() === 'OTHER' ? 'Other' : (n.name || '').trim().toUpperCase()).filter(Boolean),
    'Other',
  ])];
  const PALETTE = ['#5B6B4E', '#C08A2E', '#7A5C7E', '#B5603A', '#4F6472', '#88693D', '#2E7D32', '#1565C0', '#6A1B9A', '#00838F'];
  const CLIENT_COLORS = {};
  CLIENTS.forEach((c, i) => { CLIENT_COLORS[c] = PALETTE[i % PALETTE.length]; });
  const clientCounts = {};
  CLIENTS.forEach(c => { clientCounts[c] = 0; });
  workers.forEach(w => { if (w.is_test) return; const c = clientOf(w); if (clientCounts[c] !== undefined) clientCounts[c] += 1; else clientCounts[c] = 1; });
  const clientTotal = CLIENTS.reduce((s, c) => s + (clientCounts[c] || 0), 0);
  const clientPct = (c) => clientTotal ? Math.round((clientCounts[c] / clientTotal) * 100) : 0;

  const mountedSearch = useRef(false);
  useEffect(() => { if (!mountedSearch.current) { mountedSearch.current = true; return; } save({ search, page: 1 }); setPage(1); }, [search]);
  const mountedRole = useRef(false);
  useEffect(() => { if (!mountedRole.current) { mountedRole.current = true; return; } save({ roleFilter, page: 1 }); setPage(1); }, [roleFilter]);
  const mountedStatus = useRef(false);
  useEffect(() => { if (!mountedStatus.current) { mountedStatus.current = true; return; } save({ statusFilter, page: 1 }); setPage(1); }, [statusFilter]);
  useEffect(() => { save({ page }); }, [page]);
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [safePage]);

  const submit = async () => {
    if (!name.trim()) return;
    setErr('');
    setCreated(null);
    try {
      const body = { name: name.trim(), department: dept, is_test: isTest };
      const allocations = [];
      if (dept === 'NGO Admin' && selectedNgos.length > 0) {
        allocations.push(...selectedNgos.map(id => ({ ngo_id: id, salary_portion: 0 })));
      }
      const clientNgo = ngos.find(n => (n.name || '').trim().toUpperCase() === String(client).toUpperCase());
      if (clientNgo) allocations.push({ ngo_id: clientNgo.id, salary_portion: 0 });
      if (allocations.length > 0) body.allocations = allocations;
      const res = await addWorker(body);
      setCreated(res.worker);
      setName('');
      setDept(DEPTS?.[0] || '');
      setSelectedNgos([]);
      setIsTest(false);
      reload();
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleFullPayExport = async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
      const data = await api('/salary/payroll?month=' + month + '&extended=true', { _prefix: 'ucs' });
      if (!data.rows || data.rows.length === 0) { alert('No payroll data for this month'); return; }

      const groups = {};
      for (const r of data.rows) {
        if (!groups[r.ngo_name]) groups[r.ngo_name] = [];
        groups[r.ngo_name].push(r);
      }

      const headers = [
        'Team Name', 'Branch Name', 'Agent Name', 'Date of Joining',
        'Salary', 'Target', 'Achieved', 'Balance', 'Achieved %',
        'May Present Days', 'Training and Sunday Deduction',
        'Sunday Need To Add', 'Net May Present Days', 'May Salary',
        'Monthly 10% Incentive', 'Aaj Ka Incentive (Daily 50% for PC)',
        'Weekly Incentive / TL', 'Gross Payable Salary',
        'OT/Appreciation/Extra Incentive', 'Any Pending Expenses Paid for Previous Month',
        'Advance need to be deducted in May, 2026', 'Net Payable Salary',
        'ACCOUNT HOL', 'ACC COL', 'Bank', 'IFSC Code',
      ];

      const wsData = [headers];
      for (const [ngo, rows] of Object.entries(groups)) {
        for (const r of rows) {
          wsData.push([
            r.department || '',
            r.ngo_name,
            r.name,
            r.date_of_joining ? (() => { const d = r.date_of_joining.split('T')[0].split('-'); return `${d[2]}-${d[1]}-${d[0]}`; })() : '',
            r.salary || 0,           // E: Salary
            r.target || 0,           // F: Target
            r.achieved || 0,         // G: Achieved
            null,                     // H: Balance (formula)
            null,                     // I: Achieved % (formula)
            r.present_days || 0,     // J: May Present Days
            0,                        // K: Training and Sunday Deduction
            0,                        // L: Sunday Need To Add
            null,                     // M: Net May Present Days (formula)
            r.total_due || 0,        // N: May Salary
            r.monthly_incentive || 0,  // O: Monthly 10% Incentive
            r.aki_payout || 0,         // P: Aaj Ka Incentive
            0,                        // Q: Weekly Incentive
            null,                     // R: Gross Payable Salary (formula)
            0,                        // S: OT/Appreciation
            0,                        // T: Pending Expenses
            0,                        // U: Advance to Deduct
            null,                     // V: Net Payable Salary (formula)
            r.account_holder_name || '',  // W: ACCOUNT HOL
            r.account_number || '',       // X: ACC COL
            r.bank_name || '',            // Y: Bank
            r.ifsc_code || '',            // Z: IFSC Code
          ]);
        }
      }

      for (let i = 1; i < wsData.length; i++) {
        const row = i + 1;
        wsData[i][7] = { f: `F${row}-G${row}` };                         // H: Balance (Target - Achieved)
        wsData[i][8] = { f: `IF(F${row}>0,G${row}/F${row}*100,0)` };     // I: Achieved %
        wsData[i][12] = { f: `J${row}-K${row}+L${row}` };                // M: Net May Present Days
        wsData[i][14] = { f: `IF(F${row}>0,IF(G${row}>=F${row},(G${row}-F${row})*0.1,0),0)` }; // O: Monthly 10% Incentive
        wsData[i][17] = { f: `N${row}+O${row}+P${row}+Q${row}` };        // R: Gross Payable Salary
        wsData[i][21] = { f: `R${row}+S${row}+T${row}-U${row}` };        // V: Net Payable Salary
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 14 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 16 }, { wch: 22 },
        { wch: 16 }, { wch: 18 }, { wch: 14 },
        { wch: 18 }, { wch: 26 }, { wch: 16 },
        { wch: 20 }, { wch: 30 }, { wch: 30 },
        { wch: 28 }, { wch: 18 },
        { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 16 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `payroll-full-${month}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const handlePagarExport = async () => {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    setPagarMonth(defaultMonth);
    setShowPagarModal(true);
  };

  const doPagarExport = async (month) => {
    try {
      const data = await api('/salary/pagar-export?month=' + month, { _prefix: 'ucs' });
      if (!data.rows || data.rows.length === 0) { alert('No payroll data for this month'); return; }

      const rows = data.rows;
      const daysInMonth = data.days_in_month || new Date(Date.UTC(new Date(month + '-01').getFullYear(), new Date(month + '-01').getMonth() + 1, 0)).getUTCDate();
      const monthDate = new Date(month + '-01');
      const monthName = monthDate.toLocaleString('default', { month: 'long' });
      const year = monthDate.getFullYear();

      // Column indices (0-based)
      const COL = {
        NAME: 0, STATUS: 1, AC_HOLDER: 2, AC_REL: 3, BANK: 4, AC_NUM: 5, IFSC: 6, STATION: 7, DOJ: 8, SALARY: 9,
        TARGET: 10, TOTAL_ACH: 11, BSCT_ACH: 12, AFLF_ACH: 13, MANN_ACH: 14,
        BALANCE: 15, ACH_PCT: 16,
        PRES_DAYS: 17, TRAIN_SUN_DED: 18, NET_PRES: 19,
        MONTH_SAL: 20, INCENT_10: 21, TOTAL_AKI: 22, AKI: 23, GROSS: 24,
        OT: 25, PENDING: 26, ADVANCE: 27, NET_PAY: 28,
        FIRST_DAY_COL: 29
      };
      const TOTAL_COLS = COL.FIRST_DAY_COL + daysInMonth;

      const headers = [
        'Agent Name', 'Status', 'Account Holder Name', 'Account Holder Relation',
        'Bank Name', 'Bank Account Number', 'IFSC Code', 'STATION', 'Date of Joining', 'Salary',
        'New Target', 'Total Achieved', 'BSCT Achieved', 'AFLF Achieved', 'Mann Achieved',
        'Balance', 'Achieved %',
        `${monthName} Present Days`, 'Training and Sunday Deduction', `Net ${monthName} Present Days`,
        `${monthName} Salary`, 'Monthly 10% Incentive', 'Total AKI', 'Aaj Ka Incentive (Daily 50% for PC)',
        'Gross Payable Salary',
        'OT/Appreciation/Extra Incentive', 'Any Pending Salary Paid for Previous Month',
        `Advance need to be deducted in ${monthName}, ${year}`, 'Net Payable Salary',
        ...Array.from({ length: daysInMonth }, (_, i) => {
          const d = new Date(year, monthDate.getMonth(), i + 1);
          return d.toLocaleString('default', { day: '2-digit', month: 'short' });
        })
      ];

      const wsData = [headers];
      const rowStyles = [];
      let activeFroCount = 0, mgmtCount = 0, hrCount = 0, abscondCount = 0;
      const CATEGORY_ORDER = ['Pg', 'Library', 'Suspense'];

      // JS accumulators so every subtotal / the Grand Total is an exact literal
      // (independent of Excel formula quirks like SUMIF wildcards or recalc).
      const makeSums = () => ({
        salary: 0, target: 0, achieved: 0, bsct: 0, aflf: 0, mann: 0,
        gross_present_days: 0, training_sunday_ded: 0, month_salary: 0,
        monthly_incentive: 0, total_aki: 0, aki_payout: 0, advance_deduction: 0,
        net_payable: 0, daily: {}
      });
      const addSum = (sum, r) => {
        sum.salary += r.salary || 0;
        sum.target += r.target || 0;
        sum.achieved += r.achieved || 0;
        sum.bsct += r.achieved_bsct || 0;
        sum.aflf += r.achieved_aflf || 0;
        sum.mann += r.achieved_mann || 0;
        sum.gross_present_days += r.gross_present_days || 0;
        sum.training_sunday_ded += r.training_sunday_ded || 0;
        sum.month_salary += r.month_salary || 0;
        sum.monthly_incentive += r.monthly_incentive || 0;
        sum.total_aki += r.total_aki || 0;
        sum.aki_payout += r.aki_payout || 0;
        sum.advance_deduction += r.advance_deduction || 0;
        sum.net_payable += r.net_payable || 0;
        const daily = r.daily || {};
        for (let d = 1; d <= daysInMonth; d++) {
          if (!sum.daily[d]) sum.daily[d] = 0;
          sum.daily[d] += daily[d] || 0;
        }
      };
      const froSums = makeSums(), mgmtSums = makeSums(), hrSums = makeSums(), abscondSums = makeSums();
      const catSumsByLabel = {};
      for (const label of CATEGORY_ORDER) catSumsByLabel[label] = makeSums();
      const grandSums = makeSums();
      const accAny = (sum, r) => { addSum(sum, r); addSum(grandSums, r); };

      for (const r of rows) {
        const daily = r.daily || {};
        const dailyArr = Array.from({ length: daysInMonth }, (_, i) => daily[i + 1] || 0);
        const row = [
          r.name,
          r.status || '',
          r.account_holder_name || '',
          r.account_holder_relation || '',
          r.bank_name || '',
          r.account_number || '',
          r.ifsc_code || '',
          r.station || '',
          r.doj ? (() => { const d = r.doj.split('-'); return `${d[2]}-${d[1]}-${d[0]}`; })() : '',
          r.salary || 0,
          r.target || 0,
          r.achieved || 0,
          r.achieved_bsct || 0,
          r.achieved_aflf || 0,
          r.achieved_mann || 0,
          null, // Balance formula
          null, // Achieved % formula
          r.gross_present_days || 0,
          r.training_sunday_ded || 0,
          null, // Net Present Days formula
          null, // Month Salary formula
          r.monthly_incentive || 0,
          r.total_aki || 0,
          r.aki_payout || 0,
          null, // Gross formula
          0,    // OT (manual)
          0,    // Pending (manual)
          r.advance_deduction || 0,
          null, // Net Payable formula
          ...dailyArr
        ];
        wsData.push(row);
        const met = (r.target || 0) > 0 && (r.achieved || 0) >= r.target;
        rowStyles.push(met ? { fill: { fgColor: { rgb: 'C6EFCE' } }, font: { color: { rgb: '006100' } } } : null);
        const isActive = r.status === 'ACTIVE';
        const isAbscond = r.status === 'ABSCONDED' || r.status === 'ABSCOND';
        const isFro = r.department === 'FRO';
        const isMgmt = ['Digital', 'Admin', 'NGO Admin', 'Event Manager', 'Housekeeping'].includes(r.department);
        const isHr = ['HR', 'HR-Recruiter'].includes(r.department);

        if (isActive && isFro) { activeFroCount++; accAny(froSums, r); }
        else if (isActive && isMgmt) { mgmtCount++; accAny(mgmtSums, r); }
        else if (isActive && isHr) { hrCount++; accAny(hrSums, r); }
        else if (isAbscond) { abscondCount++; accAny(abscondSums, r); }
        else if (r.status === 'CATEGORY') { accAny(catSumsByLabel[r.name] || makeSums(), r); }
      }

      // Build a totals row from JS-accumulated sums (exact literal values).
      // All subtotals AND the Grand Total use this, so the exported numbers are
      // final regardless of Excel formula recalculation.
      const buildTotalRow = (label, sum) => {
        const balance = sum.target > 0 ? sum.target - sum.achieved : null;
        const netPres = sum.gross_present_days - sum.training_sunday_ded;
        const gross = sum.month_salary + sum.monthly_incentive + sum.aki_payout;
        const row = [label];
        for (let c = 1; c < TOTAL_COLS; c++) {
          if (c === COL.SALARY) row.push(sum.salary);
          else if (c === COL.TARGET) row.push(sum.target);
          else if (c === COL.TOTAL_ACH) row.push(sum.achieved);
          else if (c === COL.BSCT_ACH) row.push(sum.bsct);
          else if (c === COL.AFLF_ACH) row.push(sum.aflf);
          else if (c === COL.MANN_ACH) row.push(sum.mann);
          else if (c === COL.BALANCE) row.push(balance);
          else if (c === COL.ACH_PCT) row.push(null);
          else if (c === COL.PRES_DAYS) row.push(sum.gross_present_days);
          else if (c === COL.TRAIN_SUN_DED) row.push(sum.training_sunday_ded);
          else if (c === COL.NET_PRES) row.push(netPres);
          else if (c === COL.MONTH_SAL) row.push(sum.month_salary);
          else if (c === COL.INCENT_10) row.push(sum.monthly_incentive);
          else if (c === COL.TOTAL_AKI) row.push(sum.total_aki);
          else if (c === COL.AKI) row.push(sum.aki_payout);
          else if (c === COL.GROSS) row.push(gross);
          else if (c === COL.OT) row.push(0);
          else if (c === COL.PENDING) row.push(0);
          else if (c === COL.ADVANCE) row.push(sum.advance_deduction);
          else if (c === COL.NET_PAY) row.push(sum.net_payable);
          else if (c >= COL.FIRST_DAY_COL) row.push(sum.daily[c - COL.FIRST_DAY_COL + 1] || 0);
          else row.push(null);
        }
        wsData.push(row);
      };

      // Subtotals for each section (only when the section has rows)
      if (activeFroCount > 0) buildTotalRow('Active FRO Total', froSums);
      if (mgmtCount > 0) buildTotalRow('Management Total', mgmtSums);
      if (hrCount > 0) buildTotalRow('HR Total', hrSums);
      if (abscondCount > 0) buildTotalRow('Absconded Total', abscondSums);
      // A separate total line per category (Pg / Library / Suspense)
      for (const label of CATEGORY_ORDER) {
        if (catSumsByLabel[label]) {
          buildTotalRow(`${label} Total`, catSumsByLabel[label]);
        }
      }
      buildTotalRow('Grand Total', grandSums);

      // Apply formulas for data rows
      for (let i = 1; i < 1 + rows.length; i++) {
        const row = i + 1; // 1-indexed
        const colLetter = (c) => XLSX.utils.encode_col(c);
        // Balance = Target - Total Achieved (blank for target-less rows like
        // category / Anjana FRO / Priyank Shah so they don't show negatives)
        if ((rows[i - 1]?.target || 0) > 0) {
          wsData[i][COL.BALANCE] = { f: `${colLetter(COL.TARGET)}${row}-${colLetter(COL.TOTAL_ACH)}${row}` };
        } else {
          wsData[i][COL.BALANCE] = null;
        }
        // Achieved % = Total Achieved / Target * 100
        wsData[i][COL.ACH_PCT] = { f: `IF(${colLetter(COL.TARGET)}${row}>0,${colLetter(COL.TOTAL_ACH)}${row}/${colLetter(COL.TARGET)}${row}*100,0)` };
        // Net Present Days = Present Days - Training Sunday Ded
        wsData[i][COL.NET_PRES] = { f: `${colLetter(COL.PRES_DAYS)}${row}-${colLetter(COL.TRAIN_SUN_DED)}${row}` };
        // Month Salary = Salary / DaysInMonth * Net Present Days
        wsData[i][COL.MONTH_SAL] = { f: `${colLetter(COL.SALARY)}${row}/${daysInMonth}*${colLetter(COL.NET_PRES)}${row}` };
        // Gross = Month Salary + 10% Incentive + AKI
        wsData[i][COL.GROSS] = { f: `${colLetter(COL.MONTH_SAL)}${row}+${colLetter(COL.INCENT_10)}${row}+${colLetter(COL.AKI)}${row}` };
        // Net Payable = Gross + OT + Pending - Advance
        wsData[i][COL.NET_PAY] = { f: `${colLetter(COL.GROSS)}${row}+${colLetter(COL.OT)}${row}+${colLetter(COL.PENDING)}${row}-${colLetter(COL.ADVANCE)}${row}` };
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Apply achievement-progress colour gradient to each data row
      for (let i = 0; i < rowStyles.length; i++) {
        if (!rowStyles[i]) continue;
        const excelRow = i + 2;
        for (let c = 0; c < TOTAL_COLS; c++) {
          const addr = `${XLSX.utils.encode_col(c)}${excelRow}`;
          if (ws[addr]) ws[addr].s = rowStyles[i];
        }
      }

      // Column widths
      const colWidths = [
        { wch: 22 }, { wch: 10 }, { wch: 22 }, { wch: 18 },
        { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 12 },
        { wch: 18 }, { wch: 22 }, { wch: 22 },
        { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 24 },
        { wch: 22 },
        { wch: 22 }, { wch: 26 },
        { wch: 22 }, { wch: 20 },
        ...Array.from({ length: daysInMonth }, () => ({ wch: 10 }))
      ];
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, monthName);
      const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `${monthName} ${year} Salary File.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);

      setShowPagarModal(false);
    } catch (e) { alert(e.message); }
  };

  const handleOffboard = (e, worker) => {
    e.stopPropagation();
    if (onOffboard) onOffboard(worker);
  };

  const handleToggleTest = async (e, worker) => {
    e.stopPropagation();
    try {
      await updateWorker(worker.id, { is_test: !worker.is_test });
      reload();
    } catch (err) { console.error('Error:', err.message); alert('Could not update test status: ' + (err && err.message ? err.message : 'unknown error')); }
  };

  const toTitleCase = (str) => {
    if (!str || typeof str !== 'string') return str || '';
    return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  };

  const handleExportAll = async () => {
    try {
      const list = await api('/workers', { _prefix: 'ucs' });
      if (!list || list.length === 0) { alert('No workers to export'); return; }
      const full = await Promise.all(list.map(w => api('/workers/' + w.id, { _prefix: 'ucs' }).catch((err) => { console.error('Error:', err.message); })));
      const data = full.filter(Boolean);

      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      let allocByWorker = {};
      let peopleByWorker = {};
      try {
        const rep = await api('/ngo-allocations/report/ngo-salary?month=' + month, { _prefix: 'ucs' });
        for (const r of (rep && rep.rows) || []) {
          if (!allocByWorker[r.worker_id]) allocByWorker[r.worker_id] = [];
          allocByWorker[r.worker_id].push(r);
        }
      } catch (e) { console.error('Error:', e.message); }
      try {
        await Promise.all(data.map(async w => {
          try {
            peopleByWorker[w.id] = await api('/ngo-allocations/workers/' + w.id + '/people', { _prefix: 'ucs' });
          } catch (e) { /* ignore per-worker people fetch errors */ }
        }));
      } catch (e) { console.error('Error:', e.message); }

      const famKeys = ['name', 'relationship', 'occupation', 'phone'];

      const eduNorm = (e) => ({ degree: toTitleCase(e.degree), institution: toTitleCase(e.institution), university: toTitleCase(e.university), year_of_passing: e.year_of_passing || e.year, percentage: e.percentage });
      const famNorm = (f) => ({ name: toTitleCase(f.name), relationship: toTitleCase(f.relationship), occupation: toTitleCase(f.occupation), phone: f.phone });
      const orgNorm = (o) => ({ name: toTitleCase(o.name || o.organization_name), role: toTitleCase(o.role || o.designation), from_year: o.from_year || o.fromYear, to_year: o.to_year || o.toYear, salary: o.salary });

      const eduHeader = { degree: 'Degree', institution: 'Institution', university: 'University', year_of_passing: 'Year of Passing', percentage: 'Percentage' };
      const famHeader = { name: 'Name', relationship: 'Relationship', occupation: 'Occupation', phone: 'Phone' };
      const orgHeader = { name: 'Name', role: 'Role', from_year: 'From Year', to_year: 'To Year', salary: 'Salary' };

      const maxFam = Math.max(...data.map(w => (w.family || w.family_details || []).length));

      const rows = data.map(w => {
        const eduArr = w.education || w.education_details || [];
        const firstEdu = eduArr.length > 0 ? eduNorm(eduArr[0]) : {};
        const fam = (w.family || w.family_details || []).map(famNorm);
        const orgArr = w.previous_organizations || [];
        const firstOrg = orgArr.length > 0 ? orgNorm(orgArr[0]) : {};

        const corrParts = [
          toTitleCase(w.correspondence?.address || w.address),
          toTitleCase(w.correspondence?.city || w.city),
          toTitleCase(w.correspondence?.state || w.state),
          w.correspondence?.pincode || w.pincode,
        ].filter(Boolean);

        const row = {
          Name: toTitleCase(w.name),
          Email: w.email,
          'Login ID': w.login_id,
          Department: toTitleCase(w.department),
          NGO: clientOf(w),
          'NGO Allocation %': (peopleByWorker[w.id] || []).map(p => `${p.ngos?.name || ''}: ${parseFloat(p.allocation_percentage || 0)}%`).join('; '),
          'Total Salary (₹)': w.salary,
          'NGO Salary Amount (₹)': (allocByWorker[w.id] || []).map(a => `${a.ngo_name}: ${parseFloat(a.allocation_amount || 0).toLocaleString('en-IN')}`).join('; '),
          'Salary Month': (allocByWorker[w.id] || [])[0]?.salary_month || month,
          'Payment Status': (allocByWorker[w.id] || []).map(a => `${a.ngo_name}: ${a.payment_status}`).join('; ') || 'unpaid',
          Gender: toTitleCase(w.gender),
          DOB: w.dob,
          Phone: w.phone,
          'Alternate Phone': w.alternate_phone,
          Address: toTitleCase(w.address),
          City: toTitleCase(w.city),
          State: toTitleCase(w.state),
          Pincode: w.pincode,
          'Father/Husband Name': toTitleCase(w.father_husband_name),
          'Marital Status': toTitleCase(w.marital_status),
          'PAN Number': w.pan_number,
          'Aadhar Number': w.aadhar_number,
          'Account Holder Name': toTitleCase(w.account_holder_name),
          'Bank Name': toTitleCase(w.bank_name),
          'IFSC Code': w.ifsc_code,
          'Account Number': w.account_number,
          Correspondence: corrParts.join(', '),
          Salary: w.salary,
        };

        for (const field of Object.keys(eduHeader)) row[eduHeader[field]] = firstEdu[field] || '';
        for (let i = 0; i < maxFam; i++) {
          const f = fam[i] || {};
          row[`Family/Ref Entry ${i + 1}`] = i + 1;
          for (const field of famKeys) row[`Family/Ref Entry ${i + 1} ${famHeader[field]}`] = f[field] || '';
        }
        for (const field of Object.keys(orgHeader)) row[`Previous Org ${orgHeader[field]}`] = firstOrg[field] || '';

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Workers');
      const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `workers-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const handleBulkPrint = async () => {
    try {
      const details = Object.values(workerDetails);
      if (details.length === 0) { alert('No worker data loaded'); return; }
      const verified = details.filter(d => d && isComplete(d));
      if (verified.length === 0) { alert('No verified workers to print'); return; }
      const zip = new JSZip();
      for (const w of verified) {
        zip.file(`${w.name.replace(/[\/:*?"<>|]/g, '_')}_forms.html`, allFormsHTML(w));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `verified-workers-forms-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const handlePayExport = async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
      const data = await api('/salary/payroll?month=' + month, { _prefix: 'ucs' });
      if (!data.rows || data.rows.length === 0) { alert('No payroll data for this month'); return; }

      const groups = {};
      for (const r of data.rows) {
        if (!groups[r.ngo_name]) groups[r.ngo_name] = [];
        groups[r.ngo_name].push(r);
      }
      const colWidths = [{ wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
      const zip = new JSZip();
      for (const [ngo, rows] of Object.entries(groups)) {
        const wsData = [
          ['NGO', 'Name', 'Account Number', 'IFSC Code', 'Total Due (₹)'],
          ...rows.map(r => [r.ngo_name, r.name, r.account_number, r.ifsc_code, r.total_due]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = colWidths;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        const safeName = ngo.replace(/[\/:*?"<>|]/g, '_');
        zip.file(`${safeName}.xlsx`, xlsxBuf);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `payroll-${month}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      <div className="card" style={{ marginBottom:20 }}>
        <div className="card-head">
          <h3 style={{ width:'100%' }}>{showAddForm ? 'Add a volunteer' : 'Volunteers by NGO'}</h3>
          <div style={{ display:'flex', alignItems:'center', gap:'8px 16px', flexWrap:'wrap', width:'100%' }}>
            {showAddForm && <span className="sub" style={{ fontWeight:600 }}>Volunteers by NGO</span>}
            <div style={{ display:'flex', height:12, borderRadius:6, overflow:'hidden', background:'var(--line)', width:180 }}>
              {CLIENTS.map(c => clientCounts[c] > 0 ? (
                <div key={c} style={{ width: clientPct(c) + '%', background: CLIENT_COLORS[c], minWidth: 2 }}
                  title={`${c}: ${clientCounts[c]} (${clientPct(c)}%)`} />
              ) : null)}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0 14px', fontSize:12 }}>
              {CLIENTS.map(c => (
                <span key={c} style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                  <span style={{ width:10, height:10, borderRadius:3, background: CLIENT_COLORS[c] }} />
                  {c}: <strong>{clientCounts[c]}</strong> ({clientPct(c)}%)
                </span>
              ))}
            </div>
            {clientTotal === 0 && <span style={{ fontSize:12, color:'var(--ink-soft)' }}>No volunteers yet.</span>}
          </div>
        </div>
        {showAddForm && (
        <div className="card-pad">
          <div className="form-row" style={{ flexDirection:'row', flexWrap:'wrap' }}>
            <label className="field" style={{ flex:2 }}>Full name
              <input value={name} onChange={e=>{ setName(e.target.value); setNameErr(/\d/.test(e.target.value) ? 'Invalid name' : ''); }} placeholder="Jane Doe"
                onKeyDown={e=>e.key==='Enter'&&submit()} />
              {nameErr && <span style={{ color:'var(--danger)', fontSize:12, marginTop:2, display:'block' }}>{nameErr}</span>}
            </label>
            <label className="field">Team
              <Dropdown value={dept} onChange={e=>{ setDept(e.target.value); setSelectedNgos([]); }} options={DEPTS} />
            </label>
            <label className="field">Client
              <Dropdown value={client} onChange={e=>setClient(e.target.value)} options={CLIENTS} />
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600, color:'var(--ink)', cursor:'pointer', alignSelf:'flex-end', paddingBottom:10 }}>
              <input type="checkbox" checked={isTest} onChange={e=>setIsTest(e.target.checked)} />
              Test member
            </label>
          </div>
          {dept === 'NGO Admin' && ngos.length > 0 && (
            <div className="form-row" style={{ marginTop:8 }}>
              <label className="field">Assign NGOs
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
                  {ngos.map(n => {
                    const active = selectedNgos.includes(n.id);
                    return (
                      <span key={n.id} onClick={() => setSelectedNgos(prev =>
                        prev.includes(n.id) ? prev.filter(id => id !== n.id) : [...prev, n.id]
                      )} style={{
                        padding:'4px 12px', borderRadius:20, fontSize:13, cursor:'pointer',
                        border:'1px solid var(--line)',
                        background: active ? '#5B6B4E' : 'var(--paper)',
                        color: active ? '#fff' : 'var(--ink)',
                        fontWeight: active ? 600 : 400,
                        userSelect:'none', transition:'all .15s',
                      }}>{n.name}</span>
                    );
                  })}
                </div>
                {selectedNgos.length === 0 && <span style={{ fontSize:12, color:'var(--ink-soft)', marginTop:4, display:'block' }}>Select at least one NGO</span>}
              </label>
            </div>
          )}
          <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center' }}>
            <button className="btn btn-primary" onClick={submit}><Plus width={16}/> Add volunteer</button>
          </div>
          {err && <div style={{ color:'var(--danger)', fontSize:13, marginTop:8 }}>{err}</div>}
          {created && (
            <div style={{ background:'#e8f5e9', padding:'10px 14px', borderRadius:8, marginTop:8, fontSize:13, lineHeight:1.7 }}>
              <strong>{created.name}</strong> added<br/>
              Login ID: <code style={{ background:'#c8e6c9', padding:'1px 6px', borderRadius:4, fontWeight:600 }}>{created.login_id}</code><br/>
              Password: <code style={{ background:'#c8e6c9', padding:'1px 6px', borderRadius:4, fontWeight:600 }}>{created.generated_password}</code>
            </div>
          )}
        </div>
        )}
      </div>

      <div className="card" ref={tableRef}>
        <div className="card-head"><h3>{title}</h3>
          <div className="search-input-wrap">
            {showNgoSalary && <button className="btn btn-primary btn-sm" onClick={() => navigate('/hr/ngo')} title="Manage NGO allocations, reports and payments">NGO & Salary</button>}
            <button className="btn btn-primary btn-sm" onClick={handlePayExport} title="Download payroll Excel">Pay</button>
            {showPagarExport && <button className="btn btn-primary btn-sm" onClick={handlePagarExport} title="Download Salary File (July format)">Salary File</button>}
            <button className="btn btn-outline btn-sm" onClick={handleFullPayExport} title="Download full payroll with formulas">Full Excel</button>
            <button className="btn btn-outline btn-sm" onClick={handleExportAll} title="Export all worker data to Excel">Export All</button>
            {showBulkPrint && <button className="btn btn-outline btn-sm" onClick={handleBulkPrint} title="Download print forms for verified workers">Bulk Print</button>}
            <span className="sub">{filtered.length} total</span>
            <Dropdown className="org-filter" value={entityFilter} onChange={e=>setEntityFilter(e.target.value)} options={['All', ...CLIENTS]} />
            <Dropdown className="role-filter" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}
              options={[{value:'',label:'All members'}, ...roles.map(r => ({value:r, label:r}))]} />
            <Dropdown className="status-filter" value={statusFilter} onChange={e=>{ setStatusFilter(e.target.value); save({ statusFilter: e.target.value }); }}
              options={[
                {value:'active', label:'Active'},
                {value:'absconded', label:'Absconded'},
                {value:'offboarded', label:'Offboarded'},
                {value:'all', label:'All'},
              ]} />
            <button className={`btn btn-sm ${showTest ? 'btn-primary' : 'btn-outline'}`} style={{ display:'inline-flex', alignItems:'center', gap:6 }}
              onClick={()=>{ const v = !showTest; setShowTest(v); save({ showTest: v }); }}
              title={showTest ? 'Hide test member accounts' : 'Show test member accounts (they stay excluded from stats)'}>
              <Flask width={14}/> {showTest ? 'Hide test' : 'Show test'}
            </button>
            <input className="search-input" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search by name, email, or team…"
              style={{ marginTop:0, maxWidth:200 }} />
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          marginBottom: 12, padding: '8px 14px', borderRadius: 8,
          background: isSalaryUnlocked ? '#f0fdf4' : '#fffbeb',
          border: `1px solid ${isSalaryUnlocked ? '#bbf7d0' : '#fef08a'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: isSalaryUnlocked ? '#166534' : '#92400e' }}>
              {isSalaryUnlocked ? 'Salary visible' : 'Salaries hidden (XXX)'}
            </span>
            <span style={{ fontSize: 11, color: isSalaryUnlocked ? '#15803d' : '#b45309' }}>
              {isSalaryUnlocked ? 'Entering the access code anywhere unlocks salary for this session.' : 'Enter your access code to view salary figures.'}
            </span>
          </div>
          {isSalaryUnlocked ? (
            <button className="btn btn-sm btn-outline" onClick={lockSalary} style={{ fontSize: 11, padding: '4px 12px', background: '#fff' }}>
              🔒 Hide Salary
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={() => promptUnlock()} style={{ fontSize: 11, padding: '5px 14px', background: 'var(--sage)', color: '#fff', border: 'none', fontWeight: 600 }}>
              🔓 Unlock Salary
            </button>
          )}
        </div>
        <table>
          <thead><tr><th>Name</th><th>NGO</th><th>Emp ID</th><th>Joined</th><th>Salary</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} aria-hidden="true">
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div className="sk" style={{ width:36, height:36, borderRadius:'50%', flexShrink:0 }} />
                        <div>
                          <div className="sk" style={{ width:120, height:14, marginBottom:6, borderRadius:4 }} />
                          <div className="sk" style={{ width:70, height:11, borderRadius:4 }} />
                        </div>
                      </div>
                    </td>
                    <td><div className="sk" style={{ width:52, height:18, borderRadius:10 }} /></td>
                  <td><div className="sk" style={{ width:80, height:12, borderRadius:4 }} /></td>
                  <td><div className="sk" style={{ width:60, height:12, borderRadius:4 }} /></td>
                  <td><div className="sk" style={{ width:52, height:18, borderRadius:10 }} /></td>
                  <td style={{ textAlign:'right' }}><div className="sk" style={{ width:28, height:28, borderRadius:'50%', marginLeft:'auto' }} /></td>
                </tr>
              ))
            ) : (
              <>
                {paginated.map(w => {
                  const sw = salaryMap[w.id];
                  const paid = sw?.current_salary_paid;
                  const currentMonth = new Date().toISOString().slice(0, 7);
                  const salaryFromMonth = sw?.current_salary_from?.slice(0, 7);
                  const isCurrent = salaryFromMonth && salaryFromMonth <= currentMonth;
                  const empId = w.employee_id || empIdMap[w.id];
                  return (
                    <tr key={w.id} className="clickable-row" onClick={() => { if (onSelect) onSelect(w); }}
                      style={{ cursor:'pointer' }}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                          <WhoWithPhoto name={w.name} role={w.department || 'Team Member'} photo_url={w.photo_url} />
                          {isComplete(workerDetails[w.id] || w) && <Check size={16} style={{ color:'var(--sage)', flexShrink:0 }} title="All details filled" />}
                          {w.is_test && <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:800, letterSpacing:'.5px', background:'#fef3c7', color:'#92400e', border:'1px solid #fcd34d', flexShrink:0 }}>TEST</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:4, fontWeight:600, display:'inline-block', background:'#eef1f5', color:'#374151' }}>{clientOf(w)}</span>
                      </td>
                      <td style={{ color:'var(--ink-soft)', fontWeight:500 }}>{empId ? empId.replace(/\D/g, '') : '—'}</td>
                      <td style={{ color:'var(--ink-soft)' }}>{new Date(w.created_at).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</td>
                      <td>
                        {sw?.current_salary ? (
                          <span style={{ fontWeight:600 }}>
                            {formatSalary(sw.current_salary)}
                            {paid && <span className="pill pill-green" style={{ marginLeft:6, fontSize:10 }}>Paid</span>}
                          </span>
                        ) : <span style={{ color:'var(--ink-soft)', fontSize:12 }}>—</span>}
                      </td>
                      <td>
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius:4, fontWeight:600, display:'inline-block',
                          background: w.employment_status === 'absconded' ? '#fff3e0' : w.employment_status === 'offboarded' ? '#fce4ec' : '#e8f5e9',
                          color: w.employment_status === 'absconded' ? '#e65100' : w.employment_status === 'offboarded' ? '#c62828' : '#2e7d32' }}>
                          {w.employment_status === 'absconded' ? 'Absconded' : w.employment_status === 'offboarded' ? 'Offboarded' : 'Active'}
                        </span>
                      </td>
                      <td style={{ textAlign:'right' }}>
                        <button className="btn btn-icon" onClick={(e)=>handleToggleTest(e, w)} aria-label="Toggle test member"
                          title={w.is_test ? 'Unmark as test member' : 'Mark as test member (excluded from dashboard stats)'}
                          style={{ color: w.is_test ? '#b45309' : '#9ca3af' }}><Flask width={16}/></button>
                        <button className="btn btn-icon" onClick={(e)=>handleOffboard(e, w)} aria-label="Offboard volunteer" style={{ color:'#dc2626' }}><Trash width={16}/></button>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan={6}><div className="empty">No volunteers found.</div></td></tr>}
              </>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-sm btn-primary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <div className="pagination-dots">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <span key={p} className={`dot ${p === safePage ? 'dot-active' : ''}`} onClick={() => setPage(p)} />
              ))}
            </div>
            <button className="btn btn-sm btn-primary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        )}
      </div>
    {showPagarModal && (
      <div className="modal-overlay" onClick={() => setShowPagarModal(false)}>
        <div onClick={e => e.stopPropagation()} style={{ 
          width: 360, 
          background: 'var(--card-bg)', 
          borderRadius: 14, 
          boxShadow: '0 12px 48px rgba(0,0,0,.15)',
          border: '1px solid var(--line)',
          maxHeight: 'calc(100vh - 40px)',
          overflow: 'hidden'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            padding: '14px 18px', 
            borderBottom: '1px solid var(--line)' 
          }}>
            <h4 style={{ margin: 0, fontSize: 15 }}>Download Salary File</h4>
            <button onClick={() => setShowPagarModal(false)} style={{ 
              width: 28, height: 28, borderRadius: '50%', border: 'none', 
              background: 'rgba(0,0,0,.08)', color: '#666', fontSize: 18, 
              cursor: 'pointer', display: 'grid', placeItems: 'center', lineHeight: 1 
            }}>×</button>
          </div>
          <div style={{ padding: 20 }}>
            <p style={{ marginBottom: 16, color: 'var(--ink-soft)' }}>Select month for the Salary File export:</p>
            <input type="month" className="input" value={pagarMonth} onChange={e => setPagarMonth(e.target.value)} style={{ width: '100%', padding: '10px 12px', marginBottom: 16, fontSize: 14 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => setShowPagarModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { doPagarExport(pagarMonth); }}>Download</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
