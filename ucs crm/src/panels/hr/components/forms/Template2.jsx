export default function Template2() {
  return (
    <div className="print-page">
      <style>{`
        .t2 *{box-sizing:border-box}
        .t2{width:210mm;height:297mm;margin:40px auto 0;background:#fff;border:8px double #000;padding:12px 14px;font-family:"Times New Roman",serif;overflow:hidden;display:flex;flex-direction:column}
        .t2 .title{text-align:center;color:#1f3f73;font-size:24pt;font-weight:bold;margin:0 0 12px;text-decoration:underline}
        .t2 .sec{color:#7b2020;font-weight:bold;font-size:12pt;margin-top:12px}
        .t2 p{font-size:10pt;line-height:1.55;text-align:justify;margin:3px 0}
      `}</style>
      <div className="t2">
        <div className="title">VOLUNTEER GUIDELINES</div>

        <div className="sec">1. Volunteer Association</div>
        <p>Welcome to the Organization. We are grateful for your decision to volunteer with us. Every volunteer plays a vital role in serving society with honesty, compassion, integrity, and dedication. This handbook outlines the policies, responsibilities, expectations, and code of conduct applicable to all volunteers associated with the Organization. Volunteers are onboarded based on the requirements of the Organization and their individual skills, qualifications, and suitability for specific projects or activities. Every volunteer shall work under the guidance of the respective Team Leader, Head of Department (HOD), Project Coordinator, or any authorized representative of the Organization. The Organization reserves the right to assign, transfer, or modify the volunteer's project, work location, or responsibilities whenever required in the interest of the Organization's operations.</p>

        <div className="sec">2. Orientation Period</div>
        <p>Every newly onboarded volunteer shall undergo an orientation and familiarization period during which the Organization will assess the volunteer's attendance, punctuality, discipline, communication skills, teamwork, work ethic, behaviour, and overall involvement. This orientation period is intended to familiarize volunteers with the Organization's mission, values, policies, and operational procedures. The Organization reserves the right to discontinue the volunteer's association at any time during or after the orientation period if the volunteer's conduct, involvement, or suitability is found to be unsatisfactory or inconsistent with the values and expectations of the Organization.</p>

        <div className="sec">3. Volunteer Timings</div>
        <p>The standard volunteer timings shall ordinarily be from 10:00 AM to 7:00 PM or 9:30 AM to 6:30 PM, inclusive of the prescribed break time, unless otherwise communicated by the Organization. Volunteers are expected to report to their assigned place of work punctually and remain available during their scheduled hours. Attendance shall be recorded through the designated attendance system or any manual process authorized by the Organization. Regular late reporting, early departures, or irregular attendance may be reviewed by the Organization coordinators and may affect the continuity of volunteer association.</p>

        <div className="sec">4. Lunch Break</div>
        <p>Volunteers shall be entitled to a lunch break of 30 minutes, generally scheduled between 1:30 PM and 2:00 PM, unless modified due to operational requirements. Volunteers are expected to resume their duties promptly upon completion of the lunch break and ensure that the break does not interfere with the smooth functioning of the Organization's activities.</p>

        <div className="sec">5. Attendance</div>
        <p>Every volunteer is expected to maintain regular attendance, report to duty on time, and record attendance through the prescribed system every working day. In the event that a volunteer is unable to attend due to unavoidable circumstances, the concerned Team Leader or coordinator must be informed at the earliest possible opportunity. Continuous absence without prior information or valid justification may be treated as abandonment of volunteer responsibilities and may result in the conclusion of the volunteer's association with the Organization.</p>

        <div className="sec">6. Conduct at Organization Premises</div>
        <p>Volunteers are expected to maintain the highest standards of discipline, professionalism, and ethical conduct throughout their association with the Organization. Every volunteer shall treat beneficiaries, visitors, fellow volunteers, and members of the public with dignity, courtesy, and respect. Volunteers are required to follow the reasonable instructions of their coordinators, maintain cleanliness within the Organization premises, and adhere to the prescribed attire guidelines. Activities such as personal shopping, personal grooming during working hours, excessive or unnecessary mobile phone usage, playing games, or engaging in activities unrelated to the Organization's work are strictly discouraged and may invite appropriate action if found to interfere with the Organization's activities.</p>

        <div className="sec">7. Mobile Phone Usage</div>
        <p>The use of personal mobile phones during volunteer hours shall be limited to emergencies or designated break periods. Volunteers are encouraged to remain focused on their assigned duties while on the Organization premises. Family members and personal contacts should communicate with volunteers during working hours only in cases of genuine emergency to avoid unnecessary interruptions to the Organization's activities.</p>
      </div>
    </div>
  );
}
