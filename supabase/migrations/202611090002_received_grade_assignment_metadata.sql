-- Advisers need the subject metadata attached to grades they received so
-- advisory reports can display each shared subject grade.

CREATE OR REPLACE FUNCTION public.can_view_distributed_assignment(
  p_teaching_assignment_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.grades grade
    JOIN public.grade_distribution_items item ON item.grade_id = grade.id
    JOIN public.grade_distributions distribution ON distribution.id = item.distribution_id
    WHERE grade.teaching_assignment_id = p_teaching_assignment_id
      AND distribution.recipient_teacher_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_distributed_assignment(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_distributed_assignment(bigint) TO authenticated;

DROP POLICY IF EXISTS assignments_select_own ON public.teaching_assignments;
CREATE POLICY assignments_select_own
ON public.teaching_assignments
FOR SELECT TO authenticated
USING (
  teacher_id = auth.uid()
  OR public.can_view_distributed_assignment(id)
);

DROP POLICY IF EXISTS sections_select_authorized ON public.sections;
CREATE POLICY sections_select_authorized
ON public.sections
FOR SELECT TO authenticated
USING (
  adviser_teacher_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.teaching_assignments assignment
    WHERE assignment.section_id = sections.id
      AND assignment.teacher_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.grade_distributions distribution
    WHERE distribution.section_id = sections.id
      AND (distribution.sender_teacher_id = auth.uid() OR distribution.recipient_teacher_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.teaching_assignments assignment
    WHERE assignment.section_id = sections.id
      AND public.can_view_distributed_assignment(assignment.id)
  )
);

DROP POLICY IF EXISTS subjects_select_assigned ON public.subjects;
CREATE POLICY subjects_select_assigned
ON public.subjects
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teaching_assignments assignment
    WHERE assignment.subject_id = subjects.id
      AND assignment.teacher_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.teaching_assignments assignment
    WHERE assignment.subject_id = subjects.id
      AND public.can_view_distributed_assignment(assignment.id)
  )
);

NOTIFY pgrst, 'reload schema';
