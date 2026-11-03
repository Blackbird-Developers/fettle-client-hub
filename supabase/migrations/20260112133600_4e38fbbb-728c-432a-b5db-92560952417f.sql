-- Intentionally empty.
--
-- This migration used to create an app_role enum, a second user_roles table
-- and has_role(uuid, app_role). It was never applied on live, and it can't
-- be: 20260112100000_admin_roles.sql already creates public.user_roles
-- (role TEXT) and has_role(check_role TEXT), which is what live and the app
-- use. It is kept as a no-op so the version history stays the same everywhere.
SELECT 1;
