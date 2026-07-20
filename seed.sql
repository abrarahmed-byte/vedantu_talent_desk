INSERT OR IGNORE INTO access_users(email, display_name, role) VALUES
  ('pilot.admin@example.com', 'Pilot Admin', 'Admin'),
  ('pilot.recruiter@example.com', 'Pilot Recruiter', 'Recruiter');

INSERT OR IGNORE INTO sources(id, label, kind, connected, status, total_rows, synced_rows, failed_rows, duplicate_rows, last_sync) VALUES
  ('source-teacher-test', 'Vedantu Talent Test Source', 'Google Form response Sheet', 1, 'Connected', 7, 7, 0, 1, '2026-07-20T10:30:00Z'),
  ('source-employment-test', 'GreytHR Employment Test', 'Employment master', 1, 'Connected', 8, 8, 0, 0, '2026-07-20T09:45:00Z');

INSERT OR IGNORE INTO candidates(
  id, canonical_key, name, initials, track, email, phone, city, state, role,
  subject_display, grades_display, boards_display, languages_display, education, college,
  experience_months, work_mode, applied_at, source_sheet, resume_summary, duplicate_count,
  employment_status, employment_times_hired, search_text
) VALUES
  (
    'cand-priya', 'email:priya.sharma@example.com', 'Priya Sharma', 'PS', 'Teacher',
    'priya.sharma@example.com', '+91 90000 00001', 'Bengaluru', 'Karnataka', 'Mathematics Master Teacher',
    'Mathematics · Quantitative Aptitude', 'Grades 9–12 · JEE Foundation', 'CBSE · ICSE', 'English · Hindi',
    'M.Sc. Mathematics · B.Ed.', 'University of Delhi', 72, 'Hybrid', '2026-07-20T09:42:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: mathematics educator with six years of classroom and online teaching experience. Comfortable with CBSE, ICSE and JEE Foundation.',
    1, 'No employment match', 0,
    'priya sharma mathematics maths quantitative aptitude teacher grades class 9 10 11 12 jee foundation cbse icse english hindi bengaluru bangalore karnataka hybrid msc bed delhi six years'
  ),
  (
    'cand-arjun', 'email:arjun.nair@example.com', 'Arjun Nair', 'AN', 'Teacher',
    'arjun.nair@example.com', '+91 90000 00002', 'Kochi', 'Kerala', 'Physics Faculty · JEE',
    'Physics', 'Grades 11–12 · JEE Main · JEE Advanced', 'CBSE · State Board', 'English · Malayalam · Hindi',
    'M.Tech. Applied Physics', 'NIT Calicut', 60, 'Offline', '2026-07-19T12:18:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: physics faculty with five years of JEE coaching experience and concept-led classroom delivery.',
    0, 'Former employee', 1,
    'arjun nair physics faculty teacher jee main advanced grades class 11 12 cbse state board english malayalam hindi kochi kerala offline mtech nit calicut five years former employee'
  ),
  (
    'cand-sana', 'email:sana.khan@example.com', 'Sana Khan', 'SK', 'Teacher',
    'sana.khan@example.com', '+91 90000 00003', 'New Delhi', 'Delhi', 'English & Early Learning Teacher',
    'English · Spoken English · Phonics', 'Grades 1–5 · Middle School', 'CBSE · ICSE · IB', 'English · Hindi · Urdu',
    'M.A. English · B.Ed.', 'Jamia Millia Islamia', 48, 'Online', '2026-07-18T08:06:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: early-learning teacher focused on reading, phonics and spoken English for young learners.',
    0, 'No employment match', 0,
    'sana khan english spoken phonics early learning teacher grades class 1 2 3 4 5 middle school cbse icse ib hindi urdu new delhi online ma bed jamia four years'
  ),
  (
    'cand-tanya', 'email:tanya.saini@example.com', 'Tanya Saini', 'TS', 'Teacher',
    'tanya.saini@example.com', '+91 90000 00004', 'Gurugram', 'Haryana', 'Mathematics & Physics Teacher',
    'Mathematics · Physics', 'Grades 6–10 · Foundation', 'CBSE', 'English · Hindi',
    'B.Sc. Physics · B.Ed.', 'University of Rajasthan', 48, 'Hybrid', '2026-07-17T06:25:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: mathematics and physics teacher for middle and secondary grades with foundation-course experience.',
    0, 'Active employee', 1,
    'tanya saini mathematics maths physics teacher grades class 6 7 8 9 10 foundation cbse english hindi gurugram gurgaon haryana hybrid bsc bed active employee four years'
  ),
  (
    'cand-ravi', 'email:ravi.gupta@example.com', 'Ravi Gupta', 'RG', 'Non-teaching',
    'ravi.gupta@example.com', '+91 90000 00005', 'Pune', 'Maharashtra', 'Academic Operations Manager',
    'Academic Operations · Program Management', 'K–12 Operations', '', 'English · Hindi · Marathi',
    'MBA Operations', 'IIM Indore', 84, 'Hybrid', '2026-07-16T04:41:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: academic operations manager with experience in teacher operations, programme delivery and cross-functional teams.',
    0, 'No employment match', 0,
    'ravi gupta academic operations manager program programme management teacher operations k12 english hindi marathi pune maharashtra hybrid mba iim indore seven years non teaching'
  ),
  (
    'cand-mehul', 'email:mehul.desai@example.com', 'Mehul Desai', 'MD', 'Non-teaching',
    'mehul.desai@example.com', '+91 90000 00006', 'Ahmedabad', 'Gujarat', 'Performance Marketing Lead',
    'Performance Marketing · Growth Analytics', 'Leadership', '', 'English · Hindi · Gujarati',
    'PGDM Marketing', 'MICA Ahmedabad', 96, 'Remote', '2026-07-15T11:06:00Z',
    'Vedantu Talent Test Source', 'Fictional pilot resume: growth and performance-marketing leader with consumer internet and edtech experience.',
    0, 'No employment match', 0,
    'mehul desai performance marketing growth analytics lead leadership english hindi gujarati ahmedabad gujarat remote pgdm mica eight years non teaching edtech'
  );

