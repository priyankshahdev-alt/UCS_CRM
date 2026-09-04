import { formatIndianCurrency, amountInWords, formatReceiptDate } from '../services/pdfGenerator'
import beingSevakLogo from '../assets/beingsevaklogo.jpeg'
import beingSevakStamp from '../assets/beingsevakstamp.png'

const ACCENT = '#0082ad'

function formatAmount(amount) {
  return Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReceiptTemplateBeingSevak({ donor }) {
  const formattedDate = formatReceiptDate(donor['Receipt Date'])
  const amount = Number(donor['Amount']) || 0
  const hasRealAddr = donor['Address 1'] && !['NA', 'N/A'].includes(donor['Address 1'].trim())
  const cityState = [donor['City'], donor['State']].filter(Boolean).join(', ')
  const pin = donor['Pincode']
  const hasLocation = cityState || pin

  if (donor._dataMissing) {
    return (
      <div style={{ width:'1000px', margin:'0 auto', background:'#fff', padding:'40px', border:'2px solid #00a3da', color:'#222', fontFamily:'Arial, sans-serif', fontSize:'16px', lineHeight:'1.6', textAlign:'center' }}>
        <div style={{ fontSize:'48px', fontWeight:'bold', color:'#c0392b', marginTop:'100px' }}>DATA MISSING</div>
        <div style={{ fontSize:'20px', marginTop:'20px', color:'#666' }}>Receipt for <b>{donor['Donor Name'] || 'Unknown'}</b> could not be generated due to missing mandatory fields.</div>
        <div style={{ fontSize:'18px', marginTop:'30px', color:'#999' }}>Receipt No.: {donor['Receipt No.'] || 'N/A'}</div>
      </div>
    )
  }

  return (
    <div style={{ width:'1000px', fontFamily:"'Segoe UI', Arial, sans-serif" }}>
      <div style={{ background:'#fff', border:`2px solid ${ACCENT}`, borderRadius:'10px', padding:'22px', marginBottom:'20px' }}>
        <div style={{ display:'flex', borderBottom:`2px solid ${ACCENT}`, paddingBottom:'12px', marginBottom:'10px' }}>
          <div style={{ width:'90px', flexShrink:0 }}>
            <img src={beingSevakLogo} alt="Trust Logo" style={{ width:'80px', height:'auto', display:'block', marginTop:'11px', marginLeft:'10px' }} />
          </div>
          <div style={{ flex:1, textAlign:'center' }}>
            <div style={{ fontSize:'13px', fontWeight:600, color:ACCENT, marginBottom:'5px', lineHeight:'1.2' }}>We Rise By Lifting Others</div>
            <div style={{ fontSize:'20px', fontWeight:700, marginBottom:'4px' }}>Being Sevak Charitable Trust</div>
            <div style={{ fontSize:'11px', color:'#000', lineHeight:'1.3' }}>Charity Commissioner (Reg.) No: E-31948 &nbsp;|&nbsp; Income Tax Exempted Under 80G No: AACTB6422FF20214</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', marginTop:'12px', border:`2px solid ${ACCENT}`, borderRadius:'6px', background:'#eaf8ff', padding:'10px 12px' }}>
          <div style={{ flex:1, fontSize:'13px', color:'#333', fontWeight:500 }}>Receipt No: <strong>{donor['Receipt No.']}</strong></div>
          <div style={{ flex:2, textAlign:'center', fontWeight:700, color:ACCENT, letterSpacing:'1px', fontSize:'16px' }}>80G CERTIFICATE OF DONATION</div>
          <div style={{ flex:1, fontSize:'13px', color:'#333', fontWeight:500, textAlign:'right' }}>Date: <strong>{formattedDate}</strong></div>
        </div>
        <div style={{ marginTop:'18px', fontSize:'14px', lineHeight:'1.7', color:'#222' }}>
          <p><strong>Name: &nbsp;&nbsp;<span>{donor['Donor Name']}</span></strong></p>
          <p>Dear Sir/Madam,</p>
          <p><strong style={{ color:ACCENT }}>Being Sevak Charitable Trust</strong>, would like to thank you for your generous donation of <span style={{ fontWeight:700, marginLeft:'8px', marginRight:'8px', color:'#0a3d62' }}>Rs. {formatAmount(amount)}</span><strong style={{ fontWeight:700, paddingBottom:'5px' }}> {amountInWords(Math.floor(amount))}</strong> for a noble cause & making a difference.</p>
          <p>Your financial support helps us continue our mission of helping needy families through food kits, medical aid, education & other activities.</p>
          <p>Please keep this written acknowledgement for your tax records. We thank you once again for your support.</p>
          <p>Thanking you,<br />Yours truly,<br /><strong style={{ color:ACCENT }}>Being Sevak Charitable Trust</strong></p>
          <p style={{ fontSize:'11px', color:'#555', marginTop:'5px' }}>Note: Your Donation to Being Sevak Charitable Trust Is Eligible For 50% Tax Rebate [U/S 80G of Income Tax Act 1961]</p>
        </div>
      </div>
      <div style={{ margin:'20px 0', borderTop:`2px dashed ${ACCENT}` }} />
      <div style={{ background:'#fff', border:`2px solid ${ACCENT}`, borderRadius:'10px', padding:'22px' }}>
        <div style={{ display:'flex', borderBottom:`2px solid ${ACCENT}`, paddingBottom:'12px', marginBottom:'10px' }}>
          <div style={{ width:'90px', flexShrink:0 }}>
            <img src={beingSevakLogo} alt="Trust Logo" style={{ width:'80px', height:'auto', display:'block', marginTop:'11px', marginLeft:'10px' }} />
          </div>
          <div style={{ flex:1, textAlign:'center' }}>
            <div style={{ fontSize:'11px', color:'#555', fontWeight:400, marginTop:'-18px' }}>Subject to Mumbai Jurisdiction</div>
            <div style={{ fontSize:'20px', fontWeight:700, marginBottom:'4px' }}>Being Sevak Charitable Trust</div>
            <div style={{ fontSize:'11px', color:'#000', lineHeight:'1.4' }}>Charity Commissioner (Reg.) No: E-31948, Certificate Under Section 80G of the Income Tax Act 1961</div>
            <div style={{ fontSize:'11px', color:'#000', lineHeight:'1.4' }}>80G Registration No: AACTB6422FF20214 &nbsp;CSR Registration No: CSR00015528 Trust PAN CARD No : AACTB6422F</div>
            <div style={{ fontSize:'10px', color:'#000', lineHeight:'1.4' }}>Website: www.beingsevak.org &nbsp;Email: being.sevak@gmail.com &nbsp; Helpline Number SEVAK : 8879-035-035 / 8879-034-034</div>
            <div style={{ fontSize:'13px', color:'#000', lineHeight:'1.4' }}>Registered Add: 401, 4th Floor, 'A' Wing, New Delite Apartment, Chandavarkar Lane, Borivali (West), Mumbai - 92.</div>
          </div>
        </div>
        <div style={{ border:`2px solid ${ACCENT}` }}>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Receipt No:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'25%' }}>{donor['Receipt No.']}</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Dated:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'25%' }}>{formattedDate}</div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>RECEIVED with thanks from Ms./Mr./Miss.</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'75%' }}>{donor['Donor Name']}</div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Address:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'75%' }}>
              {hasRealAddr ? <>{donor['Address 1']}{hasLocation ? ' , ' : ''}{hasLocation ? <>{cityState}{cityState && pin ? ' - ' : ''}{pin}</> : null}</> : 'NA'}
            </div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>The Sum of Rupees:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'75%' }}>{amountInWords(Math.floor(amount))}</div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Mode of Payment:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'25%' }}>{donor['Mode of Payment (MOP)']}</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Payment ID No:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'25%' }}>{donor['Payment ID No.']}</div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>On Account Of:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'75%' }}>{donor['Account Of'] || 'Corpus'}</div>
          </div>
          <div style={{ display:'flex' }}>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:700, background:'#f3fbff', width:'25%' }}>Email ID:</div>
            <div style={{ border:`1px solid ${ACCENT}`, padding:'10px', fontSize:'13px', fontWeight:600, background:'#fff', width:'75%' }}>{donor['Email ID'] || donor['Email'] || 'NA'}</div>
          </div>
        </div>
        <div style={{ display:'flex', marginTop:'18px' }}>
          <div style={{ flex:1, border:`2px solid ${ACCENT}`, borderRadius:'8px', padding:'14px', background:'#fff', marginRight:'20px' }}>
            <div style={{ display:'flex', alignItems:'center', fontWeight:700, borderBottom:`1px solid ${ACCENT}`, paddingBottom:'8px', marginBottom:'8px' }}>
              <span style={{ fontWeight:800 }}>Amount (INR)</span>
              <span style={{ color:'#000', fontSize:'17px', marginLeft:'10px' }}>Rs.</span>
              <span style={{ fontSize:'18px', color:'#0a3d62', marginLeft:'10px' }}>{formatAmount(amount)}</span>
              <span style={{ marginLeft:'auto', fontWeight:700 }}>PAN NO:</span>
              <span style={{ fontWeight:700, color:'#222', marginLeft:'10px' }}>{donor['PAN No.'] || 'NA'}</span>
            </div>
            <div style={{ fontSize:'15px', color:'#555', textAlign:'center', marginTop:'25px' }}>Donation Payment is Subject to Realisation</div>
            <div style={{ fontSize:'15px', color:'#555', textAlign:'center', marginTop:'5px' }}>****This is system generated auto receipt****</div>
          </div>
          <div style={{ width:'180px', flexShrink:0, border:`2px solid ${ACCENT}`, borderRadius:'8px', textAlign:'center', padding:'10px', background:'#f9fdff' }}>
            <img src={beingSevakStamp} alt="Seal" style={{ width:'85px', marginLeft:'34px' }} />
            <div style={{ marginTop:'8px', fontSize:'12px', fontWeight:700 }}>Authorised Sign.<br /><strong style={{ color:'#222' }}>Being Sevak Charitable Trust</strong></div>
          </div>
        </div>
      </div>
    </div>
  )
}
