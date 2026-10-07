-- Staff follow-up on the admin Progression pages: whether a customer has been
-- contacted, plus a free-text note. One row per customer, keyed by the same
-- customer key the insights function uses (email:…, phone:… or appointment:…),
-- because most Acuity customers have no portal account.
CREATE TABLE public.customer_followups (
  customer_key TEXT PRIMARY KEY
    CHECK (customer_key ~ '^(email|phone|appointment):.+' AND char_length(customer_key) <= 320),
  contacted BOOLEAN NOT NULL DEFAULT false,
  contacted_at TIMESTAMP WITH TIME ZONE,
  contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contacted_by_email TEXT,
  note TEXT CHECK (char_length(note) <= 2000),
  note_updated_at TIMESTAMP WITH TIME ZONE,
  note_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note_updated_by_email TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Who/when columns are stamped here from the caller's session, never taken
-- from the request, and only change when the value they describe changes.
CREATE OR REPLACE FUNCTION public.stamp_customer_followup()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contacted_changed BOOLEAN;
  note_changed BOOLEAN;
BEGIN
  NEW.note := NULLIF(btrim(NEW.note), '');
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' THEN
    contacted_changed := NEW.contacted;
    note_changed := NEW.note IS NOT NULL;
  ELSE
    contacted_changed := NEW.contacted IS DISTINCT FROM OLD.contacted;
    note_changed := NEW.note IS DISTINCT FROM OLD.note;
  END IF;

  IF contacted_changed AND NEW.contacted THEN
    NEW.contacted_at := now();
    NEW.contacted_by := auth.uid();
    NEW.contacted_by_email := auth.jwt() ->> 'email';
  ELSIF contacted_changed OR TG_OP = 'INSERT' THEN
    NEW.contacted_at := NULL;
    NEW.contacted_by := NULL;
    NEW.contacted_by_email := NULL;
  ELSE
    NEW.contacted_at := OLD.contacted_at;
    NEW.contacted_by := OLD.contacted_by;
    NEW.contacted_by_email := OLD.contacted_by_email;
  END IF;

  IF note_changed THEN
    NEW.note_updated_at := now();
    NEW.note_updated_by := auth.uid();
    NEW.note_updated_by_email := auth.jwt() ->> 'email';
  ELSIF TG_OP = 'INSERT' THEN
    NEW.note_updated_at := NULL;
    NEW.note_updated_by := NULL;
    NEW.note_updated_by_email := NULL;
  ELSE
    NEW.note_updated_at := OLD.note_updated_at;
    NEW.note_updated_by := OLD.note_updated_by;
    NEW.note_updated_by_email := OLD.note_updated_by_email;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER stamp_customer_followup
  BEFORE INSERT OR UPDATE ON public.customer_followups
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_customer_followup();

-- Enable Row Level Security
ALTER TABLE public.customer_followups ENABLE ROW LEVEL SECURITY;

-- Admins only. No delete policy: clearing a note or unticking "contacted"
-- is an update, so rows are never removed from the browser.
CREATE POLICY "Admins can view customer follow-ups"
ON public.customer_followups
FOR SELECT
USING (public.has_role('admin'));

CREATE POLICY "Admins can add customer follow-ups"
ON public.customer_followups
FOR INSERT
WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update customer follow-ups"
ON public.customer_followups
FOR UPDATE
USING (public.has_role('admin'))
WITH CHECK (public.has_role('admin'));
