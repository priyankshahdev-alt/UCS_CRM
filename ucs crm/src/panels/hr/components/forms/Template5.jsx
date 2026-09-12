export default function Template6({ personal, declarationDate, place }) {
  return (
    <div className="print-page">
      <style>{`
        .t6 *{box-sizing:border-box}
        .t6{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;position:relative;padding:10px 18px 12px 18px;overflow:hidden;font-family:"Times New Roman",serif;display:flex;flex-direction:column}
        .t6 .inner{border:1px solid #222;padding:6px 16px 10px 16px;flex:1;display:flex;flex-direction:column}
.t6 p{margin:2px 0;font-size:16px;line-height:1.3;text-align:justify}
.t6 .b{font-weight:bold}
.t6 .blue{font-size:26px;color:#29446f;text-align:center;font-weight:bold;margin:10px 0 6px}
.t6 .row{font-size:16px;margin:1.5px 0}
        .t6 .line{display:inline-block;border-bottom:1px solid #000;min-width:120px;height:15px;vertical-align:bottom}
        .t6 .long{min-width:230px}
        .t6 .med{min-width:180px}
        .t6 .small{min-width:80px}
        .t6 .sigwrap{display:flex;justify-content:space-between;align-items:flex-start;margin-top:20px}
        .t6 .sig{width:45%}
        .t6 .sig .l{border-bottom:1px solid #000;height:22px}
.t6 .sig div:last-child{text-align:left;font-size:13px;margin-top:3px}
      `}</style>
      <div className="t6">
        <div className="inner">
          <div className="blue" style={{marginTop: 0}}>VOLUNTEER CONFIDENTIALITY / NON-DISCLOSURE AGREEMENT</div>

          <p>This agreement is made between the Organization and the Volunteer on <span className="line med">{personal?.fullName || ''}</span>. While volunteering, the Volunteer may receive Confidential Information concerning matters affecting or relating to the Organization. The Volunteer agrees as follows:</p>

          <p><span className="b">A.</span> Confidential Information and Proprietary Data are the Organization's exclusive property. The Volunteer shall keep them confidential, take reasonable steps to protect them, and not disclose or use them for personal benefit or the benefit of others during or after association with the Organization.</p>

          <p><span className="b">B.</span> Notes, notebooks, computer disks, pen drives, documents, equipment, and devices containing such information are the property of the Organization and must not be removed from Organization premises. They shall be returned immediately upon conclusion of the volunteer association.</p>

          <p><span className="b">C.</span> The Volunteer shall not reproduce or commercially use Confidential Information for any purpose other than carrying out duties for the Organization.</p>

          <p><span className="b">D.</span> The Organization may take appropriate action, including conclusion of the volunteer association, and pursue civil or criminal remedies for violations. This agreement is governed by the laws of Maharashtra (Mumbai).</p>

          <p><span className="b">E.</span> On withdrawal, the Volunteer shall surrender all Organization assets, official WhatsApp, email ID, contact number, and other Organization-related items. Failure to comply may result in appropriate action.</p>

          <p><span className="b">F.</span> All provisions apply only to the extent they do not violate applicable law. The Volunteer warrants that no conflicting obligation exists.</p>

          <p style={{marginTop: 14, paddingTop: 10}}><span className="b" >Declaration :</span></p>
          <div style={{display: 'flex', alignItems: 'flex-start', gap: 8}}>
            <input type="checkbox" style={{marginTop: 3, width: 14, height: 14, accentColor: '#7f2d2d', flexShrink: 0}} />
            <p style={{margin: 0}}>I hereby declare that the above statement made in my application is true, complete, and correct to the best of my knowledge and belief. In the event of any information being found false or incorrect at any stage, my services are liable to be terminated without notice.</p>
          </div>

          <div className="row" style={{marginTop: 12, paddingTop: 8, display: 'flex', alignItems: 'center', gap: 20}}>
            <span>Date: {declarationDate ? new Date(declarationDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : <><span className="line small"></span>/<span className="line small"></span>/<span className="line small"></span></>}</span>
            <span>Place: {place || 'Mumbai'}</span>
          </div>

          <div className="sigwrap">
            <div className="sig">
              <div className="l"></div>
              <div>Volunteer Name &amp; Signature</div>
            </div>

            <div className="sig">
              <div className="l"></div>
              <div>For Organization (Authorized Signatory)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
