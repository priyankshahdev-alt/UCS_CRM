import { formatIndianCurrency, amountInWords, formatReceiptDate } from '../services/pdfGenerator'
import defaultSignature from '../assets/stamp.png'
import MancareLogo from '../assets/MAANCareLogo.jpeg'

export default function ReceiptTemplateManncar({ donor, index }) {
  const formattedDate = formatReceiptDate(donor['Receipt Date'])
  const amount = Number(donor['Amount']) || 0
  const rawAddr1 = donor['Address 1'] || ''
  const cleanAddr = rawAddr1.replace(/,?\s*NA$/i, '').trim()
  const hasRealAddr = cleanAddr && !['NA', 'N/A', ''].includes(cleanAddr)
  const cityState = [donor['City'], donor['State']].filter(Boolean).join(', ')
  const pin = donor['Pincode']
  const hasLocation = cityState || pin

  if (donor._dataMissing) {
    return (
      <div
        data-receipt-sheet
        data-pdf-width="1000"
        style={{ width:'1000px', margin:'0 auto', background:'#fff', padding:'40px', border:'2px solid #e4008d', color:'#222', fontFamily:'Arial, sans-serif', fontSize:'16px', lineHeight:'1.6', textAlign:'center' }}
      >
        <div style={{ fontSize:'48px', fontWeight:'bold', color:'#e4008d', marginTop:'100px' }}>DATA MISSING</div>
        <div style={{ fontSize:'20px', marginTop:'20px', color:'#666' }}>Receipt for <b>{donor['Donor Name'] || 'Unknown'}</b> could not be generated due to missing mandatory fields.</div>
        <div style={{ fontSize:'18px', marginTop:'30px', color:'#999' }}>Receipt No.: {donor['Receipt No.'] || 'N/A'}</div>
      </div>
    )
  }

  return (
    <div
      data-receipt-sheet
      data-pdf-width="1000"
      style={{ width:'1000px', margin:'0 auto', background:'#fff', padding:'40px', border:'1px solid #ddd', color:'#222', fontFamily:'Arial, sans-serif', fontSize:'16px', lineHeight:'1.6' }}
    >
      <div style={{ textAlign:'center', fontSize:'25px', fontWeight:'bold', marginTop:'10px' }}>CERTIFICATE OF DONATION</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ width:'50%', lineHeight:'1.6', fontSize:'16px' }}>
          <b>Receipt No.:</b> {donor['Receipt No.'] || 'NA'}<br /><br />
          Dated : {formattedDate}<br /><br />
          <span style={{ fontWeight:'bold' }}>Name : - {donor['Donor Name']?.toUpperCase() || 'NA'}</span><br />
          Address. - {hasRealAddr ? <>{cleanAddr}<br />{hasLocation ? <>{cityState}{cityState && pin ? ' - ' : ''}{pin}<br /></> : null}</> : <>NA<br /></>}
          PAN No. - {donor['PAN No.'] || 'NA'}<br />
          Email - {donor['Email ID'] || 'NA'}
        </div>
        <div style={{ width:'42%', textAlign:'right' }}>
          <img src={MancareLogo} alt="Mann Care Foundation" style={{ width:'200px', height:'auto', display:'block', marginLeft:'auto', marginBottom:'10px' }} />
          <div style={{ color:'#d10087', lineHeight:'1.8', fontSize:'18px' }}>
            CSR Registration No : CSR00115793<br />
            Unique Registration No : AAUCM9048BE20261<br />
            CIN No : U88900MH2026NPL471199<br />
            TAN No : MUMM75033A<br />
            Trust PAN Card No : AAUCM9048B
          </div>
        </div>
      </div>
      <hr style={{ margin:'25px 0 20px', border:'none', borderTop:'1px solid #999' }} />
      <div style={{ textAlign:'center', fontSize:'32px', fontWeight:'bold', marginBottom:'25px' }}>DONATION RECEIPT</div>
      <div style={{ fontSize:'20px', textAlign:'center', marginBottom:'25px' }}>We confirm the receipt of donation from Mr/Ms/Mrs <strong>{donor['Donor Name']?.toUpperCase() || 'Unknown'}</strong> as per details below:-</div>
      <table style={{ width:'80%', margin:'0 auto 30px', borderCollapse:'collapse', fontSize:'18px' }}>
        <tbody>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Donation Date</td><td style={{ border:'1px solid #666', padding:'15px' }}>{formattedDate || 'NA'}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Transaction / Reference Number</td><td style={{ border:'1px solid #666', padding:'15px' }}>{donor['Payment ID No.'] || 'NA'}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Payment Mode</td><td style={{ border:'1px solid #666', padding:'15px' }}>{donor['Mode of Payment (MOP)'] || 'NA'}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Email Address</td><td style={{ border:'1px solid #666', padding:'15px' }}>{donor['Email ID'] || 'NA'}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Account Of</td><td style={{ border:'1px solid #666', padding:'15px' }}>{donor['Account Of'] || 'Corpus'}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Total Contribution Received (Numbers)</td><td style={{ border:'1px solid #666', padding:'15px' }}>{formatIndianCurrency(amount)}</td></tr>
          <tr><td style={{ border:'1px solid #666', padding:'15px' }}>Total Contribution Received (Words)</td><td style={{ border:'1px solid #666', padding:'15px' }}>{amountInWords(amount)}</td></tr>
        </tbody>
      </table>
      <div style={{ marginTop:'35px', lineHeight:'1.7', fontSize:'18px' }}>
        Dear <strong>{donor['Donor Name']?.toUpperCase() || 'Unknown'}</strong><br /><br />
        Thank You for Your Generous Support {formatIndianCurrency(amount)} On behalf of Mann Care Foundation, we sincerely thank you for your valuable contribution. Your generosity helps us continue our mission of supporting those in need and creating a positive impact in the community. Thank you for being a part of this noble cause and helping us make a difference.<br />
        Please keep this written acknowledgement of your donation for your tax records.
      </div>
      <div style={{ fontSize:'18px', lineHeight:'1.8', marginBottom:'25px', textAlign:'justify' }}>
        Donations to <span style={{ color:'#d10087', fontWeight:'bold' }}>Mann Care Foundation</span> will qualify for deduction under Section 80G(5) of the Income Tax Act, 1961, subject to approval and registration under Section 80G by the Income Tax Department. This receipt is invalid in case of non-realization of the money instrument or reversal of the credit/debit card charge or reversal of donation amount for any reason. IT PAN : <span style={{ color:'#d10087', fontWeight:'bold' }}>AAUCM9048B.</span>
      </div>
      <div style={{ fontSize:'18px', lineHeight:'1.8', marginBottom:'25px', textAlign:'justify' }}>
        Please note that this is an acknowledgement for the receipt of donation. We will provide you the Form 10BE on which income-tax deduction can be claimed as per the income-tax rules Subject to Approval from income tax department.
      </div>
      <div style={{ fontSize:'18px', lineHeight:'1.8', marginBottom:'25px' }}>
        This is a computer generated receipt. Incase of any discrepancy or queries please email <span style={{ color:'#d10087', fontWeight:'bold' }}>manncarefoundation@gmail.com</span>
      </div>
      <div style={{ marginTop:'25px', display:'flex', flexDirection:'column', alignItems:'flex-start' }}>
        <img src={defaultSignature} alt="Authorised Signatory" style={{ width:'178px', display:'block', margin:0, padding:0, marginTop:'-16px' }} />
        <div style={{ marginTop:'-10px', fontWeight:'bold', fontSize:'18px', lineHeight:'1.2' }}>For Mann Care Foundation</div>
        <div style={{ marginTop:'2px', fontSize:'16px', lineHeight:'1.2' }}>(Authorised Signatory)</div>
      </div>
      <div style={{ borderTop:'1px solid #999', marginTop:'30px', paddingTop:'25px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', textAlign:'center', marginBottom:'20px' }} />
      </div>
      <div style={{ background:'#d10087', color:'#fff', padding:'15px 20px', marginTop:'20px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', textAlign:'center' }}>
          <div style={{ flex:1 }}><div style={{ fontWeight:'bold' }}>Website :</div><div>www.manncarefoundation.org</div></div>
          <div style={{ flex:1 }}><div style={{ fontWeight:'bold' }}>E-Mail :</div><div>manncarefoundation@gmail.com</div></div>
          <div style={{ flex:1 }}><div style={{ fontWeight:'bold' }}>Trust PAN CARD No. :</div><div>AAUCM9048B</div></div>
        </div>
        <div style={{ textAlign:'center', marginTop:'12px', fontWeight:'bold' }}>Helpline Number MANN: +91 7039006300 / +91 7039006400</div>
        <div style={{ width:'100%', fontSize:'18px', lineHeight:'1.6' }}><b>Registered Office  :</b> 1708, One World, S.V. Road, Near N.M. High School, Malad (West),Mumbai - 400064</div>
      </div>
      <div style={{ marginTop:'10px', textAlign:'center', fontSize:'15px', fontWeight:'600', color:'#050000' }}>
        Subject to Mumbai Jurisdiction
        <div style={{ marginTop:'10px', textAlign:'center', fontSize:'10px', fontWeight:'600', color:'#050000' }} />
        Donation Payment is Subject to Realisation
      </div>
    </div>
  )
}
