import { supabase } from '../lib/supabase.js';

const TERMS = ['1st Term', '2nd Term', '3rd Term'];
const GRADE_PROFILES = {
  core: { label: 'SHS Core Subjects', ww: 20, pt: 50, ex: 30 },
  academic: { label: 'SHS Academic Electives (All Other Electives)', ww: 20, pt: 50, ex: 30 },
  arts: { label: 'SHS Arts, Sports, Health & Wellness Electives', ww: 20, pt: 60, ex: 20 },
  research: { label: 'SHS Research / Design & Innovation', ww: 40, pt: 60, ex: 0 },
  field: { label: 'SHS Field Experience / Arts Apprenticeship / Creative Production', ww: 15, pt: 70, ex: 15 },
  techpro: { label: 'SHS TechPro Electives', ww: 15, pt: 65, ex: 20 },
  immersion: { label: 'SHS Work Immersion', ww: 20, pt: 80, ex: 0 }
};

const assessmentCategory = (type) =>
  type === 'performance_task' ? 'pt' : type === 'exam' ? 'ex' : 'ww';

const ADJUSTED_TRANSMUTATION_BANDS = [
  [99.50, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96],
  [93.60, 95], [92.42, 94], [91.24, 93], [90.06, 92], [88.88, 91],
  [87.70, 90], [86.52, 89], [85.34, 88], [84.16, 87], [82.98, 86],
  [81.80, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81],
  [75.90, 80], [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76],
  [70.00, 75], [65.34, 74], [60.67, 73], [56.01, 72], [51.34, 71],
  [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
  [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61], [0, 60]
];

function transmuteInitialGrade(initialGrade) {
  const roundedInitial = Math.round((initialGrade + Number.EPSILON) * 100) / 100;
  return ADJUSTED_TRANSMUTATION_BANDS.find(([minimum]) => roundedInitial >= minimum)?.[1] ?? 60;
}

function gradingPolicyForYear(yearName) {
  const startYear = Number(String(yearName || '').match(/20\d{2}/)?.[0]);
  return startYear >= 2027 ? 'zero-based' : 'adjusted-transmutation';
}

function termGradeForYear(initialGrade, yearName) {
  return gradingPolicyForYear(yearName) === 'zero-based'
    ? Math.round(initialGrade)
    : transmuteInitialGrade(initialGrade);
}

function gradingPolicyDescription(yearName) {
  return gradingPolicyForYear(yearName) === 'zero-based'
    ? 'computed initial grade rounded to a whole number, with no transmutation'
    : 'the adjusted SY 2026-2027 transmutation table';
}

async function getSchoolYearName(schoolYearId) {
  if (!schoolYearId) return '';
  const { data, error } = await supabase.from('school_years')
    .select('year_name').eq('id', schoolYearId).maybeSingle();
  if (error) throw error;
  return data?.year_name || '';
}

const ASSESSMENT_TYPES = [
  { value: 'quiz', label: 'Quiz' },
  { value: 'activity', label: 'Activity' },
  { value: 'performance_task', label: 'Performance Task' },
  { value: 'exam', label: 'Exam' }
];

const escapeHTML = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

const messageBox = (message, kind = 'info') =>
  `<p class="notice ${escapeHTML(kind)}">${escapeHTML(message)}</p>`;

const formatName = (student) =>
  `${student.first_name || ''} ${student.last_name || ''}`.trim() ||
  student.lrn ||
  'Unnamed student';

const errorMessage = (error) =>
  error?.message || 'Something went wrong. Please try again.';

async function getCurrentUser(user) {
  if (user?.id) return user;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Your session has expired. Please log in again.');

  return data.user;
}

async function getTeacherAssignments(userId) {
  const { data, error } = await supabase
    .from('teaching_assignments')
    .select('id, teacher_id, subject_id, section_id, school_year_id')
    .eq('teacher_id', userId);

  if (error) throw error;

  const assignments = data || [];
  const subjectIds = [...new Set(assignments.map(a => a.subject_id).filter(Boolean))];
  const sectionIds = [...new Set(assignments.map(a => a.section_id).filter(Boolean))];

  let subjects = [];
  let sections = [];

  if (subjectIds.length) {
    const result = await supabase
      .from('subjects')
      .select('id, subject_name')
      .in('id', subjectIds);

    if (result.error) throw result.error;
    subjects = result.data || [];
  }

  if (sectionIds.length) {
    const result = await supabase
      .from('sections')
      .select('id, section_name, adviser_teacher_id')
      .in('id', sectionIds);

    if (result.error) throw result.error;
    sections = result.data || [];
  }

  const subjectMap = new Map(
    subjects.map(item => [String(item.id), item.subject_name])
  );
  const sectionMap = new Map(
    sections.map(item => [String(item.id), item])
  );

  return assignments.map(assignment => ({
    ...assignment,
    subject_name:
      subjectMap.get(String(assignment.subject_id)) ||
      `Subject ${assignment.subject_id}`,
    section_name:
      sectionMap.get(String(assignment.section_id))?.section_name ||
      `Section ${assignment.section_id}`,
    adviser_teacher_id: sectionMap.get(String(assignment.section_id))?.adviser_teacher_id || null
  }));
}

async function getStudentsForAssignment(assignmentId, sectionId, fields = 'id, lrn, first_name, last_name, section_id, is_active') {
  const [{ data: sectionStudents, error: sectionStudentsError }, { data: enrollments, error: enrollmentsError }] = await Promise.all([
    supabase.from('students').select(fields).eq('section_id', sectionId),
    supabase.from('teaching_assignment_students').select('student_lrn').eq('teaching_assignment_id', assignmentId)
  ]);
  if (sectionStudentsError) throw sectionStudentsError;
  if (enrollmentsError) throw enrollmentsError;

  const studentLrns = [...new Set([
    ...(sectionStudents || []).map(student => student.lrn),
    ...(enrollments || []).map(enrollment => enrollment.student_lrn)
  ])];
  if (!studentLrns.length) return [];

  const { data: students, error } = await supabase.from('students').select(fields).in('lrn', studentLrns);
  if (error) throw error;
  return (students || []).sort((a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`));
}

function assignmentLabel(assignment) {
  return `${assignment.subject_name} — ${assignment.section_name}`;
}

function assignmentOptions(assignments, selectedId = '') {
  return assignments.map((assignment) => `
    <option value="${escapeHTML(assignment.id)}"
      ${String(assignment.id) === String(selectedId) ? 'selected' : ''}>
      ${escapeHTML(assignmentLabel(assignment))}
    </option>
  `).join('');
}

function termOptions(selected = '1st Term') {
  return TERMS.map((term) => `
    <option value="${escapeHTML(term)}" ${term === selected ? 'selected' : ''}>
      ${escapeHTML(term)}
    </option>
  `).join('');
}

function typeOptions(selected = 'quiz') {
  return ASSESSMENT_TYPES.map((type) => `
    <option value="${type.value}" ${type.value === selected ? 'selected' : ''}>
      ${type.label}
    </option>
  `).join('');
}

const SIDEBAR_GROUPS = [
  { label: 'Workspace', items: [['overview', 'Overview'], ['advisory', 'Advisory Class'], ['students', 'Students']] },
  { label: 'Teaching', items: [['subjects', 'My Subjects'], ['assessments', 'Assessments'], ['gradebook', 'Gradebook']] },
  { label: 'Grade Records', items: [['report-cards', 'Report Cards'], ['distribution', 'Distribute Grades'], ['history', 'Distribution History']] }
];

const SIDEBAR_ICON_PATHS = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  advisory: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 10h7"/>',
  students: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  subjects: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 4.5v14A2.5 2.5 0 0 1 6.5 16H20M8 6h8M8 9h8"/>',
  assessments: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10l1.5 1.5L12 9M13 11h3M8 16l1.5 1.5L12 15M13 17h3"/>',
  gradebook: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11M15 9v11"/>',
  'report-cards': '<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v6h5M9 13h7M9 17h7"/>',
  distribution: '<path d="m4 12 16-8-5 16-3-7z"/><path d="m12 13 8-9M4 12l8 1"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'
};

function sidebarItem(view, label, active) {
  return `<button type="button" data-view="${escapeHTML(view)}" class="${active === view ? 'active' : ''}" ${active === view ? 'aria-current="page"' : ''}><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIDEBAR_ICON_PATHS[view]}</svg><span>${escapeHTML(label)}</span></button>`;
}

function layout(user, content, active = 'overview') {
  const name = user.full_name || user.email || 'Teacher';

  return `
    <div class="dashboard-layout">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-mark" aria-hidden="true"><img src="/LOGO.jpg" alt="" /></div>
          <div class="sidebar-brand-copy"><span>TEACHER WORKSPACE</span><h2>Grade Manager</h2></div>
        </div>

        <nav class="sidebar-nav" aria-label="Main navigation">
          ${SIDEBAR_GROUPS.map(group => `<div class="sidebar-nav-group"><p class="sidebar-nav-label">${escapeHTML(group.label)}</p>${group.items.map(([view, label]) => sidebarItem(view, label, active)).join('')}</div>`).join('')}
        </nav>

        <button type="button" data-action="logout" class="logout-button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg><span>Log Out</span></button>
      </aside>

      <main class="dashboard-main">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow">BALINGASA HIGH SCHOOL</p>
            <h1>Grade Management System</h1>
          </div>
          <div class="teacher-profile">
            <span>${escapeHTML(name)}</span>
          </div>
        </header>

        <section class="dashboard-content">${content}</section>
      </main>
    </div>
  `;
}

async function showView(root, view, user) {
  const currentUser = await getCurrentUser(user);
  let content = '';
  let active = view;

  try {
    switch (view) {
      case 'advisory':
        content = await renderAdvisoryClass(currentUser);
        break;
      case 'students':
        content = await renderStudents(currentUser);
        break;
      case 'report-cards':
        content = await renderReportCards(currentUser);
        break;
      case 'subjects':
        content = await renderSubjects(currentUser);
        break;
      case 'assessments':
        content = await renderAssessments(currentUser);
        break;
      case 'gradebook':
        content = await renderGradebook(currentUser);
        break;
      case 'distribution':
        content = await renderDistribution(currentUser);
        break;
      case 'history':
        content = await renderHistory(currentUser);
        break;
      default:
        active = 'overview';
        content = await renderOverview(currentUser);
    }
  } catch (error) {
    console.error(error);
    content = `
      <h2>${escapeHTML(viewTitle(view))}</h2>
      ${messageBox(errorMessage(error), 'error')}
    `;
  }

  root.innerHTML = layout(currentUser, content, active);
}

function viewTitle(view) {
  const titles = {
    overview: 'Overview',
    advisory: 'Advisory Class',
    students: 'Students',
    'report-cards': 'Report Cards',
    subjects: 'My Subjects',
    assessments: 'Assessments',
    gradebook: 'Gradebook',
    distribution: 'Distribute Grades',
    history: 'Distribution History'
  };

  return titles[view] || 'Dashboard';
}

async function renderOverview(user) {
  const assignments = await getTeacherAssignments(user.id);
  const rosters = await Promise.all(assignments.map(assignment =>
    getStudentsForAssignment(assignment.id, assignment.section_id)
  ));
  const students = [...new Map(rosters.flat().map(student => [String(student.id), student])).values()];

  const activeStudents = students.filter((student) => student.is_active !== false);

  const { count: assessmentCount, error: assessmentError } = await supabase
    .from('assessments')
    .select('id', { count: 'exact', head: true })
    .in(
      'teaching_assignment_id',
      assignments.length ? assignments.map((a) => a.id) : [-1]
    );

  if (assessmentError) throw assessmentError;

  const { count: gradeCount, error: gradeError } = await supabase
    .from('grades')
    .select('id', { count: 'exact', head: true })
    .in(
      'teaching_assignment_id',
      assignments.length ? assignments.map((a) => a.id) : [-1]
    );

  if (gradeError) throw gradeError;

  return `
    <div class="page-heading">
      <div>
        <h2>Overview</h2>
        <p>Welcome to your teacher dashboard.</p>
      </div>
    </div>

    <div class="stats-grid">
      <article class="stat-card">
        <p>Teaching Assignments</p>
        <h3>${assignments.length}</h3>
      </article>
      <article class="stat-card">
        <p>Active Students</p>
        <h3>${activeStudents.length}</h3>
      </article>
      <article class="stat-card">
        <p>Assessments</p>
        <h3>${assessmentCount || 0}</h3>
      </article>
      <article class="stat-card">
        <p>Saved Grades</p>
        <h3>${gradeCount || 0}</h3>
      </article>
    </div>

    <section class="panel">
      <h3>My Teaching Assignments</h3>
      ${
        assignments.length
          ? `<div class="table-wrapper"><table>
              <thead><tr><th>Subject</th><th>Section</th><th>School Year ID</th></tr></thead>
              <tbody>${assignments.map((a) => `
                <tr>
                  <td>${escapeHTML(a.subject_name)}</td>
                  <td>${escapeHTML(a.section_name)}</td>
                  <td>${escapeHTML(a.school_year_id ?? '—')}</td>
                </tr>
              `).join('')}</tbody>
            </table></div>`
          : messageBox('No teaching assignments were found for your account.')
      }
    </section>
  `;
}

async function renderStudents(user) {
  const assignments = await getTeacherAssignments(user.id);
  const taughtSections = new Map(assignments.map(assignment => [String(assignment.section_id), assignment.section_name]));
  const { data: advisorySections, error: advisoryError } = await supabase.from('sections')
    .select('id, section_name').eq('adviser_teacher_id', user.id);
  if (advisoryError) throw advisoryError;
  const advisorySectionMap = new Map((advisorySections || [])
    .filter(section => !taughtSections.has(String(section.id)))
    .map(section => [String(section.id), section.section_name]));
  const sectionMap = new Map([...taughtSections, ...advisorySectionMap]);
  const advisoryOptions = (advisorySections || []).map(section =>
    `<option value="${escapeHTML(section.id)}">${escapeHTML(section.section_name)}</option>`
  ).join('');
  if (!sectionMap.size && !assignments.length) {
    return `<h2>Students</h2>${messageBox('You do not have any subject or advisory sections assigned yet.')}`;
  }

  const rosterResults = await Promise.all(assignments.map(assignment =>
    getStudentsForAssignment(assignment.id, assignment.section_id, 'id, lrn, first_name, last_name, section_id, is_active, created_at')
  ));
  const advisoryIds = (advisorySections || []).map(section => section.id);
  let advisoryStudents = [];
  if (advisoryIds.length) {
    const { data, error } = await supabase.from('students')
      .select('id, lrn, first_name, last_name, section_id, is_active, created_at')
      .in('section_id', advisoryIds);
    if (error) throw error;
    advisoryStudents = data || [];
  }
  const studentMap = new Map([...advisoryStudents, ...rosterResults.flat()].map(student => [String(student.id), student]));
  const students = [...studentMap.values()].sort((a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`));

  const enrollmentRows = assignments.length
    ? await supabase.from('teaching_assignment_students').select('student_lrn, teaching_assignment_id').in('teaching_assignment_id', assignments.map(assignment => assignment.id))
    : { data: [], error: null };
  if (enrollmentRows.error) throw enrollmentRows.error;
  const enrollmentAssignments = new Map();
  for (const enrollment of enrollmentRows.data || []) {
    const key = String(enrollment.student_lrn);
    enrollmentAssignments.set(key, [...(enrollmentAssignments.get(key) || []), enrollment.teaching_assignment_id]);
  }

  return `
    <div class="page-heading">
      <div><h2>Students</h2><p>Your advisory class stays the student's home roster. Enroll existing learners into each subject you teach.</p></div>
    </div>
    ${advisorySections?.length ? `<section class="panel student-form-panel">
      <h3>Add Student to My Advisory Class</h3>
      <form data-form="add-student" class="form-grid student-form">
        <label>LRN<input name="lrn" type="text" maxlength="30" required placeholder="Learner reference number"></label>
        <label>First Name<input name="first_name" type="text" maxlength="100" required></label>
        <label>Last Name<input name="last_name" type="text" maxlength="100" required></label>
        <label>Advisory Class<select name="section_id" required><option value="">Select your advisory class</option>${(advisorySections || []).map(section => `<option value="${escapeHTML(section.id)}">${escapeHTML(section.section_name)}</option>`).join('')}</select></label>
        <button class="button primary student-submit" type="submit">Add Student</button>
        <div data-form-message></div>
      </form>
    </section>` : ''}
    ${assignments.length ? `<section class="panel student-form-panel">
      <h3>Enroll an Existing Student in My Subject</h3>
      <form data-form="enroll-existing-student" class="form-grid student-form">
        <label>Student LRN<input name="lrn" type="text" maxlength="30" required placeholder="Enter the student's existing LRN"></label>
        <label>Subject and Section<select name="teaching_assignment_id" required><option value="">Select a subject and section</option>${assignmentOptions(assignments)}</select></label>
        <button class="button primary student-submit" type="submit">Enroll Student</button>
        <div data-form-message></div>
      </form>
    </section>` : ''}
    <section class="panel">
      ${
        students?.length
          ? `<div class="table-wrapper"><table>
              <thead><tr><th>LRN</th><th>Student Name</th><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${students.map((student) => {
                const isOwnAdvisory = String(student.section_id) && (advisorySections || []).some(section => String(section.id) === String(student.section_id));
                const enrolledAssignments = (enrollmentAssignments.get(String(student.lrn)) || [])
                  .filter(assignmentId => String(assignments.find(a => String(a.id) === String(assignmentId))?.section_id) !== String(student.section_id));
                const advisoryButtons = isOwnAdvisory
                  ? `<button type="button" class="button student-edit" data-action="edit-student"
                      data-lrn="${escapeHTML(student.lrn)}" data-first-name="${escapeHTML(student.first_name || '')}"
                      data-last-name="${escapeHTML(student.last_name || '')}" data-section-id="${escapeHTML(student.section_id)}"
                      data-active="${student.is_active !== false}" data-section-options="${escapeHTML(advisoryOptions)}">Edit</button>
                    <button type="button" class="button student-delete" data-action="delete-student" data-lrn="${escapeHTML(student.lrn)}">Delete</button>` : '';
                const removeButtons = enrolledAssignments.map(assignmentId => `<button type="button" class="button" data-action="remove-subject-enrollment"
                      data-assignment-id="${escapeHTML(assignmentId)}" data-student-lrn="${escapeHTML(student.lrn)}">Remove from ${escapeHTML(assignments.find(a => String(a.id) === String(assignmentId))?.subject_name || 'subject')}</button>`).join('');
                const actionButtons = [advisoryButtons, removeButtons].filter(Boolean).join('');
                return `
                <tr data-student-row="${escapeHTML(student.lrn)}">
                  <td>${escapeHTML(student.lrn)}</td>
                  <td>${escapeHTML(formatName(student))}</td>
                  <td>${escapeHTML(sectionMap.get(String(student.section_id)) || 'Other advisory class')}</td>
                  <td class="${student.is_active === false ? 'dropped-status' : 'active-status'}">${student.is_active === false ? 'Dropped' : 'Active'}</td>
                  <td class="student-actions">
                    ${actionButtons || '—'}
                  </td>
                </tr>
              `;}).join('')}</tbody>
            </table></div>`
          : messageBox('No students were found in your assigned sections.')
      }
    </section>
  `;
}

