-- Realtime: el panel del profesor escucha los cambios de pens.
-- Realtime aplica la política pens_select a cada suscriptor, así que el alumno solo recibe lo suyo.

alter publication supabase_realtime add table public.pens;
