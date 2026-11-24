-- Keep one canonical student record in the advisory class and allow that
-- student to join subject assignments taught by other teachers.

CREATE TABLE IF NOT EXISTS public.teaching_assignment_students (
  teaching_assignment_id bigint NOT NULL REFERENCES public.teaching_assignments(id) ON DELETE CASCADE,
  student_lrn text NOT NULL REFERENCES public.students(lrn) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teaching_assignment_id, student_lrn)
);

ALTER TABLE public.teaching_assignment_students ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS teaching_assignment_students_student_lrn_idx
  ON public.teaching_assignment_students (student_lrn);

DROP POLICY IF EXISTS teaching_assignment_students_teacher_read ON public.teaching_assignment_students;
CREATE POLICY teaching_assignment_students_teacher_read
ON public.teaching_assignment_students
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.teaching_assignments assignment
  WHERE assignment.id = teaching_assignment_students.teaching_assignment_id
    AND assignment.teacher_id = auth.uid()
));

DROP POLICY IF EXISTS teaching_assignment_students_teacher_delete ON public.teaching_assignment_students;
CREATE POLICY teaching_assignment_students_teacher_delete
ON public.teaching_assignment_students
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.teaching_assignments assignment
  WHERE assignment.id = teaching_assignment_students.teaching_assignment_id
    AND assignment.teacher_id = auth.uid()
));

CREATE OR REPLACE FUNCTION public.enroll_student_in_teaching_assignment(
  p_lrn text,
  p_teaching_assignment_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_lrn text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.teaching_assignments assignment
    WHERE assignment.id = p_teaching_assignment_id
      AND assignment.teacher_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You can only enroll students in your own subject assignments.';
  END IF;

  SELECT student.lrn INTO v_student_lrn
  FROM public.students student
  JOIN public.sections advisory_section ON advisory_section.id = student.section_id
  JOIN public.teaching_assignments assignment
    ON assignment.id = p_teaching_assignment_id
   AND assignment.school_year_id = advisory_section.school_year_id
  WHERE student.lrn = trim(p_lrn)
    AND student.is_active IS DISTINCT FROM false;

  IF v_student_lrn IS NULL THEN
    RAISE EXCEPTION 'No active student was found for that LRN in this school year. Ask the student’s adviser to add them first.';
  END IF;

  INSERT INTO public.teaching_assignment_students (teaching_assignment_id, student_lrn, created_by)
  VALUES (p_teaching_assignment_id, v_student_lrn, auth.uid())
  ON CONFLICT (teaching_assignment_id, student_lrn) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_student_in_teaching_assignment(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_student_in_teaching_assignment(text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_teacher_access_assignment_student(
  p_teaching_assignment_id bigint,
  p_student_lrn text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teaching_assignments assignment
    JOIN public.students student ON student.lrn = p_student_lrn
    WHERE assignment.id = p_teaching_assignment_id
      AND assignment.teacher_id = auth.uid()
      AND (
        assignment.section_id = student.section_id
        OR EXISTS (
          SELECT 1 FROM public.teaching_assignment_students enrollment
          WHERE enrollment.teaching_assignment_id = assignment.id
            AND enrollment.student_lrn = student.lrn
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_teacher_access_assignment_student(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_assignment_student(bigint, text) TO authenticated;

DROP POLICY IF EXISTS students_teacher_read_subject_enrollments ON public.students;
CREATE POLICY students_teacher_read_subject_enrollments
ON public.students
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1
    FROM public.teaching_assignment_students enrollment
    JOIN public.teaching_assignments assignment
      ON assignment.id = enrollment.teaching_assignment_id
    WHERE enrollment.student_lrn = students.lrn
      AND assignment.teacher_id = auth.uid()
  )
);

-- Grade entry and term grades must belong to a student in that subject roster.
DROP POLICY IF EXISTS scores_insert_owned ON public.assessment_scores;
CREATE POLICY scores_insert_owned
ON public.assessment_scores
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.assessments assessment
  WHERE assessment.id = assessment_scores.assessment_id
    AND public.can_teacher_access_assignment_student(assessment.teaching_assignment_id, assessment_scores.student_id)
));

DROP POLICY IF EXISTS scores_update_owned ON public.assessment_scores;
CREATE POLICY scores_update_owned
ON public.assessment_scores
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assessments assessment
  WHERE assessment.id = assessment_scores.assessment_id
    AND public.can_teacher_access_assignment_student(assessment.teaching_assignment_id, assessment_scores.student_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.assessments assessment
  WHERE assessment.id = assessment_scores.assessment_id
    AND public.can_teacher_access_assignment_student(assessment.teaching_assignment_id, assessment_scores.student_id)
));

DROP POLICY IF EXISTS scores_delete_owned ON public.assessment_scores;
CREATE POLICY scores_delete_owned
ON public.assessment_scores
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assessments assessment
  WHERE assessment.id = assessment_scores.assessment_id
    AND public.can_teacher_access_assignment_student(assessment.teaching_assignment_id, assessment_scores.student_id)
));

