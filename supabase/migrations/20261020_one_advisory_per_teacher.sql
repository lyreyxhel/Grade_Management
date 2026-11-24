-- Enforce at most one advisory section per teacher in each school year.
-- Teaching assignments remain many-to-many through teaching_assignments.
CREATE UNIQUE INDEX IF NOT EXISTS sections_one_advisory_per_teacher_per_school_year
  ON public.sections (adviser_teacher_id, school_year_id)
  WHERE adviser_teacher_id IS NOT NULL;
