-- Replace recursive grade distribution policies with SECURITY DEFINER checks.
-- This keeps sender/recipient access while avoiding policy-to-policy recursion.

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('grade_distributions', 'grade_distribution_items')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.policyname, policy_row.tablename);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.can_access_grade_distribution(p_distribution_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.grade_distributions AS distribution
    WHERE distribution.id = p_distribution_id
      AND (
        distribution.sender_teacher_id = auth.uid()
        OR distribution.recipient_teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.profiles AS profile
          WHERE profile.id = auth.uid() AND profile.role = 'admin'
        )
      )
  );
$$;

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
      SELECT 1 FROM public.profiles AS sender
      WHERE sender.id = auth.uid() AND sender.role = 'teacher'
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS recipient
      WHERE recipient.id = p_recipient_teacher_id AND recipient.role = 'teacher'
    )
    AND EXISTS (
      SELECT 1 FROM public.teaching_assignments AS assignment
      WHERE assignment.teacher_id = auth.uid()
        AND assignment.section_id = p_section_id
        AND assignment.school_year_id = p_school_year_id
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
    FROM public.grade_distributions AS distribution
    JOIN public.grades AS grade ON grade.id = p_grade_id
    JOIN public.teaching_assignments AS assignment
      ON assignment.id = grade.teaching_assignment_id
    JOIN public.students AS student ON student.lrn = grade.student_id
    WHERE distribution.id = p_distribution_id
      AND distribution.sender_teacher_id = auth.uid()
      AND assignment.teacher_id = auth.uid()
      AND assignment.section_id = distribution.section_id
      AND assignment.school_year_id = distribution.school_year_id
      AND student.section_id = distribution.section_id
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_grade_distribution(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_grade_distribution(bigint, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_attach_grade_to_distribution(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_grade_distribution(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_grade_distribution(bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_attach_grade_to_distribution(bigint, bigint) TO authenticated;

ALTER TABLE public.grade_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_distribution_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY grade_distributions_participant_read
ON public.grade_distributions
FOR SELECT
TO authenticated
USING (public.can_access_grade_distribution(id));

CREATE POLICY grade_distributions_sender_insert
ON public.grade_distributions
FOR INSERT
TO authenticated
WITH CHECK (
  sender_teacher_id = auth.uid()
  AND public.can_create_grade_distribution(section_id, school_year_id, recipient_teacher_id)
);

CREATE POLICY grade_distribution_items_participant_read
ON public.grade_distribution_items
FOR SELECT
TO authenticated
USING (public.can_access_grade_distribution(distribution_id));

CREATE POLICY grade_distribution_items_sender_insert
ON public.grade_distribution_items
FOR INSERT
TO authenticated
WITH CHECK (public.can_attach_grade_to_distribution(distribution_id, grade_id));