DROP POLICY IF EXISTS grades_insert_owned ON public.grades;
CREATE POLICY grades_insert_owned
ON public.grades
FOR INSERT TO authenticated
WITH CHECK (
  public.owns_assignment(teaching_assignment_id)
  AND public.can_teacher_access_assignment_student(teaching_assignment_id, student_id)
);

DROP POLICY IF EXISTS grades_update_owned ON public.grades;
CREATE POLICY grades_update_owned
ON public.grades
FOR UPDATE TO authenticated
USING (
  public.owns_assignment(teaching_assignment_id)
  AND public.can_teacher_access_assignment_student(teaching_assignment_id, student_id)
)
WITH CHECK (
  public.owns_assignment(teaching_assignment_id)
  AND public.can_teacher_access_assignment_student(teaching_assignment_id, student_id)
);

DROP POLICY IF EXISTS grades_delete_owned ON public.grades;
CREATE POLICY grades_delete_owned
ON public.grades
FOR DELETE TO authenticated
USING (
  public.owns_assignment(teaching_assignment_id)
  AND public.can_teacher_access_assignment_student(teaching_assignment_id, student_id)
);

-- One submission can create separate adviser distributions for students from
-- different advisory classes.
CREATE OR REPLACE FUNCTION public.can_create_grade_distribution(
  p_section_id bigint,
  p_school_year_id bigint,
  p_recipient_teacher_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_recipient_teacher_id IS NOT NULL
    AND p_recipient_teacher_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles recipient
      WHERE recipient.id = p_recipient_teacher_id AND recipient.role = 'teacher'
    )
    AND EXISTS (
      SELECT 1 FROM public.sections section
      WHERE section.id = p_section_id
        AND section.school_year_id = p_school_year_id
        AND section.adviser_teacher_id = p_recipient_teacher_id
    )
    AND EXISTS (
      SELECT 1 FROM public.teaching_assignments assignment
      WHERE assignment.teacher_id = auth.uid()
        AND assignment.school_year_id = p_school_year_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.grades grade
      JOIN public.students student ON student.lrn = grade.student_id
      JOIN public.teaching_assignments assignment
        ON assignment.id = grade.teaching_assignment_id
      WHERE assignment.teacher_id = auth.uid()
        AND assignment.school_year_id = p_school_year_id
        AND student.section_id = p_section_id
        AND public.can_teacher_access_assignment_student(assignment.id, student.lrn)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_attach_grade_to_distribution(
  p_distribution_id bigint,
  p_grade_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.grade_distributions distribution
    JOIN public.sections section
      ON section.id = distribution.section_id
     AND section.school_year_id = distribution.school_year_id
    JOIN public.grades grade ON grade.id = p_grade_id
    JOIN public.teaching_assignments assignment
      ON assignment.id = grade.teaching_assignment_id
    JOIN public.students student ON student.lrn = grade.student_id
    WHERE distribution.id = p_distribution_id
      AND distribution.sender_teacher_id = auth.uid()
      AND distribution.recipient_teacher_id = section.adviser_teacher_id
      AND assignment.teacher_id = auth.uid()
      AND assignment.school_year_id = distribution.school_year_id
      AND student.section_id = distribution.section_id
      AND public.can_teacher_access_assignment_student(assignment.id, student.lrn)
  );
$$;

REVOKE ALL ON FUNCTION public.can_create_grade_distribution(bigint, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_attach_grade_to_distribution(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_grade_distribution(bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_attach_grade_to_distribution(bigint, bigint) TO authenticated;

DROP POLICY IF EXISTS distributions_insert_sender ON public.grade_distributions;
DROP POLICY IF EXISTS grade_distributions_sender_insert ON public.grade_distributions;
CREATE POLICY grade_distributions_sender_insert
ON public.grade_distributions
FOR INSERT TO authenticated
WITH CHECK (
  sender_teacher_id = auth.uid()
  AND public.can_create_grade_distribution(section_id, school_year_id, recipient_teacher_id)
);

DROP POLICY IF EXISTS distribution_items_insert_sender ON public.grade_distribution_items;
DROP POLICY IF EXISTS grade_distribution_items_sender_insert ON public.grade_distribution_items;
CREATE POLICY grade_distribution_items_sender_insert
ON public.grade_distribution_items
FOR INSERT TO authenticated
WITH CHECK (
  public.can_attach_grade_to_distribution(distribution_id, grade_id)
);

-- Send finalized subject grades to each student's own adviser, grouped by
-- advisory section. This avoids assuming the subject section is the advisory.
CREATE OR REPLACE FUNCTION public.send_assignment_grades_to_advisers(
  p_teaching_assignment_id bigint,
  p_grading_period text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender uuid := auth.uid();
  v_assignment public.teaching_assignments%ROWTYPE;
  v_target record;
  v_distribution_id bigint;
  v_distribution_count integer := 0;
  v_grade_count integer := 0;
  v_total_grades integer := 0;
  v_recipients text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = v_sender AND profile.role = 'teacher'
  ) THEN
    RAISE EXCEPTION 'Only teachers can distribute grades.';
  END IF;

  SELECT * INTO v_assignment
  FROM public.teaching_assignments assignment
  WHERE assignment.id = p_teaching_assignment_id
    AND assignment.teacher_id = v_sender;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected subject assignment does not belong to you.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.grades grade
    JOIN public.students student ON student.lrn = grade.student_id
    JOIN public.sections section ON section.id = student.section_id
    WHERE grade.teaching_assignment_id = p_teaching_assignment_id
      AND grade.grading_period = p_grading_period
      AND section.school_year_id = v_assignment.school_year_id
      AND public.can_teacher_access_assignment_student(p_teaching_assignment_id, student.lrn)
  ) THEN
    RAISE EXCEPTION 'No saved grades were found for this assignment and grading term.';
  END IF;

  FOR v_target IN
    SELECT student.section_id AS advisory_section_id,
      section.adviser_teacher_id AS recipient_id,
      recipient.full_name AS recipient_name,
      count(grade.id)::integer AS grade_count
    FROM public.grades grade
    JOIN public.students student ON student.lrn = grade.student_id
    JOIN public.sections section ON section.id = student.section_id
    LEFT JOIN public.profiles recipient ON recipient.id = section.adviser_teacher_id
    WHERE grade.teaching_assignment_id = p_teaching_assignment_id
      AND grade.grading_period = p_grading_period
      AND section.school_year_id = v_assignment.school_year_id
      AND public.can_teacher_access_assignment_student(p_teaching_assignment_id, student.lrn)
    GROUP BY student.section_id, section.adviser_teacher_id, recipient.full_name
  LOOP
    IF v_target.recipient_id IS NULL THEN
      RAISE EXCEPTION 'A student’s advisory section does not have an adviser assigned.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles profile
      WHERE profile.id = v_target.recipient_id AND profile.role = 'teacher'
    ) THEN
      RAISE EXCEPTION 'A student’s advisory section does not have a valid teacher assigned.';
    END IF;

    v_total_grades := v_total_grades + v_target.grade_count;
    IF v_target.recipient_id = v_sender THEN
      CONTINUE;
    END IF;

    INSERT INTO public.grade_distributions (
      sender_teacher_id, recipient_teacher_id, section_id, school_year_id, status, note
    ) VALUES (
      v_sender, v_target.recipient_id, v_target.advisory_section_id,
      v_assignment.school_year_id, 'sent', nullif(trim(p_note), '')
    ) RETURNING id INTO v_distribution_id;

    INSERT INTO public.grade_distribution_items (distribution_id, grade_id)
    SELECT v_distribution_id, grade.id
    FROM public.grades grade
    JOIN public.students student ON student.lrn = grade.student_id
    WHERE grade.teaching_assignment_id = p_teaching_assignment_id
      AND grade.grading_period = p_grading_period
      AND student.section_id = v_target.advisory_section_id
      AND public.can_teacher_access_assignment_student(p_teaching_assignment_id, student.lrn);

    v_distribution_count := v_distribution_count + 1;
    v_grade_count := v_grade_count + v_target.grade_count;
    v_recipients := array_append(v_recipients, coalesce(v_target.recipient_name, 'Section adviser'));
  END LOOP;

  RETURN jsonb_build_object(
    'distribution_count', v_distribution_count,
    'grade_count', v_grade_count,
    'recipients', v_recipients,
    'total_grade_count', v_total_grades
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_assignment_grades_to_advisers(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_assignment_grades_to_advisers(bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
