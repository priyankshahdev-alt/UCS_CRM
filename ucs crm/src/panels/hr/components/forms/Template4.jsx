export default function Template5({ personal }) {
  return (
    <div className="print-page">
      <style>{`
        @page{size:A4 portrait;margin:0}
        .t5 *{box-sizing:border-box;font-family:'Times New Roman',Times,serif}
        .t5{width:210mm;height:297mm !important;margin:40px auto;background:#fff;border:8px double #000;padding:2mm 8mm 4mm 8mm;position:relative;overflow:hidden !important;display:flex;flex-direction:column}
        .t5 h1{margin:0 0 10px;text-align:center;font-size:25px;font-family:'Times New Roman',Times,serif;font-weight:bold;line-height:1.1;text-decoration:underline}
        .t5 p{font-size:11pt;line-height:1.3;text-align:justify;margin:2px 0}
        .t5 .section{color:#7a2020;font-weight:bold;font-size:12pt;margin:4px 0 2px 0}
        .t5 table{width:100%;border-collapse:collapse;margin:1.5px 0;page-break-inside:avoid}
        .t5 th,.t5 td{border:1px solid #000;padding:3px 5px;font-size:10.5pt;vertical-align:top;text-align:left}
        .t5 th{background:#d9d9d9;text-align:left}
        .t5 .sign{display:flex;justify-content:space-between;gap:20px;margin:2px 0}
        .t5 .sign .field{flex:1}
        .t5 .sign .field:first-child{margin-right:6px}
        .t5 .sign .field:last-child{margin-left:6px}
        .t5 .line{border-bottom:1px solid #000;height:15px;padding-left:4px}
        .t5 .consent{text-align:center;font-size:12px;font-weight:bold;color:#1f3f73;margin:4px 0 2px 0}
        .t5 .row{display:flex;align-items:center;margin:2px 0;font-size:10.5pt}
        .t5 .row .label{font-weight:bold;white-space:nowrap;margin-right:4px}
        .t5 .row .line{flex:1;border-bottom:1px solid #000;min-height:13px;padding-left:4px}
      `}</style>
      <div className="t5">
        <h1>VOLUNTEER AGREEMENT</h1>

        <p>You shall abide by the Organization's guidelines and volunteer policies as presented in the Volunteer Guidelines, and by all general or administrative rules, regulations, and directives of the Organization made from time to time, so long as they are not inconsistent with this agreement. For any work-related matter, issue, or communication, the volunteer must contact the concerned coordinator directly. <strong>Attire Guidelines:</strong> Monday to Friday [Formals]; Saturday [Smart Casuals].</p>

        <div className="section">Holiday &amp; Absence Policy (Clubbing Rule)</div>
        <p>Volunteer attendance will be considered for the entire month while determining monthly volunteer involvement. If a volunteer is absent immediately before or after a Sunday, weekly off, or declared public holiday, the intervening day(s) will also be counted as part of the absence. If a volunteer remains absent for more than 6 days in a calendar month, all Sundays, weekly offs, and public holidays during that month will also be considered. Exceptions may be reviewed by the Organization management for genuine reasons.</p>

        <div className="section">Volunteer Timings</div>
        <p>Volunteer timings are 10.00 AM to 7.00 PM OR 9.30 AM to 6.30 PM [including break time]; attendance is recorded through the attendance system OR manually. Lunch break is 30 minutes, between 1.30 and 2.00 PM. Half-day: reporting time is 2.00 PM and departure time is 3.00 PM; no lunch break is applicable on a half-day, and arriving late on a half-day will be recorded as absent. A cumulative grace period of 180 minutes per month is allowed for late arrival / early departure, as follows:</p>
        <table>
          <tr><th>Late / Early Departure Duration Per Month</th><th>Attendance Record Impact</th></tr>
          <tr><td>Up to 180 minutes</td><td>No impact on attendance record</td></tr>
          <tr><td>181 – 240 minutes</td><td>Recorded as half-day absence</td></tr>
          <tr><td>241 – 480 minutes</td><td>Recorded as one-day absence</td></tr>
          <tr><td>More than 480 minutes</td><td>Attendance reviewed by Organization management as per volunteer guidelines</td></tr>
        </table>

        <div className="section">Voluntary Withdrawal &amp; Separation</div>
        <p>A volunteer who wishes to step down must complete the handover process and return all assigned duties, documents, equipment, and Organization resources. A Letter of Appreciation is issued to volunteers who have completed at least one year of satisfactory association with the Organization.</p>

        <table>
          <tr><th width="28%">Guideline</th><th>Description</th></tr>
          <tr><td><b>Voluntary Withdrawal</b></td><td>Intimation Period: At least one month's advance notice is requested. Stepping down without completing the intimation period may affect the volunteer's eligibility for a Letter of Appreciation.</td></tr>
          <tr><td><b>Discontinuation Without Intimation</b></td><td>Absence from Organization activities for seven consecutive days without any communication will be treated as abandonment of volunteer responsibilities.</td></tr>
          <tr><td><b>Conclusion of Association</b></td><td>The association may be concluded due to non-involvement or violation of the Organization's Code of Conduct.</td></tr>
        </table>

        <div className="section">Acknowledgement</div>
        <p style={{marginBottom:30}}>The volunteer agrees to maintain confidentiality and indemnify the Organization from damages, claims, or disputes arising from any violation of confidentiality or obligations. Signing below confirms that the volunteer has read, understood, and accepted all terms.</p>
        <p style={{marginBottom:8}}>Yours sincerely,<br /><b style={{display:'block',marginTop:8}}>For Organization – HOD</b></p>
        <p style={{marginBottom:16}}>I accept all the terms and conditions as mentioned in this letter.</p>

        <div className="sign" style={{marginBottom:16}}>
          <div className="field">Volunteer Name <div className="line" style={{display:'block',marginTop:25,paddingBottom:4,minHeight:22}}>{personal.fullName || ''}</div></div>
          <div className="field">Signature <div className="line" style={{display:'block',marginTop:25}}></div></div>
        </div>
        <div className="sign">
          <div className="field">Manager Name / HOD <div className="line" style={{display:'block',marginTop:25}}></div></div>
          <div className="field">Signature <div className="line" style={{display:'block',marginTop:25}}></div></div>
        </div>
      </div>
    </div>
  );
}
