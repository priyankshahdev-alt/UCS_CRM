import { formatIndianCurrency, amountInWords, formatReceiptDate } from '../services/pdfGenerator'
import ashrayLogo from '../assets/ahsraylogo.png'
import ashrayStamp from '../assets/ashraystamp.PNG'

const ORG = {
  ashray: {
    tagline: 'RAY OF HOPE',
    name: 'ASHRAY FOR LIFE FOUNDATION',
    regNo: 'Charity Commissioner (Reg.) No : E-37237',
    cert80g: 'Certificate Under Section 80G of Income Tax Act 1961',
    reg80g: '80G Registration No : AAJTA4535BF2022101',
    csrReg: 'CSR Registration No : CSR00069515',
    panCard: 'PAN CARD No : AAJTA4535B',
    address: 'Unit - 218, 2nd Floor, Auris Galleria, New Link Road, Auris Serenity, Malad (West), Mumbai - 400064.',
    website: 'www.aflf.org',
    email: 'ashray.foundation22@gmail.com',
    helpline: ' 9930028300 / 9930028200',
    donorEmail: 'donorcare@aflf.org',
  },
}

const primary = '#4A6FA5'
const primaryDark = '#3A5A8A'
const secondary = '#6B8FC4'
const borderColor = '#D4E0F0'
const dark = '#2C3E50'
const grad = 'linear-gradient(135deg, #4A6FA5 0%, #6B8FC4 50%, #8FB4D8 100%)'

