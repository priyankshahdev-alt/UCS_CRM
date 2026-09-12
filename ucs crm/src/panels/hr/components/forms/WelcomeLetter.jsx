const LETTERHEAD_NAMES = {
  BSCT: 'Being Sevak Charitable Trust',
  AFLF: 'Ashray For Life Foundation',
  MANN: 'Mann Care Foundation',
};

const LETTERHEAD_TAGLINES = {
  BSCT: 'Public Charitable Trust (Reg.) E-31948 No, Income Tax Exempted Under 80G',
  AFLF: 'Public Charitable Trust (Reg.) E-37237 No, Income Tax Exempted Under 80G',
  MANN: 'Company Section 8 Corporate Identity No (CIN) : U88900MH2026NPL471199',
};

const LETTERHEAD_ADDRESSES = {
  BSCT: '506, Sanjar Enclave, Bhadran Nagar, Kandivali (West), Mumbai, Maharashtra 400067.',
  AFLF: 'Unit - 218, 2nd Floor, Auris Galleria, S.V Road, Andheri (West), Mumbai 400058.',
  MANN: '1708 ONE WORLD, SV ROAD NEAR NL HIGH SCHOOL MALAD WEST MUMBAI 400064.',
};

const LETTER_COPY = {
  BSCT: {
    paras: [
      'Congratulations and a very warm welcome to the {name} family!',
      'We are truly happy to have you join us as a Volunteer and become a part of our journey of selfless service towards society and the Nation.',
      'By choosing to volunteer, you have taken a meaningful step towards making a difference in the lives of those who need support, dignity, opportunity and care. Your time, skills, compassion and commitment can create an impact far beyond what you may imagine.',
      'At {name}, we believe that "Sevak Bano – Serving Selfless Service" is not just a slogan; it is a way of life. Every volunteer is an important part of this mission.',
      'We congratulate you on taking this step and look forward to seeing your enthusiasm, dedication and contribution in our various initiatives and community programs.',
      '🤝 Welcome to the Sevak Family! Together, let us serve with compassion, work with dedication and create a better society.',
      'Congratulations once again, and welcome aboard!',
    ],
    sign: ['"Sevak Bano – Serving Selfless Service"', 'Selfless Service Towards Nation'],
  },
  MANN: {
    paras: [
      'Congratulations and a very warm welcome to the {name} family!',
      'We are truly delighted to have you join us as a Volunteer and become a part of our journey towards creating a more equal, empowered and compassionate society for women and girls.',
      'By choosing to volunteer, you have taken a meaningful step towards supporting women and girls with dignity, confidence, education, health, care and opportunities for a better future. Your time, skills, compassion and commitment can become a source of hope and positive change in someone’s life.',
      'At {name}, we believe that every woman and girl deserves the opportunity to live with respect, confidence and independence. Our work focuses on creating meaningful opportunities and extending support through initiatives related to women empowerment, education, health, nutrition, self-reliance and social welfare.',
      'As a volunteer, you are not just contributing your time — you are becoming a part of a movement that believes in empowering lives and strengthening communities.',
      'We congratulate you on taking this meaningful step and look forward to your enthusiasm, dedication and valuable contribution to our various initiatives and community programs.',
      '🤝 Welcome to the {name} Family! Together, let us empower women, inspire girls and create opportunities for a brighter tomorrow.',
      'Congratulations once again, and welcome aboard!',
    ],
    sign: ['"Empowering Women. Inspiring Change."', 'For a Better, Equal & Empowered Society'],
  },
  AFLF: {
    paras: [
      'Congratulations and a very warm welcome to the {name} family!',
      'We are truly happy to welcome you as a Volunteer and have you join our mission of creating meaningful change, empowering lives and building a more compassionate and self-reliant society.',
      'By choosing to volunteer, you have taken a meaningful step towards making a difference in the lives of those who need support, dignity, opportunity and care. Your time, skills, compassion and commitment can create an impact far beyond what you may imagine.',
      'At {name}, we believe that "Be the Ashray – Be the Support" is not just a slogan; it is a way of life. Every volunteer is an important part of this mission.',
      'We congratulate you on taking this step and look forward to seeing your enthusiasm, dedication and contribution in our various initiatives and community programs.',
      '🤝 Welcome to the Ashray Family! Together, let us serve with compassion, work with dedication and create a better society.',
      'Congratulations once again, and welcome aboard!',
    ],
    sign: ['Be the Ashray – Be the Support', 'Transforming Lives Through Compassion & Action', 'Building a Just, Equitable & Humane Society'],
  },
};

export default function WelcomeLetter({ ngoName, ngoCode, personal }) {
  const code = (ngoCode || '').toUpperCase().trim();
  const name = LETTERHEAD_NAMES[code] || ngoName || 'Organization';
  const copy = LETTER_COPY[code] || LETTER_COPY.BSCT;
  const fill = (t) => t.replace(/\{name\}/g, name);
  return (
    <div className="print-page">
      <style>{`
        .wl *{margin:0;padding:0;box-sizing:border-box;font-family:"Times New Roman",Times,serif}
        .wl{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:16px;overflow:hidden;display:flex;flex-direction:column;text-align:justify}
        .wl .org-name{text-align:center;font-size:28px;font-family:Georgia,serif;font-weight:700}
        .wl .red-border{border-top:3px solid #7d1e1e;margin:5px 0 4px}
        .wl .tagline{text-align:center;font-size:10px;margin:0 0 18px}
        .wl .greet{text-align:center;font-size:20px;font-weight:bold;color:#7d1e1e;margin:6px 0 16px}
        .wl p{font-size:15pt;line-height:1.75;margin:0 0 16px}
        .wl .sign{text-align:center;font-size:14pt;line-height:1.6;margin-top:32px}
        .wl .sign b{font-size:15pt}
        .wl .address-foot{margin-top:auto;padding-top:10px;text-align:center;font-size:10pt;color:#333;border-top:1px solid #ccc}
      `}</style>
      <div className="wl">
        <div className="org-name">{name}</div>
        <div className="red-border"></div>
        <div className="tagline">{LETTERHEAD_TAGLINES[code] || ''}</div>

        <div className="greet">CONGRATULATIONS &amp; WARM WELCOME</div>

        <p>Dear Volunteer,</p>

        {copy.paras.map((line, i) => (
          <p key={i}>{fill(line)}</p>
        ))}

        <div className="sign">
          <p>With warm wishes,</p>
          <b>{name}</b><br />
          {copy.sign.map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </div>

        {LETTERHEAD_ADDRESSES[code] && <div className="address-foot">{LETTERHEAD_ADDRESSES[code]}</div>}
      </div>
    </div>
  );
}