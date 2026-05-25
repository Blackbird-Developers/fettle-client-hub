-- Fix profile creation so Google OAuth signups get a first_name and last_name.
-- Google sends given_name / family_name / name; the previous trigger only
-- looked for first_name / last_name and so produced null-name profiles,
-- which made sync-acuity-packages silently skip Acuity cert creation.

CREATE OR REPLACE FUNCTION public.extract_user_names(meta JSONB)
RETURNS TABLE(first_name TEXT, last_name TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  fn TEXT;
  ln TEXT;
  full_name TEXT;
  space_pos INT;
BEGIN
  fn := meta ->> 'first_name';
  ln := meta ->> 'last_name';

  IF fn IS NULL THEN fn := meta ->> 'given_name'; END IF;
  IF ln IS NULL THEN ln := meta ->> 'family_name'; END IF;

  IF fn IS NULL OR ln IS NULL THEN
    full_name := COALESCE(meta ->> 'name', meta ->> 'full_name');
    IF full_name IS NOT NULL AND length(trim(full_name)) > 0 THEN
      full_name := trim(full_name);
      space_pos := position(' ' IN full_name);

      IF fn IS NULL THEN
        IF space_pos > 0 THEN
          fn := substring(full_name FROM 1 FOR space_pos - 1);
        ELSE
          fn := full_name;
        END IF;
      END IF;

      IF ln IS NULL AND space_pos > 0 THEN
        ln := trim(substring(full_name FROM space_pos + 1));
        IF length(ln) = 0 THEN ln := NULL; END IF;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT fn, ln;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  names RECORD;
BEGIN
  SELECT * INTO names FROM public.extract_user_names(NEW.raw_user_meta_data);

  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email, names.first_name, names.last_name)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET first_name = COALESCE(p.first_name, names.first_name),
    last_name  = COALESCE(p.last_name,  names.last_name)
FROM auth.users u,
     LATERAL public.extract_user_names(u.raw_user_meta_data) AS names
WHERE u.id = p.user_id
  AND (p.first_name IS NULL OR p.last_name IS NULL);
