-- Teachers may view learners in their subject sections for grading, but only
-- the section adviser may add, edit, move, or delete learner records.

DROP POLICY IF EXISTS students_teacher_manage_assigned_sections ON public.students;
DROP POLICY IF EXISTS students_teacher_read_assigned_or_advisory_sections ON public.students;
DROP POLICY IF EXISTS students_adviser_insert_roster ON public.students;
DROP POLICY IF EXISTS students_adviser_update_roster ON public.students;
DROP POLICY IF EXISTS students_adviser_delete_roster ON public.students;

CREATE POLICY students_teacher_read_assigned_or_advisory_sections
ON public.students
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1
    FROM public.sections AS section
    WHERE section.id = students.section_id
      AND (
        section.adviser_teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.teaching_assignments AS assignment
          WHERE assignment.teacher_id = auth.uid()
            AND assignment.section_id = section.id
        )
      )
  )
);

CREATE POLICY students_adviser_insert_roster
ON public.students
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1 FROM public.sections AS section
    WHERE section.id = students.section_id
      AND section.adviser_teacher_id = auth.uid()
  )
);

CREATE POLICY students_adviser_update_roster
ON public.students
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1 FROM public.sections AS section
    WHERE section.id = students.section_id
      AND section.adviser_teacher_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1 FROM public.sections AS section
    WHERE section.id = students.section_id
      AND section.adviser_teacher_id = auth.uid()
  )
);

CREATE POLICY students_adviser_delete_roster
ON public.students
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1 FROM public.sections AS section
    WHERE section.id = students.section_id
      AND section.adviser_teacher_id = auth.uid()
  )
);