export default function ReceiptTemplateAshray({ donor, project }) {
  const formattedDate = formatReceiptDate(donor['Receipt Date'])
  const amount = Number(donor['Amount']) || 0
  const org = ORG[project] || ORG.ashray
  const hasRealAddr = donor['Address 1'] && !['NA', 'N/A'].includes(donor['Address 1'].trim())
  const cityState = [donor['City'], donor['State']].filter(Boolean).join(', ')
  const pin = donor['Pincode']
  const hasLocation = cityState || pin

  if (donor._dataMissing) {
    return (
      <div style={{ width:'794px', margin:'0 auto', background:'#f4f4f4', border:`4px solid ${primary}`, padding:'40px', textAlign:'center', fontFamily:'Arial, sans-serif' }}>
        <div style={{ fontSize:'48px', fontWeight:'bold', color:primaryDark, marginTop:'100px' }}>DATA MISSING</div>
        <div style={{ fontSize:'20px', marginTop:'20px', color:'#666' }}>Receipt for <b>{donor['Donor Name'] || 'Unknown'}</b> could not be generated due to missing mandatory fields.</div>
        <div style={{ fontSize:'18px', marginTop:'30px', color:'#999' }}>Receipt No.: {donor['Receipt No.'] || 'N/A'}</div>
      </div>
    )
  }

  return (
    <div style={{ width:'794px', margin:'0 auto', background:'#fff', overflow:'hidden', border:`2px solid ${primary}`, fontFamily:"'Segoe UI', Arial, sans-serif" }}>
      <div style={{ display:'flex', alignItems:'center', padding:'9px', background:grad, color:'#fff' }}>
        <div style={{ width:'170px', textAlign:'center' }}><img src={ashrayLogo} alt="Logo" style={{ maxWidth:'100%' }} /></div>
        <div style={{ flex:1, textAlign:'center' }}>
          <div style={{ fontSize:'13px', letterSpacing:'3px', opacity:0.9, marginRight:'136px' }}>{org.tagline}</div>
          <div style={{ fontSize:'30px', fontWeight:800, margin:'5px 0', marginRight:'110px' }}>{org.name}</div>
          <div style={{ fontSize:'11px', lineHeight:'1.6', marginRight:'110px' }}>{org.regNo}, {org.cert80g}<br />{org.reg80g}{org.csrReg ? <> | {org.csrReg}</> : ''}<br />{org.panCard}</div>
        </div>
      </div>
      <div style={{ background:borderColor, color:primary, textAlign:'center', fontSize:'24px', fontWeight:800, padding:'14px', borderBottom:`2px solid ${borderColor}`, letterSpacing:'1px' }}>80G CERTIFICATE OF DONATION</div>
      <div style={{ padding:'25px' }}>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>Dated:</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}`, maxWidth:'120px' }}>{formattedDate}</div>
          <div style={{ flex:1 }} />
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>Receipt No.</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}`, maxWidth:'120px' }}>{donor['Receipt No.']}</div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>Received from thanks Mr./Mrs./Ms :</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>{donor['Donor Name']}</div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>Address:</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>
            {hasRealAddr ? <>{donor['Address 1']}{hasLocation ? ', ' : ''}{hasLocation ? <>{cityState}{cityState && pin ? ' - ' : ''}{pin}</> : null}</> : 'NA'}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>The Sum of Rupees:</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>{amountInWords(amount)}</div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', gap:'20px' }}>
          <div style={{ display:'flex', alignItems:'flex-end', flex:1 }}>
            <span style={{ fontWeight:700, color:dark, marginRight:'8px', whiteSpace:'nowrap', marginBottom:'5px' }}>Mode of Payment:</span>
            <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>{donor['Mode of Payment (MOP)']}</div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-end', flex:1 }}>
            <span style={{ fontWeight:700, color:dark, marginRight:'8px', whiteSpace:'nowrap', marginBottom:'5px' }}>Payment ID No :</span>
            <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>{donor['Payment ID No.']}</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'flex-end', marginBottom:'18px', flexWrap:'wrap' }}>
          <span style={{ fontWeight:700, color:dark, marginRight:'8px', marginBottom:'5px' }}>Account Of:</span>
          <div style={{ flex:1, minHeight:'28px', padding:'4px 8px', color:'#222', fontWeight:600, borderBottom:`2px solid ${secondary}` }}>{donor['Account Of'] || 'Corpus'}</div>
        </div>
        <div style={{ display:'flex', gap:'20px', marginTop:'25px' }}>
          <div style={{ flex:1 }}>
            <div style={{ height:'65px', borderRadius:'12px', border:`2px solid ${secondary}`, background:borderColor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', fontWeight:700, color:primary }}>
              <div style={{ flex:1, textAlign:'center', marginBottom:'20px' }}>Amount (INR).</div>
              <div style={{ flex:1, textAlign:'center', marginBottom:'20px' }}>Rs.{amount.toFixed(2)}</div>
            </div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ height:'65px', borderRadius:'12px', border:`2px solid ${secondary}`, background:borderColor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', fontWeight:700, color:primary }}>
              <div style={{ flex:1, textAlign:'center', marginBottom:'20px' }}>PAN NO.</div>
              <div style={{ flex:1, textAlign:'center', marginBottom:'20px' }}>{donor['PAN No.'] || 'NA'}</div>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'30px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'20px' }}>
            <div style={{ fontSize:'80px', fontWeight:900, color:primary, lineHeight:1, marginBottom:'60px' }}>80G</div>
            <div style={{ width:'320px', padding:'15px', borderRadius:'12px', border:`2px solid ${secondary}`, background:borderColor, lineHeight:'1.8', fontSize:'14px' }}>
              Donation To {org.name}<br />Eligible For 50% Income tax deduction<br />80G of Income tax act 1961
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <img src={ashrayStamp} alt="Stamp" style={{ width:'120px', marginBottom:'10px', marginLeft:'60px' }} />
            <div style={{ fontSize:'17px', fontWeight:700, color:primary }}>Authorised Sign.</div>
            <div style={{ fontSize:'18px', fontWeight:800, color:dark }}>{org.name}.</div>
          </div>
        </div>
        <div style={{ marginTop:'25px', textAlign:'center', background:borderColor, padding:'12px', borderRadius:'10px', color:primary, fontWeight:700 }}>
          Donation Payment is Subject to Realisation<br />****This is system generated auto receipt****
        </div>
      </div>
      <div style={{ margin:'0 25px 25px', borderRadius:'15px', border:`2px solid ${borderColor}`, background:borderColor, padding:'25px' }}>
        <div style={{ textAlign:'center', color:primary, fontSize:'24px', fontWeight:800, marginBottom:'20px' }}>Thankyou for your Valuable Donation.</div>
        <p style={{ marginBottom:'15px', lineHeight:'1.8', color:'#444', fontSize:'14px' }}>* Together we are making a difference! Your continued support of our mission is deeply gratifying to us, and we hope it is the same for you. Your contribution is enabling us to accomplish in the field of Health, Education, Sustainability, Vocational Training, Empowering Women and Child Development.</p>
        <p style={{ marginBottom:'15px', lineHeight:'1.8', color:'#444', fontSize:'14px' }}>* If You Have any Question regarding this 80G Tax Deduction Certificate, Kindly get in touch with our Donor Relation Officer at {org.donorEmail} by quoting Unique Receipt Number.</p>
        <p style={{ marginBottom:'15px', lineHeight:'1.8', color:'#444', fontSize:'14px' }}>* This Receipt is invalid in case of non-realization of the money instrument or reversal of the credit/debit card charges or reversal of donation amount.</p>
        <div style={{ textAlign:'center', fontWeight:700, color:dark, marginTop:'20px' }}>Subject to Mumbai Jurisdiction</div>
      </div>
      <div style={{ background:grad, color:'#fff', textAlign:'center', padding:'18px', fontSize:'12px', lineHeight:'1.8' }}>
        Regd. Add: {org.address}<br />Website: {org.website} | Email: {org.email}<br />Helpline Number: {org.helpline}
      </div>
    </div>
  )
}