async function renderAdvisoryClass(user) {
  const { data: sections, error: sectionsError } = await supabase.from('sections')
    .select('id, section_name, grade_level, school_year_id')
    .eq('adviser_teacher_id', user.id)
    .order('section_name', { ascending: true });
  if (sectionsError) throw sectionsError;
  if (!sections?.length) {
    return `<div class="page-heading"><div><h2>Advisory Class</h2><p>Your advisory roster and grades shared by subject teachers.</p></div></div>${messageBox('No advisory section is assigned to your account yet.')}`;
  }

  const sectionIds = sections.map(section => section.id);
  const [{ data: students, error: studentsError }, { data: assignments, error: assignmentsError }, { data: distributions, error: distributionsError }] = await Promise.all([
    supabase.from('students').select('id, lrn, first_name, last_name, section_id, is_active')
      .in('section_id', sectionIds).order('last_name', { ascending: true }),
    supabase.from('teaching_assignments').select('id, subject_id, section_id, school_year_id')
      .eq('teacher_id', user.id),
    supabase.from('grade_distributions').select('id, section_id')
      .eq('recipient_teacher_id', user.id).in('section_id', sectionIds)
  ]);
  if (studentsError) throw studentsError;
  if (assignmentsError) throw assignmentsError;
  if (distributionsError) throw distributionsError;

  const sectionYearIds = new Set(sections.map(section => String(section.school_year_id)));
  const assignmentRows = (assignments || []).filter(assignment => sectionYearIds.has(String(assignment.school_year_id)));
  const enrollmentResult = assignmentRows.length && students?.length
    ? await supabase.from('teaching_assignment_students')
      .select('teaching_assignment_id, student_lrn')
      .in('teaching_assignment_id', assignmentRows.map(assignment => assignment.id))
      .in('student_lrn', students.map(student => student.lrn))
    : { data: [], error: null };
  if (enrollmentResult.error) throw enrollmentResult.error;
  const enrolledPairs = new Set((enrollmentResult.data || []).map(entry => `${entry.teaching_assignment_id}:${entry.student_lrn}`));
  const distributionIds = (distributions || []).map(distribution => distribution.id);
  let receivedGradeIds = [];
  if (distributionIds.length) {
    const { data: items, error: itemsError } = await supabase.from('grade_distribution_items')
      .select('grade_id').in('distribution_id', distributionIds);
    if (itemsError) throw itemsError;
    receivedGradeIds = (items || []).map(item => item.grade_id).filter(Boolean);
  }

  const assignmentIds = assignmentRows.map(assignment => assignment.id);
  let ownGrades = [];
  if (assignmentIds.length) {
    const { data, error } = await supabase.from('grades')
      .select('id, student_id, teaching_assignment_id, grading_period, grade_value, status')
      .in('teaching_assignment_id', assignmentIds);
    if (error) throw error;
    ownGrades = data || [];
  }

  let grades = ownGrades;
  if (receivedGradeIds.length) {
    const { data, error } = await supabase.from('grades')
      .select('id, student_id, teaching_assignment_id, grading_period, grade_value, status')
      .in('id', [...new Set(receivedGradeIds)]);
    if (error) throw error;
    grades = [...ownGrades, ...(data || [])];
  }
  const allGrades = [...new Map(grades.map(grade => [String(grade.id), grade])).values()];
  const allAssignmentIds = [...new Set(allGrades.map(grade => grade.teaching_assignment_id).filter(Boolean))];
  let allAssignments = assignmentRows;
  const missingAssignmentIds = allAssignmentIds.filter(id => !assignmentIds.some(ownId => String(ownId) === String(id)));
  if (missingAssignmentIds.length) {
    const { data, error } = await supabase.from('teaching_assignments')
      .select('id, subject_id, section_id, school_year_id').in('id', missingAssignmentIds);
    if (error) throw error;
    allAssignments = [...assignmentRows, ...(data || [])];
  }

  const subjectIds = [...new Set(allAssignments.map(assignment => assignment.subject_id).filter(Boolean))];
  const yearIds = [...new Set(allAssignments.map(assignment => assignment.school_year_id).filter(Boolean))];
  const [subjectsResult, yearsResult] = await Promise.all([
    subjectIds.length ? supabase.from('subjects').select('id, subject_name').in('id', subjectIds) : Promise.resolve({ data: [], error: null }),
    yearIds.length ? supabase.from('school_years').select('id, year_name').in('id', yearIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (subjectsResult.error) throw subjectsResult.error;
  if (yearsResult.error) throw yearsResult.error;

  const studentMap = new Map((students || []).map(student => [String(student.lrn), student]));
  const assignmentMap = new Map(allAssignments.map(assignment => [String(assignment.id), assignment]));
  const subjectMap = new Map((subjectsResult.data || []).map(subject => [String(subject.id), subject.subject_name]));
  const yearMap = new Map((yearsResult.data || []).map(year => [String(year.id), year.year_name]));
  const ownGradeIds = new Set(ownGrades.map(grade => String(grade.id)));
  const receivedGradeIdSet = new Set(receivedGradeIds.map(String));
  const gradesByStudent = new Map();
  for (const grade of allGrades) {
    const student = studentMap.get(String(grade.student_id));
    const assignment = assignmentMap.get(String(grade.teaching_assignment_id));
    const receivedForAdvisory = receivedGradeIdSet.has(String(grade.id));
    if (!student || !assignment || (!receivedForAdvisory &&
      String(assignment.section_id) !== String(student.section_id)
      && !enrolledPairs.has(`${assignment.id}:${student.lrn}`)
    )) continue;
    const studentGrades = gradesByStudent.get(String(student.lrn)) || [];
    studentGrades.push({
      ...grade,
      subject: subjectMap.get(String(assignment.subject_id)) || `Subject ${assignment.subject_id}`,
      year: yearMap.get(String(assignment.school_year_id)) || 'School year',
      source: ownGradeIds.has(String(grade.id)) ? 'Your subject' : 'Shared by subject teacher'
    });
    gradesByStudent.set(String(student.lrn), studentGrades);
  }

  const sectionMap = new Map(sections.map(section => [String(section.id), section]));
  return `
    <div class="page-heading"><div><h2>Advisory Class</h2><p>Subjects and terms shared by subject teachers appear here automatically.</p></div></div>
    ${sections.map(section => {
      const sectionStudents = (students || []).filter(student => String(student.section_id) === String(section.id));
      return `<section class="panel">
        <h3>${escapeHTML(section.grade_level || '')}${section.grade_level ? ' · ' : ''}${escapeHTML(section.section_name)}</h3>
        ${sectionStudents.length ? `<div class="table-wrapper"><table class="advisory-grade-table">
          <thead><tr><th>Learner</th><th>LRN</th><th>Status</th><th>Subjects</th></tr></thead>
          <tbody>${sectionStudents.map(student => {
            const records = (gradesByStudent.get(String(student.lrn)) || []).sort((a, b) =>
              a.subject.localeCompare(b.subject) || TERMS.indexOf(a.grading_period) - TERMS.indexOf(b.grading_period)
            );
            const gradeList = records.length ? `<ul class="advisory-grade-list">${records.map(grade =>
              `<li><strong>${escapeHTML(grade.subject)}</strong> · ${escapeHTML(grade.grading_period)} <small>${escapeHTML(grade.year)} · ${escapeHTML(grade.source)}</small></li>`
            ).join('')}</ul>` : '<span class="muted">No grades have been received or recorded yet.</span>';
            return `<tr><td>${escapeHTML(formatName(student))}</td><td>${escapeHTML(student.lrn)}</td><td class="${student.is_active === false ? 'dropped-status' : 'active-status'}">${student.is_active === false ? 'Dropped' : 'Active'}</td><td>${gradeList}</td></tr>`;
          }).join('')}</tbody>
        </table></div>` : messageBox('No students are currently assigned to this advisory section.')}
      </section>`;
    }).join('')}
  `;
}

async function renderReportCards(user) {
  const assignments = await getTeacherAssignments(user.id);
  const sectionMap = new Map(assignments.map(a => [String(a.section_id), a.section_name]));
  const { data: advisorySections, error: advisoryError } = await supabase
    .from('sections').select('id, section_name').eq('adviser_teacher_id', user.id);
  if (advisoryError) throw advisoryError;
  for (const section of advisorySections || []) sectionMap.set(String(section.id), section.section_name);
  const sectionIds = [...sectionMap.keys()];
  if (!sectionIds.length) {
    return `<h2>Report Cards</h2>${messageBox('You need an assigned or advisory section before printing a student report card.')}`;
  }

  const rosterResults = await Promise.all(assignments.map(assignment =>
    getStudentsForAssignment(assignment.id, assignment.section_id)
  ));
  const { data: advisoryStudents, error } = await supabase.from('students')
    .select('id, lrn, first_name, last_name, section_id, is_active')
    .in('section_id', sectionIds.map(Number));
  if (error) throw error;
  const students = [...new Map([...(advisoryStudents || []), ...rosterResults.flat()]
    .map(student => [String(student.id), student])).values()]
    .sort((a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`));
  return `
    <div class="page-heading"><div><h2>Printable Student Report Cards</h2><p>Select a learner to view all term grades available to you, then print the card.</p></div></div>
    <section class="panel report-card-controls">
      <form data-form="load-report-card" class="form-grid">
        <label>Student
          <select name="student_id" required>
            <option value="">Select a student</option>
            ${students.map(student => `<option value="${escapeHTML(student.lrn)}">${escapeHTML(formatName(student))} — ${escapeHTML(sectionMap.get(String(student.section_id)) || 'Other advisory class')}${student.is_active === false ? ' (Dropped)' : ''}</option>`).join('')}
          </select>
        </label>
        <button class="button primary" type="submit">Load Report Card</button>
      </form>
      <div data-report-card></div>
    </section>
  `;
}

async function loadStudentReportCard(root, studentId, user) {
  const target = root.querySelector('[data-report-card]');
  if (!target) return;
  target.innerHTML = messageBox('Loading student grades...');
  try {
    const { data: student, error: studentError } = await supabase.from('students')
      .select('id, lrn, first_name, last_name, section_id').eq('lrn', studentId).single();
    if (studentError) throw studentError;

    const allAssignments = await getTeacherAssignments(user.id);
    const { data: rosterEntries, error: rosterError } = await supabase.from('teaching_assignment_students')
      .select('teaching_assignment_id').eq('student_lrn', student.lrn);
    if (rosterError) throw rosterError;
    const enrolledAssignmentIds = new Set((rosterEntries || []).map(entry => String(entry.teaching_assignment_id)));
    const ownAssignments = allAssignments.filter(a =>
      String(a.section_id) === String(student.section_id) || enrolledAssignmentIds.has(String(a.id))
    );
    let ownGrades = [];
    if (ownAssignments.length) {
      const result = await supabase.from('grades')
        .select('id, student_id, teaching_assignment_id, grading_period, grade_value, status')
        .eq('student_id', student.lrn)
        .in('teaching_assignment_id', ownAssignments.map(a => a.id));
      if (result.error) throw result.error;
      ownGrades = result.data || [];
    }

    const { data: distributions, error: distributionError } = await supabase.from('grade_distributions')
      .select('id').eq('recipient_teacher_id', user.id).eq('section_id', student.section_id);
    if (distributionError) throw distributionError;
    let receivedGrades = [];
    const distributionIds = (distributions || []).map(d => d.id);
    if (distributionIds.length) {
      const { data: items, error: itemsError } = await supabase.from('grade_distribution_items')
        .select('grade_id').in('distribution_id', distributionIds);
      if (itemsError) throw itemsError;
      const gradeIds = [...new Set((items || []).map(item => item.grade_id).filter(Boolean))];
      if (gradeIds.length) {
        const { data, error: receivedError } = await supabase.from('grades')
          .select('id, student_id, teaching_assignment_id, grading_period, grade_value, status')
          .eq('student_id', student.lrn).in('id', gradeIds);
        if (receivedError) throw receivedError;
        receivedGrades = data || [];
      }
    }

    const gradeMap = new Map([...ownGrades, ...receivedGrades].map(grade => [String(grade.id), grade]));
    const grades = [...gradeMap.values()];
    const assignmentIds = [...new Set(grades.map(g => g.teaching_assignment_id).filter(Boolean))];
    let assignments = [];
    if (assignmentIds.length) {
      const { data, error: assignmentError } = await supabase.from('teaching_assignments')
        .select('id, teacher_id, subject_id, section_id, school_year_id').in('id', assignmentIds);
      if (assignmentError) throw assignmentError;
      assignments = data || [];
    }
    const teacherIds = [...new Set(assignments.map(a => a.teacher_id).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length) {
      const { data: teachers, error: teachersError } = await supabase
        .from('profiles').select('id, full_name').in('id', teacherIds);
      if (teachersError) throw teachersError;
      teacherMap = new Map((teachers || []).map(teacher => [String(teacher.id), teacher.full_name || 'Teacher']));
    }
    const subjectIds = [...new Set(assignments.map(a => a.subject_id).filter(Boolean))];
    const yearIds = [...new Set(assignments.map(a => a.school_year_id).filter(Boolean))];
    const sectionIds = [...new Set(assignments.map(a => a.section_id).filter(Boolean))];
    const [subjectsResult, yearsResult, sectionsResult] = await Promise.all([
      subjectIds.length ? supabase.from('subjects').select('id, subject_name, subject_code').in('id', subjectIds) : Promise.resolve({ data: [], error: null }),
      yearIds.length ? supabase.from('school_years').select('id, year_name').in('id', yearIds) : Promise.resolve({ data: [], error: null }),
      sectionIds.length ? supabase.from('sections').select('id, section_name, grade_level').in('id', sectionIds) : Promise.resolve({ data: [], error: null })
    ]);
    if (subjectsResult.error) throw subjectsResult.error;
    if (yearsResult.error) throw yearsResult.error;
    if (sectionsResult.error) throw sectionsResult.error;
    const assignmentMap = new Map(assignments.map(a => [String(a.id), a]));
    const subjectMap = new Map((subjectsResult.data || []).map(s => [String(s.id), s]));
    const yearMap = new Map((yearsResult.data || []).map(y => [String(y.id), y.year_name]));
    const sectionsMap = new Map((sectionsResult.data || []).map(s => [String(s.id), s]));
    const groups = new Map();
    for (const grade of grades) {
      const assignment = assignmentMap.get(String(grade.teaching_assignment_id));
      if (!assignment) continue;
      const subject = subjectMap.get(String(assignment.subject_id));
      const section = sectionsMap.get(String(assignment.section_id));
      const groupKey = `${assignment.school_year_id}:${assignment.section_id}:${assignment.subject_id}`;
      if (!groups.has(groupKey)) groups.set(groupKey, {
        subject: subject?.subject_name || `Subject ${assignment.subject_id}`,
        code: subject?.subject_code || '',
        teacher: teacherMap.get(String(assignment.teacher_id)) || 'Teacher',
        year: yearMap.get(String(assignment.school_year_id)) || 'School year',
        section: section?.section_name || `Section ${assignment.section_id}`,
        grade_level: section?.grade_level || '',
        terms: {}
      });
      groups.get(groupKey).terms[grade.grading_period] = Number(grade.grade_value);
    }
    const rows = [...groups.values()].sort((a, b) => `${a.year} ${a.subject}`.localeCompare(`${b.year} ${b.subject}`));
    const termNames = ['1st Term', '2nd Term', '3rd Term'];
    target.innerHTML = `
      <article class="print-report-card">
        <div class="report-card-heading"><div><p class="eyebrow">BALINGASA HIGH SCHOOL</p><h2>STUDENT REPORT CARD</h2><p>Grades available to the adviser and this teacher</p></div><button type="button" class="button primary report-print-button" data-action="print-report-card">Print Report Card</button></div>
        <div class="report-student-details"><div><small>STUDENT NAME</small><strong>${escapeHTML(formatName(student))}</strong></div><div><small>LEARNER REFERENCE NUMBER</small><strong>${escapeHTML(student.lrn)}</strong></div><div><small>SECTION</small><strong>${escapeHTML(rows[0]?.section || '—')}</strong></div><div><small>GRADE LEVEL</small><strong>${escapeHTML(rows[0]?.grade_level || '—')}</strong></div></div>
        ${rows.length ? `<div class="table-wrapper"><table class="report-card-table"><thead><tr><th>School Year</th><th>Subject</th><th>Teacher</th><th>Section</th>${termNames.map(t => `<th>${escapeHTML(t)}</th>`).join('')}<th>Average*</th></tr></thead><tbody>${rows.map(row => {
          const values = termNames.map(term => row.terms[term]);
          const available = values.filter(value => Number.isFinite(value));
          const average = available.length ? (available.reduce((sum, value) => sum + value, 0) / available.length).toFixed(2) : '—';
          return `<tr><td>${escapeHTML(row.year)}</td><td>${escapeHTML(row.code ? `${row.code} · ${row.subject}` : row.subject)}</td><td>${escapeHTML(row.teacher)}</td><td>${escapeHTML(row.section)}</td>${values.map(value => `<td>${Number.isFinite(value) ? value.toFixed(2) : '—'}</td>`).join('')}<td><strong>${average}</strong></td></tr>`;
        }).join('')}</tbody></table></div><p class="report-card-footnote">*Average is the mean of available term grades. It is not an official final subject grade unless all required terms are recorded.</p>` : messageBox('No grades are available for this student yet. Grades must be saved by the teacher or received through Distribute Grades.')}
        <div class="report-card-signatures"><div>Class Adviser</div><div>School Head</div><div>Parent / Guardian</div></div>
      </article>
    `;
  } catch (error) {
    console.error(error);
    target.innerHTML = messageBox(errorMessage(error), 'error');
  }
}

async function renderSubjects(user) {
  const assignments = await getTeacherAssignments(user.id);

  return `
    <div class="page-heading">
      <div><h2>My Subjects</h2><p>Subjects and sections assigned to your account.</p></div>
    </div>
    <section class="panel">
      ${
        assignments.length
          ? `<div class="table-wrapper"><table>
              <thead><tr><th>Subject</th><th>Section</th><th>Assignment ID</th></tr></thead>
              <tbody>${assignments.map((a) => `
                <tr>
                  <td>${escapeHTML(a.subject_name)}</td>
                  <td>${escapeHTML(a.section_name)}</td>
                  <td>${escapeHTML(a.id)}</td>
                </tr>
              `).join('')}</tbody>
            </table></div>`
          : messageBox('No teaching assignments were found.')
      }
    </section>
  `;
}

async function renderAssessments(user) {
  const assignments = await getTeacherAssignments(user.id);

  if (!assignments.length) {
    return `<h2>Assessments</h2>${messageBox('You need a teaching assignment before creating an assessment.')}`;
  }

  const { data: assessments, error } = await supabase
    .from('assessments')
    .select('id, teaching_assignment_id, grading_period, assessment_type, title, max_score, assessment_date')
    .in('teaching_assignment_id', assignments.map((a) => a.id))
    .order('id', { ascending: false });

  if (error) throw error;

  const assignmentMap = new Map(assignments.map((a) => [
    String(a.id),
    assignmentLabel(a)
  ]));

  return `
    <div class="page-heading">
      <div><h2>Assessments</h2><p>Create and view quizzes, activities, performance tasks, and exams.</p></div>
    </div>

    <section class="panel">
      <h3>Create Assessment</h3>
      <form data-form="create-assessment" class="form-grid">
        <label>Subject and Section
          <select name="teaching_assignment_id" required>
            ${assignmentOptions(assignments)}
          </select>
        </label>
        <label>Grading Term
          <select name="grading_period" required>${termOptions()}</select>
        </label>
        <label>Assessment Type
          <select name="assessment_type" required>${typeOptions()}</select>
        </label>
        <label>Title
          <input name="title" type="text" maxlength="150" required placeholder="e.g. Quiz 1">
        </label>
        <label>Maximum Score
          <input name="max_score" type="number" min="1" step="any" required>
        </label>
        <label>Date
          <input name="assessment_date" type="date">
        </label>
        <button type="submit">Save Assessment</button>
      </form>
      <div data-form-message></div>
    </section>

    <section class="panel">
      <h3>Assessment List</h3>
      ${
        assessments?.length
          ? `<div class="table-wrapper"><table>
              <thead><tr><th>Subject / Section</th><th>Term</th><th>Type</th><th>Title</th><th>Max Score</th><th>Date</th></tr></thead>
              <tbody>${assessments.map((a) => `
                <tr>
                  <td>${escapeHTML(assignmentMap.get(String(a.teaching_assignment_id)) || '—')}</td>
                  <td>${escapeHTML(a.grading_period)}</td>
                  <td>${escapeHTML(a.assessment_type)}</td>
                  <td>${escapeHTML(a.title)}</td>
                  <td>${escapeHTML(a.max_score)}</td>
                  <td>${escapeHTML(a.assessment_date || '—')}</td>
                </tr>
              `).join('')}</tbody>
            </table></div>`
          : messageBox('No assessments have been created yet.')
      }
    </section>
  `;
}

async function renderGradebook(user) {
  const assignments = await getTeacherAssignments(user.id);

  if (!assignments.length) {
    return `<h2>Gradebook</h2>${messageBox('You need a teaching assignment before using the gradebook.')}`;
  }

  return `
    <div class="page-heading">
      <div><h2>Gradebook</h2><p>Enter assessment scores to calculate weighted initial and term grades using the selected school year grading policy.</p></div>
    </div>
    <section class="panel">
      <form data-form="load-gradebook" class="form-grid gradebook-controls">
        <label>Subject and Section
          <select name="teaching_assignment_id" required>${assignmentOptions(assignments)}</select>
        </label>
        <label>Grading Term
          <select name="grading_period" required>${termOptions()}</select>
        </label>
        <label>SHS Subject Weight Profile
          <select name="grade_profile" required>
            ${Object.entries(GRADE_PROFILES).map(([key, p]) => `<option value="${key}" ${key === 'core' ? 'selected' : ''}>${escapeHTML(p.label)} (WW ${p.ww}% · PT ${p.pt}% · EX ${p.ex}%)</option>`).join('')}
          </select>
        </label>
        <button class="button primary" type="submit">Load Gradebook</button>
      </form>
      <div data-gradebook-results></div>
    </section>
  `;
}

async function loadGradebook(root, assignmentId, term, profileKey = 'core') {
  const target = root.querySelector('[data-gradebook-results]');
  if (!target) return;
  const profile = GRADE_PROFILES[profileKey] || GRADE_PROFILES.core;
  target.innerHTML = messageBox('Loading gradebook...');

  try {
    const { data: assignment, error: assignmentError } = await supabase
      .from('teaching_assignments')
      .select('id, section_id, school_year_id')
      .eq('id', assignmentId)
      .single();

    if (assignmentError) throw assignmentError;
    const schoolYearName = await getSchoolYearName(assignment.school_year_id);

    const [students, assessmentsResult] = await Promise.all([
      getStudentsForAssignment(assignmentId, assignment.section_id),
      supabase.from('assessments').select('id, assessment_type, title, max_score').eq('teaching_assignment_id', assignmentId).eq('grading_period', term).order('id', { ascending: true })
    ]);
    const { data: assessments, error: assessmentsError } = assessmentsResult;
    if (assessmentsError) throw assessmentsError;

    const assessmentRows = assessments || [];
    let scores = [];
    if (assessmentRows.length) {
      const result = await supabase.from('assessment_scores')
        .select('id, assessment_id, student_id, score')
        .in('assessment_id', assessmentRows.map(a => a.id));
      if (result.error) throw result.error;
      scores = result.data || [];
    }
    const scoreMap = new Map(scores.map(s => [`${s.assessment_id}:${s.student_id}`, s]));
    const groups = [
      { key: 'ww', label: `WRITTEN / ORAL WORKS (${profile.ww}%)` },
      { key: 'pt', label: `PRODUCT / PERFORMANCE TASKS (${profile.pt}%)` },
      { key: 'ex', label: `SUMMATIVE TESTS / EXAMINATIONS (${profile.ex}%)` }
    ];
    const grouped = Object.fromEntries(groups.map(g => [g.key, assessmentRows.filter(a => assessmentCategory(a.assessment_type) === g.key)]));
    const groupedHeader = groups.map(g => `<th colspan="${Math.max(1, grouped[g.key].length + 3)}">${g.label}</th>`).join('');
    const columnHeader = groups.map(g => `${grouped[g.key].map((a, i) => `<th title="Maximum score: ${escapeHTML(a.max_score)}">${escapeHTML(a.title || `${g.key.toUpperCase()} ${i + 1}`)}</th>`).join('')}<th>Total</th><th>PS</th><th>WS</th>`).join('');
    const maxScoreHeader = groups.map(g => `${grouped[g.key].map(a => `<th>${escapeHTML(a.max_score)}</th>`).join('')}<th>${grouped[g.key].reduce((sum, a) => sum + Number(a.max_score || 0), 0)}</th><th>100</th><th>${profile[g.key]}%</th>`).join('');
    target.innerHTML = `
      <div class="gradebook-title"><div><h3>${escapeHTML(term)} · ${escapeHTML(profile.label)}</h3><p>PS = percentage score; WS = weighted score. For ${escapeHTML(schoolYearName || 'this school year')}, the term grade uses ${escapeHTML(gradingPolicyDescription(schoolYearName))}.</p></div></div>
      ${assessmentRows.length ? `<form data-form="save-gradebook" class="gradebook-form" data-school-year="${escapeHTML(schoolYearName)}">
        <input type="hidden" name="teaching_assignment_id" value="${escapeHTML(assignmentId)}">
        <input type="hidden" name="grading_period" value="${escapeHTML(term)}">
        <input type="hidden" name="grade_profile" value="${escapeHTML(profileKey)}">
        <div class="table-wrapper gradebook-table-wrap"><table class="gradebook-table"><thead>
          <tr><th colspan="2">GRADE &amp; SECTION: ${escapeHTML(assignment.section_id)}</th>${groupedHeader}<th rowspan="3">INITIAL GRADE</th><th rowspan="3">TERM GRADE</th></tr>
          <tr><th rowspan="2">#</th><th rowspan="2">LEARNERS' NAMES</th>${columnHeader}</tr><tr>${maxScoreHeader}</tr>
        </thead><tbody>${students.map((student, index) => {
          const categoryCells = groups.map(g => `${grouped[g.key].map(a => {
            const score = scoreMap.get(`${a.id}:${student.lrn}`);
            return `<td><input class="grade-score" type="number" name="score_${student.lrn}_${a.id}" data-student="${escapeHTML(student.lrn)}" data-assessment="${a.id}" data-category="${g.key}" data-max="${escapeHTML(a.max_score)}" min="0" max="${escapeHTML(a.max_score)}" step="any" value="${score?.score ?? ''}" ${student.is_active === false ? 'disabled' : ''} aria-label="${escapeHTML(student.lrn)} ${escapeHTML(a.title)}"></td>`;
          }).join('')}<td data-total="${g.key}" data-student="${escapeHTML(student.lrn)}">—</td><td data-ps="${g.key}" data-student="${escapeHTML(student.lrn)}">—</td><td data-ws="${g.key}" data-student="${escapeHTML(student.lrn)}">—</td>`).join('');
          return `<tr><td>${index + 1}</td><td class="learner-name">${escapeHTML(formatName(student))}<small>${escapeHTML(student.lrn)} · ${student.is_active === false ? 'Dropped' : 'Active'}</small></td>${categoryCells}<td data-initial="${escapeHTML(student.lrn)}">—</td><td data-term="${escapeHTML(student.lrn)}">—</td></tr>`;
        }).join('')}</tbody></table></div>
        <button class="button primary" type="submit">Save Scores and Grades</button><div data-form-message></div>
      </form>` : messageBox('Create assessments for this subject, section, and grading term before entering scores.')}
    `;
    const gradeForm = target.querySelector('[data-form="save-gradebook"]');
    if (gradeForm) {
      gradeForm.addEventListener('input', () => updateGradebookTotals(gradeForm, profile));
      updateGradebookTotals(gradeForm, profile);
    }
  } catch (error) {
    console.error(error);
    target.innerHTML = messageBox(errorMessage(error), 'error');
  }
}

function updateGradebookTotals(form, profile) {
  const schoolYearName = form.dataset.schoolYear || '';
  const students = [...new Set([...form.querySelectorAll('.grade-score')].map(input => input.dataset.student))];
  for (const studentId of students) {
    let initial = 0;
    for (const category of ['ww', 'pt', 'ex']) {
      const inputs = [...form.querySelectorAll(`.grade-score[data-student="${CSS.escape(studentId)}"][data-category="${category}"]`)];
      const max = inputs.reduce((sum, input) => sum + Number(input.dataset.max || 0), 0);
      const scored = inputs.reduce((sum, input) => sum + (input.value === '' ? 0 : Number(input.value)), 0);
      const percentage = max ? scored / max * 100 : 0;
      const weighted = percentage * profile[category] / 100;
      form.querySelector(`[data-total="${category}"][data-student="${CSS.escape(studentId)}"]`).textContent = `${scored.toFixed(2)} / ${max.toFixed(2)}`;
      form.querySelector(`[data-ps="${category}"][data-student="${CSS.escape(studentId)}"]`).textContent = percentage.toFixed(2);
      form.querySelector(`[data-ws="${category}"][data-student="${CSS.escape(studentId)}"]`).textContent = weighted.toFixed(2);
      initial += weighted;
    }
    form.querySelector(`[data-initial="${CSS.escape(studentId)}"]`).textContent = initial.toFixed(2);
    form.querySelector(`[data-term="${CSS.escape(studentId)}"]`).textContent = termGradeForYear(initial, schoolYearName);
  }
}

async function saveGradebook(form) {
  const assignmentId = Number(form.elements.teaching_assignment_id.value);
  const term = form.elements.grading_period.value;
  const profile = GRADE_PROFILES[form.elements.grade_profile.value] || GRADE_PROFILES.core;
  const { data: assignment, error: assignmentError } = await supabase.from('teaching_assignments')
    .select('id, section_id, school_year_id').eq('id', assignmentId).single();
  if (assignmentError) throw assignmentError;
  const schoolYearName = await getSchoolYearName(assignment.school_year_id);
  const students = await getStudentsForAssignment(assignmentId, assignment.section_id, 'id, lrn, is_active');

  let savedCount = 0;
  for (const input of form.querySelectorAll('.grade-score:not(:disabled)')) {
    const { data: existing, error } = await supabase.from('assessment_scores').select('id')
      .eq('assessment_id', input.dataset.assessment).eq('student_id', input.dataset.student).maybeSingle();
    if (error) throw error;
    if (input.value.trim() === '') {
      if (existing) {
        const { error: deleteError } = await supabase.from('assessment_scores').delete().eq('id', existing.id);
        if (deleteError) throw deleteError;
      }
      continue;
    }
    const score = Number(input.value);
    const max = Number(input.dataset.max);
    if (!Number.isFinite(score) || score < 0 || score > max) throw new Error(`Score must be between 0 and ${max}.`);
    const payload = { assessment_id: Number(input.dataset.assessment), student_id: input.dataset.student, score };
    const result = existing
      ? await supabase.from('assessment_scores').update(payload).eq('id', existing.id)
      : await supabase.from('assessment_scores').insert(payload);
    if (result.error) throw result.error;
    savedCount++;
  }

  const { data: assessments, error: assessmentsError } = await supabase.from('assessments')
    .select('id, assessment_type, max_score').eq('teaching_assignment_id', assignmentId).eq('grading_period', term);
  if (assessmentsError) throw assessmentsError;
  const { data: scores, error: scoresError } = await supabase.from('assessment_scores')
    .select('assessment_id, student_id, score').in('assessment_id', (assessments || []).map(a => a.id));
  if (scoresError) throw scoresError;
  const scoreMap = new Map((scores || []).map(s => [`${s.assessment_id}:${s.student_id}`, Number(s.score)]));
  const { data: existingGrades, error: gradesError } = await supabase.from('grades')
    .select('id, student_id').eq('teaching_assignment_id', assignmentId).eq('grading_period', term);
  if (gradesError) throw gradesError;
  const gradeMap = new Map((existingGrades || []).map(g => [String(g.student_id), g]));

  for (const student of students) {
    if (student.is_active === false) continue;
    let initialGrade = 0;
    for (const category of ['ww', 'pt', 'ex']) {
      const categoryAssessments = (assessments || []).filter(a => assessmentCategory(a.assessment_type) === category);
      const maxTotal = categoryAssessments.reduce((sum, a) => sum + Number(a.max_score || 0), 0);
      const scoreTotal = categoryAssessments.reduce((sum, a) => sum + (scoreMap.get(`${a.id}:${student.lrn}`) || 0), 0);
      initialGrade += (maxTotal ? scoreTotal / maxTotal * 100 : 0) * profile[category] / 100;
    }
    const payload = {
      student_id: student.lrn,
      teaching_assignment_id: assignmentId,
      grading_period: term,
      grade_value: termGradeForYear(initialGrade, schoolYearName),
      status: 'finalized',
      updated_at: new Date().toISOString()
    };
    const existing = gradeMap.get(String(student.lrn));
    const result = existing
      ? await supabase.from('grades').update(payload).eq('id', existing.id)
      : await supabase.from('grades').insert(payload);
    if (result.error) throw result.error;
  }
  return `Saved ${savedCount} assessment score(s) and updated weighted term grades using ${gradingPolicyDescription(schoolYearName)}.`;
}

async function renderDistribution(user) {
  const assignments = await getTeacherAssignments(user.id);

  if (!assignments.length) {
    return `<h2>Distribute Grades</h2>${messageBox('You need a teaching assignment before distributing grades.')}`;
  }

  return `
    <div class="page-heading">
      <div><h2>Distribute Grades</h2><p>Grades are grouped by each student's advisory class and sent to that adviser, even when another teacher teaches the subject.</p></div>
    </div>

    <section class="panel">
      <form data-form="distribute-grades" class="form-grid">
        <label>Subject and Section
          <select name="teaching_assignment_id" required>${assignmentOptions(assignments)}</select>
        </label>
        <label>Grading Term
          <select name="grading_period" required>${termOptions()}</select>
        </label>
        <p class="notice info">Each student’s adviser is determined from their advisory roster. Subject enrollment does not change their adviser.</p>
        <label>Note (optional)
          <input type="text" name="note" maxlength="250" placeholder="Optional message">
        </label>
        <button type="submit">Send Grades</button>
      </form>
      <div data-form-message></div>
    </section>
  `;
}

async function sendGrades(form, user) {
  const assignmentId = Number(form.elements.teaching_assignment_id.value);
  const term = form.elements.grading_period.value;
  const note = form.elements.note.value.trim();
  const confirmed = window.confirm('Send the saved grades from this subject to each student’s adviser? Grades will be grouped by advisory class.');
  if (!confirmed) return 'Sending cancelled.';

  const { data, error } = await supabase.rpc('send_assignment_grades_to_advisers', {
    p_teaching_assignment_id: assignmentId,
    p_grading_period: term,
    p_note: note || null
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.distribution_count) {
    return `No grade distribution was needed. The ${result?.total_grade_count || 0} grade record(s) are already in your own advisory class.`;
  }

  const recipients = (result.recipients || []).join(', ');
  return `Successfully sent ${result.grade_count} grade record(s) to ${recipients} across ${result.distribution_count} advisory class(es).`;
}

async function renderHistory(user) {
  const { data: distributions, error } = await supabase
    .from('grade_distributions')
    .select('id, sender_teacher_id, recipient_teacher_id, section_id, school_year_id, status, note, sent_at')
    .or(`sender_teacher_id.eq.${user.id},recipient_teacher_id.eq.${user.id}`)
    .order('sent_at', { ascending: false });

  if (error) throw error;

  const profileIds = [...new Set((distributions || []).flatMap((d) => [
    d.sender_teacher_id,
    d.recipient_teacher_id
  ]).filter(Boolean))];

  const sectionIds = [...new Set((distributions || []).map((d) => d.section_id).filter(Boolean))];

  let profiles = [];
  let sections = [];

  if (profileIds.length) {
    const result = await supabase.from('profiles').select('id, full_name').in('id', profileIds);
    if (result.error) throw result.error;
    profiles = result.data || [];
  }

if (sectionIds.length) {
  const result = await supabase
    .from('sections')
    .select('id, section_name')
    .in('id', sectionIds);

  if (result.error) throw result.error;
  sections = result.data || [];
}

  const profileMap = new Map(profiles.map((p) => [String(p.id), p.full_name || 'Teacher']));
const sectionMap = new Map(
  sections.map(section => [String(section.id), section.section_name])
);
  const distributionIds = (distributions || []).map((d) => d.id);
  let itemCounts = new Map();

  if (distributionIds.length) {
    const result = await supabase
      .from('grade_distribution_items')
      .select('distribution_id')
      .in('distribution_id', distributionIds);

    if (result.error) throw result.error;

    itemCounts = (result.data || []).reduce((map, item) => {
      const key = String(item.distribution_id);
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map());
  }

  return `
    <div class="page-heading">
      <div><h2>Distribution History</h2><p>Grades you have sent or received.</p></div>
    </div>
    <section class="panel">
      ${
        distributions?.length
          ? `<div class="table-wrapper"><table>
              <thead><tr><th>Date</th><th>Direction</th><th>Other Teacher</th><th>Section</th><th>Grade Records</th><th>Status</th><th>Note</th></tr></thead>
              <tbody>${distributions.map((d) => {
                const sentByMe = d.sender_teacher_id === user.id;
                const otherTeacherId = sentByMe ? d.recipient_teacher_id : d.sender_teacher_id;

                return `
                  <tr>
                    <td>${escapeHTML(d.sent_at ? new Date(d.sent_at).toLocaleString() : '—')}</td>
                    <td>${sentByMe ? 'Sent' : 'Received'}</td>
                    <td>${escapeHTML(profileMap.get(String(otherTeacherId)) || 'Teacher')}</td>
                    <td>${escapeHTML(sectionMap.get(String(d.section_id)) || '—')}</td>
                    <td>${itemCounts.get(String(d.id)) || 0}</td>
                    <td>${escapeHTML(d.status)}</td>
                    <td>${escapeHTML(d.note || '—')}</td>
                  </tr>
                `;
              }).join('')}</tbody>
            </table></div>`
          : messageBox('No grade distributions have been recorded yet.')
      }
    </section>
  `;
}

export async function renderDashboard(root, user) {
  const currentUser = await getCurrentUser(user);

  let profile = null;
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) console.warn('Could not load profile:', error.message);
  profile = data;

  const dashboardUser = {
    ...currentUser,
    full_name: profile?.full_name || currentUser.user_metadata?.full_name || currentUser.email,
    role: profile?.role || 'teacher'
  };

  await showView(root, 'overview', dashboardUser);
  return dashboardUser;
}

export function bindDashboard(root, user, showLogin) {
  if (root.dataset.dashboardBound === 'true') return;
  root.dataset.dashboardBound = 'true';

  root.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view]');
    const logoutButton = event.target.closest('[data-action="logout"]');
    const printCardButton = event.target.closest('[data-action="print-report-card"]');

    if (printCardButton) {
      window.print();
      return;
    }

    if (logoutButton) {
      const { error } = await supabase.auth.signOut();

      if (error) {
        alert(error.message);
        return;
      }

      if (typeof showLogin === 'function') {
        await showLogin();
      } else {
        window.location.reload();
      }
      return;
    }

    const editStudentButton = event.target.closest('[data-action="edit-student"]');
    const deleteStudentButton = event.target.closest('[data-action="delete-student"]');
    const cancelStudentEdit = event.target.closest('[data-action="cancel-student-edit"]');
    const removeSubjectEnrollment = event.target.closest('[data-action="remove-subject-enrollment"]');

    if (removeSubjectEnrollment) {
      const { error } = await supabase.from('teaching_assignment_students').delete()
        .eq('teaching_assignment_id', removeSubjectEnrollment.dataset.assignmentId)
        .eq('student_lrn', removeSubjectEnrollment.dataset.studentLrn);
      if (error) {
        alert(errorMessage(error));
        return;
      }
      await showView(root, 'students', user);
      return;
    }

    if (editStudentButton) {
      const row = editStudentButton.closest('[data-student-row]');
      const sectionId = editStudentButton.dataset.sectionId;
      const sectionOptions = editStudentButton.dataset.sectionOptions
        .replace(`value="${sectionId}"`, `value="${sectionId}" selected`);
      row.innerHTML = `<td colspan="5"><form data-form="update-student" class="student-inline-form">
        <input type="hidden" name="student_lrn" value="${escapeHTML(editStudentButton.dataset.lrn)}">
        <label>First Name<input name="first_name" type="text" maxlength="100" required value="${escapeHTML(editStudentButton.dataset.firstName)}"></label>
        <label>Last Name<input name="last_name" type="text" maxlength="100" required value="${escapeHTML(editStudentButton.dataset.lastName)}"></label>
        <label>Section<select name="section_id" required>${sectionOptions}</select></label>
        <label>Status<select name="is_active"><option value="true" ${editStudentButton.dataset.active === 'true' ? 'selected' : ''}>Active</option><option value="false" ${editStudentButton.dataset.active === 'false' ? 'selected' : ''}>Dropped</option></select></label>
        <span class="student-edit-lrn">LRN: ${escapeHTML(editStudentButton.dataset.lrn)} (fixed to preserve grade records)</span>
        <div class="student-actions"><button class="button primary" type="submit">Save Changes</button><button class="button" type="button" data-action="cancel-student-edit">Cancel</button></div>
        <div data-form-message></div>
      </form></td>`;
      return;
    }

    if (cancelStudentEdit) {
      await showView(root, 'students', user);
      return;
    }

    if (deleteStudentButton) {
      const lrn = deleteStudentButton.dataset.lrn;
      if (!window.confirm(`Delete student ${lrn}? This cannot be undone. Existing grade history may prevent deletion.`)) return;
      const { error } = await supabase.from('students').delete().eq('lrn', lrn);
      if (error) {
        alert(errorMessage(error));
        return;
      }
      await showView(root, 'students', user);
      const content = root.querySelector('.dashboard-content');
      if (content) content.insertAdjacentHTML('afterbegin', messageBox('Student deleted.', 'success'));
      return;
    }

    if (viewButton) {
      const view = viewButton.dataset.view;
      try {
        await showView(root, view, user);
      } catch (error) {
        console.error(error);
        root.innerHTML = layout(user, messageBox(errorMessage(error), 'error'), view);
      }
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;

    event.preventDefault();

    const messageTarget = form.querySelector('[data-form-message]');

    if (messageTarget) {
      messageTarget.innerHTML = messageBox('Please wait...');
    }

    try {
      let message = '';

      if (form.dataset.form === 'add-student') {
        const payload = {
          lrn: form.elements.lrn.value.trim(),
          first_name: form.elements.first_name.value.trim(),
          last_name: form.elements.last_name.value.trim(),
          section_id: Number(form.elements.section_id.value),
          is_active: true
        };
        if (!payload.lrn || !payload.first_name || !payload.last_name || !Number.isInteger(payload.section_id)) {
          throw new Error('Enter the student details and select a section.');
        }
        const { error } = await supabase.from('students').insert(payload);
        if (error) throw error;
        await showView(root, 'students', user);
        const content = root.querySelector('.dashboard-content');
        if (content) content.insertAdjacentHTML('afterbegin', messageBox('Student added.', 'success'));
        return;
      }

      if (form.dataset.form === 'enroll-existing-student') {
        const lrn = form.elements.lrn.value.trim();
        const teachingAssignmentId = Number(form.elements.teaching_assignment_id.value);
        if (!lrn || !Number.isInteger(teachingAssignmentId)) {
          throw new Error('Enter the student’s existing LRN and select a subject assignment.');
        }
        const { error } = await supabase.rpc('enroll_student_in_teaching_assignment', {
          p_lrn: lrn,
          p_teaching_assignment_id: teachingAssignmentId
        });
        if (error) throw error;
        await showView(root, 'students', user);
        const content = root.querySelector('.dashboard-content');
        if (content) content.insertAdjacentHTML('afterbegin', messageBox('Student enrolled in your subject roster. Their advisory class is unchanged.', 'success'));
        return;
      }

      if (form.dataset.form === 'update-student') {
        const payload = {
          first_name: form.elements.first_name.value.trim(),
          last_name: form.elements.last_name.value.trim(),
          section_id: Number(form.elements.section_id.value),
          is_active: form.elements.is_active.value === 'true'
        };
        if (!payload.first_name || !payload.last_name || !Number.isInteger(payload.section_id)) {
          throw new Error('Enter the student details and select a section.');
        }
        const { data: updatedStudent, error } = await supabase.from('students').update(payload)
          .eq('lrn', form.elements.student_lrn.value)
          .select('lrn, is_active')
          .maybeSingle();
        if (error) throw error;
        if (!updatedStudent) {
          throw new Error('No student record was updated. Check that your account has permission to edit students in this section.');
        }
        await showView(root, 'students', user);
        const content = root.querySelector('.dashboard-content');
        if (content) content.insertAdjacentHTML('afterbegin', messageBox('Student details updated.', 'success'));
        return;
      }

      if (form.dataset.form === 'create-assessment') {
        const payload = {
          teaching_assignment_id: Number(form.elements.teaching_assignment_id.value),
          grading_period: form.elements.grading_period.value,
          assessment_type: form.elements.assessment_type.value,
          title: form.elements.title.value.trim(),
          max_score: Number(form.elements.max_score.value),
          assessment_date: form.elements.assessment_date.value || null
        };

        if (!payload.title) throw new Error('Enter an assessment title.');
        if (!Number.isFinite(payload.max_score) || payload.max_score <= 0) {
          throw new Error('Maximum score must be greater than zero.');
        }

        const { error } = await supabase.from('assessments').insert(payload);
        if (error) throw error;

        message = 'Assessment saved successfully.';
        await showView(root, 'assessments', user);
        const target = root.querySelector('.dashboard-content');
        if (target) target.insertAdjacentHTML('afterbegin', messageBox(message, 'success'));
        return;
      }

      if (form.dataset.form === 'load-gradebook') {
        await loadGradebook(
          root,
          form.elements.teaching_assignment_id.value,
          form.elements.grading_period.value,
          form.elements.grade_profile.value
        );
        return;
      }

      if (form.dataset.form === 'load-report-card') {
        await loadStudentReportCard(root, form.elements.student_id.value, user);
        return;
      }

      if (form.dataset.form === 'save-gradebook') {
        message = await saveGradebook(form);

        const assignmentId = form.elements.teaching_assignment_id.value;
        const term = form.elements.grading_period.value;

        await loadGradebook(root, assignmentId, term, form.elements.grade_profile.value);

        const target = root.querySelector('[data-gradebook-results]');
        if (target) target.insertAdjacentHTML('afterbegin', messageBox(message, 'success'));
        return;
      }

      if (form.dataset.form === 'distribute-grades') {
        message = await sendGrades(form, user);

        if (message === 'Sending cancelled.') {
          if (messageTarget) messageTarget.innerHTML = messageBox(message);
          return;
        }

        await showView(root, 'distribution', user);
        const target = root.querySelector('.dashboard-content');
        if (target) target.insertAdjacentHTML('afterbegin', messageBox(message, 'success'));
        return;
      }
    } catch (error) {
      console.error(error);
      if (messageTarget) {
        messageTarget.innerHTML = messageBox(errorMessage(error), 'error');
      } else {
        alert(errorMessage(error));
      }
    }
  });
}
