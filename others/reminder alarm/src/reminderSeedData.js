const financeRow = (title) =>
  ['BSCT', 'AFLF', 'MANN', 'Priyank Shah', 'Priyank Shah HUF', 'Shweta Shah'].map(o => ({ title }))

const financeEntityRows = () =>
  ['BSCT', 'AFLF', 'MANN', 'Priyank Shah', 'Priyank Shah HUF', 'Shweta Shah'].map(o => ({ title: o }))

const rentTdsEntityRows = () => ['BSCT', 'AFLF', 'MANN'].map(o => ({ title: o }))

export const REMINDER_SECTIONS = [
  {
    heading: 'Education School Fees',
    category: 'EDUCATION',
    rows: [
      { title: 'Priyansh Policy No. (007493022 Rs. 50K) of Education (Aditya Birla Capital)', owner: 'Shweta Shah', due: '1st Feb every year', renewal: '1st Feb every year' },
      { title: 'Priyansh Policy No. (007493097 Rs. 50K) of Education (Aditya Birla Capital)', owner: 'Shweta Shah', due: '1st Feb every year', renewal: '1st Feb every year' },
      { title: 'Priyansh School Expenses', owner: 'Shweta Shah' },
    ],
  },
  {
    heading: 'Vehicle Insurance',
    subgroups: [
      {
        heading: 'Car - Four Wheeler',
        category: 'VEHICLE_INSURANCE',
        rows: [
          { title: 'MG Hector 9999 Future Generally Car Insurance Premium Rs. 17,274/-', owner: 'Priyank Shah', due: '25th May of Every Year', renewal: '25th May, 2027' },
          { title: 'MG Hector 9999 PUC Vehicle No. MH13EK9999', owner: 'Priyank Shah', due: '7th Feb, 2024', renewal: '27th Aug, 2027' },
        ],
      },
      {
        heading: 'Bike - Two Wheeler',
        category: 'VEHICLE_INSURANCE',
        rows: [
          { title: 'Yamaha Bike Insurance MH-47BQ7655 TATA AIG Gen. Insurance Policy No. 61006197690000 Valid Upto 4th Dec, 2028', owner: 'Shweta Shah', due: '4th Dec, 2028', renewal: '1st Dec, 2028' },
          { title: 'Yamaha Bike PUC', owner: 'Shweta Shah', due: '29th Jan, 2026', renewal: '30th Jan, 2026' },
          { title: 'Honda White Activa MH-02 CM-9337 Engine No. JC44E5148617 Policy No. D-182640541/ 13012025', owner: 'Shweta Shah', due: '13th Jan, 2027', renewal: '1st Jan, 2027' },
          { title: 'Honda White Activa PUC', owner: 'Shweta Shah' },
        ],
      },
    ],
  },
  {
    heading: 'Property & Taxes',
    subgroups: [
      {
        heading: 'Property Maintenance',
        category: 'PROPERTY_MAINTENANCE',
        rows: [
          { title: '1) Sanjar Flat No. 506', owner: 'Priyank Shah', due: '15th of Every 3 Months', renewal: '15th April, 2026', paidAmount: '₹1,33,592' },
          { title: '2) Sanjar One World Office No. 1708', owner: 'Priyank Shah' },
          { title: '3) Login Flat No. 205', owner: 'Priyank Shah', lastPaid: '7.9.2026', paidAmount: '₹35,381' },
          { title: '4) Auris Office No. 218', owner: 'Shweta Shah', due: '1.6.2026', renewal: '30.11.2026', lastPaid: '10.8.2026', paidAmount: '₹1,19,069' },
          { title: '5) New Delight (Flat No. 401) 2 Months Bill Pattern', owner: 'Priyank Shah', due: '5th of Every Alternate month', renewal: '5th of Every Alternate month', lastPaid: '31.8.2026', paidAmount: '₹4,144' },
        ],
      },
      {
        heading: 'Property BMC Tax',
        category: 'BMC_TAX',
        rows: [
          { title: '1) Sanjar Office No. 506 Account No. RS0200240020030', owner: 'Priyank Shah', lastPaid: '7.9.2026', paidAmount: '₹55,880' },
          { title: '2) Auris', owner: 'Shweta Shah' },
          { title: '3) Login Flat No. 205 Account No. RS0406272780009', owner: 'Priyank Shah', lastPaid: '7.9.2026', paidAmount: '₹4,884' },
          { title: '4) Sanjar One World Office No. 1708 Account No. PN0906610310169', owner: 'Priyank Shah', due: '1st April, 2025 till date pending', renewal: 'Every 6 Months', lastPaid: '7.9.2026', paidAmount: '₹47,608' },
          { title: '5) New Delight (Flat No. 401)', owner: 'Priyank Shah' },
        ],
      },
    ],
  },
  {
    heading: 'Rent',
    category: 'RENT_TDS',
    rows: [
      { title: 'Ashray Rent (Manish Anil Dattani)', owner: 'AFLF', due: '5th of Every Month', renewal: 'NA', lastPaid: '7.9.26', paidAmount: '₹73,000' },
      { title: 'Ashray Rent (Manish Anil Dattani) TDS', owner: 'AFLF', due: 'March of Every Year', renewal: 'NA' },
      { title: 'BSCT Rent (Chiraag Anil Dattani)', owner: 'BSCT', due: '5th of Every Month', renewal: 'NA', lastPaid: '7.9.26', paidAmount: '₹80,000' },
      { title: 'BSCT Rent (Chiraag Anil Dattani) TDS', owner: 'BSCT', due: 'March of Every Year', renewal: 'NA' },
      { title: 'MANN Rent (Bijal Anil Dattani)', owner: 'MANN', due: '5th of Every Month', renewal: 'NA', lastPaid: '7.9.26', paidAmount: '₹47,000' },
      { title: 'MANN Rent (Bijal Anil Dattani) TDS', owner: 'MANN', due: 'March of Every Year', renewal: 'NA' },
      { title: 'Raj Cresent (Priyank Sir)', owner: 'Priyank Shah', due: '3rd every month', renewal: '3rd every month', lastPaid: '7.9.2026', paidAmount: '₹34,740' },
    ],
  },
  {
    heading: 'LIC / Insurance',
    subgroups: [
      {
        heading: 'Insurance',
        category: 'INSURANCE',
        rows: [
          { title: 'Aditya Birla Capital (Health Insurance Shweta Madam and Priyansh) Premium Rs. 9,617/- Policy No. 23-18-0048782-04', owner: 'Shweta Shah', due: '1st Dec every year', renewal: '1st Dec, 2026' },
          { title: 'Tata AIG Life Insurance Term Plan (Priyank Sir) Premium Rs. 9,794/- (Policy No. C-301269757)', owner: 'Priyank Shah', due: '1st Dec every year', renewal: '1st Dec, 2026' },
          { title: 'The New India Assurance Co. Ltd. Priyank Sir Mediclaim Policy No. 11250061259500000906 Customer ID No. H4412309 Rs. 18,699/-', owner: 'Priyank Shah', due: '25th June every Year', renewal: '25th June, 2026', lastPaid: '22.6.2026', paidAmount: '₹18,699' },
        ],
      },
      {
        heading: 'Policy',
        category: 'INSURANCE',
        rows: [
          { title: 'Priyank Sir LIC Policy No. 1 (905633591) (8.8.2007) Premium Rs. 3250', owner: 'Priyank Shah', due: '1st Aug every year', renewal: '1st Aug, 2026', lastPaid: '26.8.26', paidAmount: '₹3,250' },
          { title: 'Priyank Sir LIC Policy No. 2 (905936640) (14.8.2008) Premium Rs. 16,222/-', owner: 'Priyank Shah', due: '1st Aug every year', renewal: '1st Aug, 2026', lastPaid: '26.8.26', paidAmount: '₹16,222' },
        ],
      },
    ],
  },
  {
    heading: 'Utility Bills',
    subgroups: [
      {
        heading: 'Electricity Bill',
        category: 'ELECTRICITY',
        rows: [
          { title: 'Raj Cresent A-101', owner: 'Priyank Shah', due: '5th of Every Month', renewal: '5th of Every Month' },
          { title: 'New Delight Office No. 401', owner: 'Priyank Shah', due: '5th of Every Month', lastPaid: '4.9.2026', paidAmount: '₹2,240' },
          { title: 'AFLF Electricity (Account No. 150287186)', owner: 'AFLF', due: '5th of Every Month', renewal: 'NA', lastPaid: '7.9.2026', paidAmount: '₹11,950' },
          { title: 'BSCT Electricity (Account No. 100204881)', owner: 'BSCT', due: '5th of Every Month', renewal: 'NA', lastPaid: '7.9.2026', paidAmount: '₹13,460' },
          { title: 'Login Flat No. 205 (Bill No. 900001175100 Tata Power)', owner: 'Priyank Shah', due: 'Paid by Tenant', renewal: 'Paid by Tenant' },
          { title: 'Sanjar Office No. 506', owner: 'Priyank Shah', due: 'Paid by Tenant', renewal: 'Paid by Tenant' },
          { title: 'Sanjar One World (Adani Elec. 153792870)', owner: 'Priyank Shah', due: '15th of Every Month', renewal: 'Paid by Tenant' },
          { title: 'Auris office no. 218 (Invoice) Adani Electricity Bill No. 153900402', owner: 'Shweta Shah', due: 'Paid by Tenant', renewal: 'Paid by Tenant' },
        ],
      },
      {
        heading: 'Piped Gas Bill',
        category: 'OTHER_BILL',
        rows: [
          { title: 'New Delight (Flat No. 401)' },
          { title: 'Raj Cresent (Priyank Sir)' },
        ],
      },
      {
        heading: 'Broadband and Landline',
        category: 'OTHER_BILL',
        rows: [
          { title: 'Hathway Internet - AFLF' },
          { title: 'Local Internet - AFLF' },
          { title: 'Local Internet - Library' },
          { title: 'Jio Internet - Raj Crescent' },
        ],
      },
    ],
  },
  {
    heading: 'Post-Paid Mobile',
    category: 'VI_BILL',
    rows: [
      { title: '9892990029 Primary Vi Max Family 1401 (VI Bill Account No. 118978300)', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9987344338 Secondary', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9967699295 Secondary', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9892268000 Secondary', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930028300 Secondary', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '7039006200 Secondary', owner: 'Suraj Patil', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '7039006300 Secondary', owner: 'Anjana Vyas', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '7039006400 Secondary', owner: 'Anjana Vyas', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '8879035035 Primary Vi Max Family 1201 (VI Bill Account No. 107587212)', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '8879034034 Secondary', owner: 'Priyank Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930028200 Secondary', owner: 'Shweta Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930028400 Secondary', owner: 'Shweta Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930064928 Secondary', owner: 'Suraj Patil', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930084397 Secondary', owner: 'Suraj Patil', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9820646225 Primary Vi Max Family 1201 (VI Bill Account No. 176955124)', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9820644749 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9820645607 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9820641314 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9820648405 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '8879136938 Primary Vi Max Family 1401 (VI Bill Account No. 177089161)', owner: 'Shweta Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '8879136654 Secondary', owner: 'Shweta Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '8879136934 Secondary', owner: 'Shweta Shah', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9920893993 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
      { title: '9930852952 Secondary', owner: 'Naresh Bhanushali', due: '1st of Every Month', renewal: '1st of Every Month' },
    ],
  },
  {
    heading: 'Mobile Recharge',
    category: 'OTHER_BILL',
    rows: [
      { title: 'Anjana Mobile Recahrge' },
      { title: 'Office Mobile Recharge' },
    ],
    subgroups: [
      {
        heading: 'Fastag Recharge',
        category: 'OTHER_BILL',
        rows: [
          { title: 'MG Hector 9999 PUC Vehicle No. MH13EK9999', owner: 'Priyank Shah', due: '7th Feb, 2024', renewal: '27th Aug, 2027' },
        ],
      },
    ],
  },
  {
    heading: 'DTH/ Cable TV Recharge',
    category: 'OTHER_BILL',
    rows: [
      { title: 'Raj Crescent TV Recharge' },
    ],
  },
  {
    heading: 'Website Domain Renewal',
    category: 'WEBSITE_DOMAIN',
    rows: [
      { title: 'Ultimate (Sagar Jain)', owner: 'Priyank Shah', due: '1st Sept of every year', renewal: 'Renew 1st Sept, 2026' },
      { title: 'BSCT (Firefly Solution)', owner: 'BSCT' },
      { title: 'AFLF (Sagar Jain)', owner: 'AFLF', due: '1st Aug of every year', renewal: 'Renew 1st Aug, 2026' },
    ],
  },
  {
    heading: 'Other Bill',
    category: 'OTHER_BILL',
    rows: [
      { title: 'Wondershare Glo', owner: 'Priyank Shah', due: '9th of Every Month', renewal: '9th of Every Month' },
    ],
  },
  {
    heading: 'Finance',
    subgroups: [
      {
        heading: 'Loan EMI',
        category: 'OTHER_BILL',
        rows: [
          { title: 'Login Flat No. 205' },
        ],
      },
      {
        heading: 'Credit Card Bill',
        category: 'OTHER_BILL',
        rows: [
          { title: 'ICICI Bank' },
          { title: 'HDFC Bank' },
        ],
      },
      {
        heading: 'Income Tax',
        category: 'OTHER_BILL',
        rows: financeEntityRows(),
      },
      {
        heading: 'Rent TDS',
        category: 'RENT_TDS',
        rows: rentTdsEntityRows(),
      },
      {
        heading: 'Advance Tax',
        category: 'OTHER_BILL',
        rows: financeEntityRows(),
      },
      {
        heading: 'Accounts and Audit Fees',
        category: 'OTHER_BILL',
        rows: financeEntityRows(),
      },
    ],
  },
  ]

export function buildReminderItems() {
  const items = []
  let seq = 0
  for (const sec of REMINDER_SECTIONS) {
    const pushRow = (r, sub, cat) => {
      items.push({
        category: cat,
        _group: sec.heading,
        _sub: sub || '',
        _seq: seq++,
        title: r.title || '',
        owner: r.owner || '',
        due: r.due || '',
        renewal: r.renewal || '',
        lastPaid: r.lastPaid || '',
        paidAmount: r.paidAmount || '',
        frequency: r.frequency || '',
        notes: r.notes || '',
        due_date_display: r.due || '',
        display_frequency: r.frequency || '',
      })
    }
    if (sec.rows) {
      for (const r of sec.rows) pushRow(r, '', sec.category)
    }
    if (sec.subgroups) {
      for (const sg of sec.subgroups) {
        for (const r of sg.rows) pushRow(r, sg.heading, sg.category || sec.category)
      }
    }
  }
  return items
}