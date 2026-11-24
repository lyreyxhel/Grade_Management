-- Allow authenticated teachers to manage learner records only in their own
-- teaching sections or sections where they are the assigned adviser.
DROP POLICY IF EXISTS students_teacher_manage_assigned_sections ON public.students;

CREATE POLICY students_teacher_manage_assigned_sections
ON public.students
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1
    FROM public.sections AS section
    WHERE section.id = students.section_id
      AND (
        section.adviser_teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.teaching_assignments AS assignment
          WHERE assignment.teacher_id = auth.uid()
            AND assignment.section_id = section.id
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'teacher'
  )
  AND EXISTS (
    SELECT 1
    FROM public.sections AS section
    WHERE section.id = students.section_id
      AND (
        section.adviser_teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.teaching_assignments AS assignment
          WHERE assignment.teacher_id = auth.uid()
            AND assignment.section_id = section.id
        )
      )
  )
);