INSERT OR IGNORE INTO activity_logs(id, candidate_id, actor, action, detail, created_at) VALUES
  ('activity-1', 'cand-priya', 'Pilot Admin', 'viewed', 'Reviewed standardized candidate profile', '2026-07-20T10:42:00Z'),
  ('activity-2', 'cand-priya', 'Pilot Recruiter', 'resume_opened', 'Opened the fictional resume preview', '2026-07-20T10:47:00Z'),
  ('activity-3', 'cand-arjun', 'Pilot Recruiter', 'viewed', 'Reviewed physics and JEE teaching fit', '2026-07-20T09:24:00Z'),
  ('activity-4', 'cand-tanya', 'Pilot Admin', 'viewed', 'Reviewed active employee match', '2026-07-19T13:18:00Z'),
  ('activity-5', NULL, 'System', 'synced', 'Imported 7 fictional rows; merged 1 duplicate into 6 profiles', '2026-07-20T10:30:00Z');

UPDATE candidates SET interviewer_count = 2, view_count = 1, resume_open_count = 1 WHERE id = 'cand-priya';
UPDATE candidates SET interviewer_count = 1, view_count = 1 WHERE id = 'cand-arjun';
UPDATE candidates SET interviewer_count = 1, view_count = 1 WHERE id = 'cand-tanya';

INSERT OR IGNORE INTO calls(id, candidate_id, recruiter, role, outcome, note, created_at) VALUES
  ('call-1', 'cand-priya', 'Pilot Recruiter', 'Mathematics Master Teacher', 'Interested', 'Fictional pilot call entry.', '2026-07-20T10:55:00Z');

UPDATE candidates SET call_count = 1 WHERE id = 'cand-priya';

INSERT OR IGNORE INTO sync_jobs(id, source_id, status, stage, processed_rows, total_rows, eta_seconds, message, updated_at) VALUES
  ('job-pilot-1', 'source-teacher-test', 'Complete', 'Repository reconciled', 7, 7, 0, '7 rows synced · 1 duplicate merged · 6 searchable profiles', '2026-07-20T10:30:00Z');
