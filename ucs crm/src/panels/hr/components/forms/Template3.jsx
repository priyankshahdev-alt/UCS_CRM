export default function Template4({ personal }) {
  return (
    <div className="print-page">
      <style>{`
        .t4 *{box-sizing:border-box}
        .t4{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:8mm 12mm;font-family:"Times New Roman",serif;overflow:hidden;display:flex;flex-direction:column}
        .t4 .title{text-align:center;color:#1f3f73;font-size:24pt;font-weight:bold;margin:0 0 12px;text-decoration:underline}
        .t4 .sec{color:#7b2020;font-weight:bold;font-size:12pt;margin-top:5px}
        .t4 p{font-size:10pt;line-height:1.25;text-align:justify;margin:1.5px 0}
      `}</style>
      <div className="t4">
        <div className="title">VOLUNTEER GUIDELINES (CONTINUED)</div>

        <div className="sec">8. Organization Assets &amp; Resources</div>
        <p>All assets, equipment, documents, electronic devices, identification cards, communication tools, and other property belonging to the Organization are provided solely for the Organization's work. Volunteers shall exercise due care while using such resources and shall not use them for personal or unauthorized activities. Any loss, theft, damage, or misuse resulting from negligence or misconduct may be reviewed by the Organization. Upon completion or conclusion of the volunteer association, all Organization property must be returned immediately in good condition.</p>

        <div className="sec">9. Confidentiality</div>
        <p>Volunteers shall maintain strict confidentiality regarding all information obtained during their association with the Organization. Confidential information includes, but is not limited to, donor details, beneficiary records, financial information, internal reports, project documentation, login credentials, CRM data, operational strategies, and any other non-public information belonging to the Organization. Volunteers shall not disclose, copy, share, or use confidential information for personal benefit or disclose it to any third party without prior written authorization from the Organization.</p>

        <div className="sec">10. Social Media Usage</div>
        <p>Volunteers shall not publish, post, upload, or distribute any information, photographs, videos, documents, or confidential material relating to the Organization through personal social media platforms or any public forum without obtaining prior approval from the authorized representatives of the Organization. The Organization may, however, use photographs, videos, names, testimonials, or recordings of volunteers for its official website, social media platforms, awareness campaigns, reports, newsletters, brochures, and other promotional or educational purposes unless the volunteer has submitted a written objection in advance.</p>

        <div className="sec">11. Time Away / Absence</div>
        <p>Volunteers are expected to inform their coordinator well in advance whenever they need to be away from their duties. Emergency absences shall be communicated immediately through appropriate means. Repeated absenteeism, unnotified absence, or continuous absence without proper information may adversely affect the volunteer's association with the Organization and may result in the conclusion of the volunteer's association.</p>

        <div className="sec">12. Restricted Areas</div>
        <p>Certain areas within the Organization premises are restricted to authorized personnel only. Volunteers shall not enter management cabins, the Accounts Department, coordination offices, server rooms, storage areas, or any other restricted location without obtaining prior permission from the concerned authority. Unauthorized access to restricted areas may lead to appropriate action.</p>

        <div className="sec">13. Attire Guidelines</div>
        <p>Volunteers are expected to maintain a clean, neat, and presentable appearance at all times while representing the Organization. Formal attire shall be worn from Monday to Friday, while smart casual attire may be permitted on Saturdays unless otherwise instructed. Volunteers are expected to present themselves in a manner consistent with the values and image of the Organization.</p>

        <div className="sec">14. Code of Conduct</div>
        <p>Every volunteer shall perform assigned responsibilities honestly, ethically, and responsibly while respecting fellow volunteers, coordinators, beneficiaries, donors, visitors, and members of the public. Volunteers are expected to protect Organization property, maintain punctuality, preserve confidentiality, comply with all organizational guidelines, and conduct themselves with integrity and accountability throughout their period of association with the Organization.</p>

        <div className="sec">15. Grievance Resolution</div>
        <p>Any volunteer experiencing concerns, disputes, or grievances relating to conduct within the Organization, operations, or interpersonal issues should first report the matter to the concerned Team Leader. If the matter remains unresolved, the volunteer may escalate the issue to the Volunteer Coordination Team or the Organization for appropriate review and resolution. The Organization is committed to addressing genuine concerns fairly, impartially, and confidentially.</p>

        <div className="sec">16. Voluntary Withdrawal</div>
        <p>A volunteer who wishes to discontinue their association with the Organization should communicate their decision in writing to the appropriate authority and complete the proper handover of all assigned responsibilities, documents, equipment, identification cards, and other Organization assets before their final day of association.Volunteers must provide 1 month's notice during probation and 30 days' notice after confirmation before leaving the Organization. Failure to complete the required notice period may result in loss of eligible expenses/benefits. Absence for 7 consecutive days without prior intimation will be treated as abandonment of service (absconding), making the volunteer ineligible for expenses/benefits. The Organization reserves the right to terminate a volunteer's service due to poor performance or violation of the Code of Conduct. Training expenses of ₹6,000 shall be applicable as per the Organization's policy.</p>

        <div className="sec">17. Conclusion of Volunteer Association</div>
        <p>The Organization reserves the right to conclude the association of any volunteer at its discretion in cases involving misconduct, repeated absenteeism, misuse of Organization property, breach of confidentiality, fraud, harassment, violation of organizational guidelines, or any conduct considered detrimental to the interests, reputation, or objectives of the Organization.</p>

        <div className="sec">18. Volunteer Appreciation Certificate</div>
        <p>The Organization may issue a Volunteer Appreciation Certificate or Letter of Gratitude to volunteers who have successfully completed their period of service with satisfactory involvement and conduct, subject to the applicable guidelines and approval of the Organization management.</p>
      </div>
    </div>
  );
}
