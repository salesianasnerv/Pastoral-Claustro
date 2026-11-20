-- Pastoral · Tablero del equipo de Pastoral (20-11-2026). PEDIR VISTO BUENO A MARIÁN ANTES DE EJECUTAR.
-- Ejecutar en Supabase → SQL Editor, proyecto común «Acceso Microsoft 365». Se puede volver a ejecutar.
--
-- Qué crea
--   · pas_tab_cursos: los cursos del tablero (2026-2027, 2027-2028…). Solo se edita el más reciente;
--     los anteriores quedan para consultar. Se guardan el curso más reciente y los dos anteriores.
--   · pas_tab_tematicas, pas_tab_listas y pas_tab_tarjetas: temáticas → listas → tarjetas. Cada tarjeta
--     guarda dentro sus tareas (casillas) y sus enlaces.
--   · pas_tab_adjuntos: archivos de cada tarjeta (los archivos van al almacén privado «pas-tablero»).
--   · pas_tab_historial: quién creó, movió, editó o archivó cada tarjeta y cuándo (lo apunta la base de datos).
--   · Almacén privado «pas-tablero»: máximo 10 MB por archivo; PDF, imágenes y Office.
--
-- Quién entra (protección de datos)
--   · SOLO el equipo de Pastoral: personas activas del grupo «Pastoral» de Microsoft 365 (se sincroniza
--     cada noche) o con el permiso «pastoral_tablero» de la tabla común «permisos» (panel de Administración).
--   · El permiso general «todas» del panel NO da acceso al tablero.
--   · Nadie más puede leer nada, ni siquiera sabiendo la dirección: las reglas están en la base de datos.
--   · La lista de responsables solo devuelve nombre y correo de las personas del equipo.
--
-- Cursos
--   · «Empezar curso nuevo» (desde la web, a partir del 1 de septiembre) copia las temáticas y las listas del
--     curso anterior y, si se eligen, algunas tarjetas como plantilla (con las casillas sin marcar y sin fecha).
--   · Al empezar un curso nuevo se borra el curso más antiguo (se quedan el nuevo y los dos anteriores),
--     con sus tarjetas y adjuntos. Si nadie lo pulsa, se hace solo el 30 de septiembre a las 3:30 (hora UTC).
--   · Los archivos del almacén los borra la propia web (Supabase no deja borrarlos desde SQL) la próxima vez
--     que entra alguien del equipo.

begin;

-- 0. Ayudas
create or replace function pas_tab_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function pas_tab_es_equipo() returns boolean
language sql stable security definer set search_path = public as $$
  select pas_tab_email() <> '' and (
    exists (select 1 from personal p where lower(p.email::text) = pas_tab_email() and p.activo and 'pastoral' = any(p.grupos_entra))
    or exists (select 1 from permisos x where lower(x.email) = pas_tab_email() and x.web = 'pastoral_tablero'))
$$;

-- Curso escolar de una fecha: del 1 de septiembre al 31 de agosto
create or replace function pas_tab_curso_de(p_dia date) returns text
language sql immutable as $$
  select (extract(year from p_dia)::int - case when extract(month from p_dia) >= 9 then 0 else 1 end)::text
      || '-' || (extract(year from p_dia)::int + case when extract(month from p_dia) >= 9 then 1 else 0 end)::text
$$;

-- 1. Tablas
create table if not exists pas_tab_cursos (
  curso      text primary key check (curso ~ '^\d{4}-\d{4}$'),
  creado     timestamptz not null default now(),
  creado_por text not null default pas_tab_email()
);

create table if not exists pas_tab_tematicas (
  id          uuid primary key default gen_random_uuid(),
  curso       text not null references pas_tab_cursos(curso) on delete cascade on update cascade,
  nombre      text not null check (char_length(nombre) between 1 and 80),
  icono       text not null default '📌' check (char_length(icono) <= 16),
  color       text not null default '#009abb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  descripcion text not null default '' check (char_length(descripcion) <= 200),
  orden       double precision not null default 0,
  archivada   boolean not null default false,
  creada      timestamptz not null default now(),
  creada_por  text not null default pas_tab_email()
);
create index if not exists pas_tab_tematicas_curso on pas_tab_tematicas(curso);

create table if not exists pas_tab_listas (
  id          uuid primary key default gen_random_uuid(),
  tematica_id uuid not null references pas_tab_tematicas(id) on delete cascade,
  nombre      text not null check (char_length(nombre) between 1 and 60),
  color       text not null default '#009abb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden       double precision not null default 0,
  terminada   boolean not null default false     -- lista de cosas hechas: no cuenta como pendiente
);
create index if not exists pas_tab_listas_tematica on pas_tab_listas(tematica_id);

create table if not exists pas_tab_tarjetas (
  id              uuid primary key default gen_random_uuid(),
  lista_id        uuid not null references pas_tab_listas(id) on delete cascade,
  titulo          text not null check (char_length(titulo) between 1 and 200),
  descripcion     text not null default '' check (char_length(descripcion) <= 5000),
  responsable     text,                                        -- correo de una persona del equipo
  vence           date,
  etiquetas       text[] not null default '{}',
  tareas          jsonb not null default '[]' check (jsonb_typeof(tareas) = 'array'),   -- [{"t": "texto", "h": true}]
  enlaces         jsonb not null default '[]' check (jsonb_typeof(enlaces) = 'array'),  -- [{"n": "nombre", "u": "https://…"}]
  orden           double precision not null default 0,
  archivada       boolean not null default false,
  creada          timestamptz not null default now(),
  creada_por      text not null default pas_tab_email(),
  actualizada     timestamptz not null default now(),
  actualizada_por text not null default pas_tab_email()
);
create index if not exists pas_tab_tarjetas_lista on pas_tab_tarjetas(lista_id);

create table if not exists pas_tab_adjuntos (
  id         uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references pas_tab_tarjetas(id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 1 and 200),
  ruta       text not null unique,                             -- <tarjeta_id>/<código al azar>.<ext>
  tipo       text not null default '',
  tamano     int not null default 0,
  subido     timestamptz not null default now(),
  subido_por text not null default pas_tab_email()
);
create index if not exists pas_tab_adjuntos_tarjeta on pas_tab_adjuntos(tarjeta_id);

create table if not exists pas_tab_historial (
  id         bigint generated always as identity primary key,
  tarjeta_id uuid not null references pas_tab_tarjetas(id) on delete cascade,
  quien      text not null default pas_tab_email(),
  que        text not null,
  cuando     timestamptz not null default now()
);
create index if not exists pas_tab_historial_tarjeta on pas_tab_historial(tarjeta_id, cuando desc);

-- 2. ¿A qué curso pertenece cada cosa? ¿Se puede editar? (solo el curso más reciente)
create or replace function pas_tab_curso_editable() returns text
language sql stable security definer set search_path = public as $$ select max(curso) from pas_tab_cursos $$;

create or replace function pas_tab_curso_tematica(p uuid) returns text
language sql stable security definer set search_path = public as $$ select curso from pas_tab_tematicas where id = p $$;

create or replace function pas_tab_curso_lista(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select t.curso from pas_tab_listas l join pas_tab_tematicas t on t.id = l.tematica_id where l.id = p $$;

create or replace function pas_tab_curso_tarjeta(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select t.curso from pas_tab_tarjetas c join pas_tab_listas l on l.id = c.lista_id
    join pas_tab_tematicas t on t.id = l.tematica_id where c.id = p $$;

create or replace function pas_tab_puede_editar(p_curso text) returns boolean
language sql stable security definer set search_path = public as $$
  select pas_tab_es_equipo() and p_curso is not null and p_curso = pas_tab_curso_editable() $$;

-- 3. Reglas de acceso (RLS): leer = equipo; cambiar = equipo y solo en el curso más reciente
alter table pas_tab_cursos    enable row level security;
alter table pas_tab_tematicas enable row level security;
alter table pas_tab_listas    enable row level security;
alter table pas_tab_tarjetas  enable row level security;
alter table pas_tab_adjuntos  enable row level security;
alter table pas_tab_historial enable row level security;

revoke all on pas_tab_cursos, pas_tab_tematicas, pas_tab_listas, pas_tab_tarjetas, pas_tab_adjuntos, pas_tab_historial from anon;
grant select on pas_tab_cursos, pas_tab_historial to authenticated;
grant select, insert, update, delete on pas_tab_tematicas, pas_tab_listas, pas_tab_tarjetas to authenticated;
grant select, insert, delete on pas_tab_adjuntos to authenticated;

drop policy if exists pas_tab_cursos_leer on pas_tab_cursos;
create policy pas_tab_cursos_leer on pas_tab_cursos for select to authenticated using (pas_tab_es_equipo());

drop policy if exists pas_tab_tematicas_leer on pas_tab_tematicas;
create policy pas_tab_tematicas_leer on pas_tab_tematicas for select to authenticated using (pas_tab_es_equipo());
drop policy if exists pas_tab_tematicas_crear on pas_tab_tematicas;
create policy pas_tab_tematicas_crear on pas_tab_tematicas for insert to authenticated with check (pas_tab_puede_editar(curso));
drop policy if exists pas_tab_tematicas_cambiar on pas_tab_tematicas;
create policy pas_tab_tematicas_cambiar on pas_tab_tematicas for update to authenticated
  using (pas_tab_puede_editar(curso)) with check (pas_tab_puede_editar(curso));
drop policy if exists pas_tab_tematicas_borrar on pas_tab_tematicas;
create policy pas_tab_tematicas_borrar on pas_tab_tematicas for delete to authenticated using (pas_tab_puede_editar(curso));

drop policy if exists pas_tab_listas_leer on pas_tab_listas;
create policy pas_tab_listas_leer on pas_tab_listas for select to authenticated using (pas_tab_es_equipo());
drop policy if exists pas_tab_listas_crear on pas_tab_listas;
create policy pas_tab_listas_crear on pas_tab_listas for insert to authenticated with check (pas_tab_puede_editar(pas_tab_curso_tematica(tematica_id)));
drop policy if exists pas_tab_listas_cambiar on pas_tab_listas;
create policy pas_tab_listas_cambiar on pas_tab_listas for update to authenticated
  using (pas_tab_puede_editar(pas_tab_curso_tematica(tematica_id))) with check (pas_tab_puede_editar(pas_tab_curso_tematica(tematica_id)));
drop policy if exists pas_tab_listas_borrar on pas_tab_listas;
create policy pas_tab_listas_borrar on pas_tab_listas for delete to authenticated using (pas_tab_puede_editar(pas_tab_curso_tematica(tematica_id)));

drop policy if exists pas_tab_tarjetas_leer on pas_tab_tarjetas;
create policy pas_tab_tarjetas_leer on pas_tab_tarjetas for select to authenticated using (pas_tab_es_equipo());
drop policy if exists pas_tab_tarjetas_crear on pas_tab_tarjetas;
create policy pas_tab_tarjetas_crear on pas_tab_tarjetas for insert to authenticated with check (pas_tab_puede_editar(pas_tab_curso_lista(lista_id)));
drop policy if exists pas_tab_tarjetas_cambiar on pas_tab_tarjetas;
create policy pas_tab_tarjetas_cambiar on pas_tab_tarjetas for update to authenticated
  using (pas_tab_puede_editar(pas_tab_curso_lista(lista_id))) with check (pas_tab_puede_editar(pas_tab_curso_lista(lista_id)));
drop policy if exists pas_tab_tarjetas_borrar on pas_tab_tarjetas;
create policy pas_tab_tarjetas_borrar on pas_tab_tarjetas for delete to authenticated using (pas_tab_puede_editar(pas_tab_curso_lista(lista_id)));

drop policy if exists pas_tab_adjuntos_leer on pas_tab_adjuntos;
create policy pas_tab_adjuntos_leer on pas_tab_adjuntos for select to authenticated using (pas_tab_es_equipo());
drop policy if exists pas_tab_adjuntos_crear on pas_tab_adjuntos;
create policy pas_tab_adjuntos_crear on pas_tab_adjuntos for insert to authenticated
  with check (pas_tab_puede_editar(pas_tab_curso_tarjeta(tarjeta_id)) and ruta like tarjeta_id::text || '/%' and subido_por = pas_tab_email());
drop policy if exists pas_tab_adjuntos_borrar on pas_tab_adjuntos;
create policy pas_tab_adjuntos_borrar on pas_tab_adjuntos for delete to authenticated using (pas_tab_puede_editar(pas_tab_curso_tarjeta(tarjeta_id)));

drop policy if exists pas_tab_historial_leer on pas_tab_historial;
create policy pas_tab_historial_leer on pas_tab_historial for select to authenticated using (pas_tab_es_equipo());

-- 4. Historial automático y «quién cambió por última vez» (no se puede falsear desde la web)
create or replace function pas_tab_tarjetas_antes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.creada := now(); new.creada_por := pas_tab_email();
  else
    new.creada := old.creada; new.creada_por := old.creada_por;
  end if;
  if tg_op = 'INSERT' or (new.titulo, new.descripcion, new.responsable, new.vence, new.etiquetas, new.tareas, new.enlaces, new.lista_id, new.archivada)
       is distinct from (old.titulo, old.descripcion, old.responsable, old.vence, old.etiquetas, old.tareas, old.enlaces, old.lista_id, old.archivada) then
    new.actualizada := now(); new.actualizada_por := pas_tab_email();
  else
    new.actualizada := old.actualizada; new.actualizada_por := old.actualizada_por;
  end if;
  return new;
end $$;
drop trigger if exists pas_tab_tarjetas_antes on pas_tab_tarjetas;
create trigger pas_tab_tarjetas_antes before insert or update on pas_tab_tarjetas for each row execute function pas_tab_tarjetas_antes();

create or replace function pas_tab_tarjetas_historial() returns trigger
language plpgsql security definer set search_path = public as $$
declare q text := pas_tab_email();
begin
  if q = '' then q := 'automático'; end if;
  if tg_op = 'INSERT' then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (new.id, q, 'creó la tarjeta');
    return null;
  end if;
  if new.lista_id is distinct from old.lista_id then
    insert into pas_tab_historial (tarjeta_id, quien, que)
      values (new.id, q, 'la movió a «' || (select nombre from pas_tab_listas where id = new.lista_id) || '»');
  end if;
  if new.archivada is distinct from old.archivada then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (new.id, q, case when new.archivada then 'la archivó' else 'la recuperó' end);
  end if;
  if new.tareas is distinct from old.tareas then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (new.id, q, 'cambió las tareas');
  end if;
  if (new.titulo, new.descripcion, new.responsable, new.vence, new.etiquetas, new.enlaces)
     is distinct from (old.titulo, old.descripcion, old.responsable, old.vence, old.etiquetas, old.enlaces) then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (new.id, q, 'editó la tarjeta');
  end if;
  return null;
end $$;
drop trigger if exists pas_tab_tarjetas_historial on pas_tab_tarjetas;
create trigger pas_tab_tarjetas_historial after insert or update on pas_tab_tarjetas for each row execute function pas_tab_tarjetas_historial();

create or replace function pas_tab_adjuntos_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (new.tarjeta_id, pas_tab_email(), 'subió «' || new.nombre || '»');
  elsif exists (select 1 from pas_tab_tarjetas where id = old.tarjeta_id) then
    insert into pas_tab_historial (tarjeta_id, quien, que) values (old.tarjeta_id, coalesce(nullif(pas_tab_email(), ''), 'automático'), 'quitó «' || old.nombre || '»');
  end if;
  return null;
end $$;
drop trigger if exists pas_tab_adjuntos_historial on pas_tab_adjuntos;
create trigger pas_tab_adjuntos_historial after insert or delete on pas_tab_adjuntos for each row execute function pas_tab_adjuntos_historial();

-- 5. Funciones que usa la web
-- Quién soy (nombre y si soy del equipo)
create or replace function pas_tab_quien_soy() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', pas_tab_email(),
    'nombre', (select nombre from personal where lower(email::text) = pas_tab_email() limit 1),
    'equipo', pas_tab_es_equipo(),
    'curso_editable', case when pas_tab_es_equipo() then pas_tab_curso_editable() end,
    'curso_hoy', pas_tab_curso_de(current_date))
$$;

-- Personas del equipo (para elegir responsable): solo nombre y correo, solo para el equipo
create or replace function pas_tab_equipo() returns table (email text, nombre text)
language sql stable security definer set search_path = public as $$
  select lower(p.email::text), p.nombre::text from personal p
  where pas_tab_es_equipo() and p.activo
    and ('pastoral' = any(p.grupos_entra)
         or exists (select 1 from permisos x where lower(x.email) = lower(p.email::text) and x.web = 'pastoral_tablero'))
  order by p.nombre
$$;

-- Empezar curso nuevo: copia temáticas y listas del curso más reciente y, si se eligen, tarjetas como plantilla.
-- Borra los cursos más antiguos (se quedan el nuevo y los dos anteriores).
create or replace function pas_tab_nuevo_curso(p_plantillas uuid[] default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare
  v_nuevo text := pas_tab_curso_de(current_date);
  v_ant   text := pas_tab_curso_editable();
  t record; l record; v_t uuid; v_l uuid;
begin
  -- Desde la web, solo el equipo. El borrado automático (pg_cron) entra sin sesión como postgres.
  if not (pas_tab_es_equipo() or (auth.uid() is null and session_user = 'postgres')) then
    raise exception 'Solo el equipo de Pastoral puede empezar un curso nuevo';
  end if;
  if v_ant is not null and v_nuevo <= v_ant then
    raise exception 'El curso % ya existe', v_nuevo;
  end if;

  insert into pas_tab_cursos (curso, creado_por) values (v_nuevo, coalesce(nullif(pas_tab_email(), ''), 'automático'));

  if v_ant is not null then
    for t in select * from pas_tab_tematicas where curso = v_ant and not archivada order by orden loop
      insert into pas_tab_tematicas (curso, nombre, icono, color, descripcion, orden, creada_por)
        values (v_nuevo, t.nombre, t.icono, t.color, t.descripcion, t.orden, coalesce(nullif(pas_tab_email(), ''), 'automático'))
        returning id into v_t;
      for l in select * from pas_tab_listas where tematica_id = t.id order by orden loop
        insert into pas_tab_listas (tematica_id, nombre, color, orden, terminada)
          values (v_t, l.nombre, l.color, l.orden, l.terminada) returning id into v_l;
        -- Tarjetas elegidas como plantilla: sin fecha, sin responsable, casillas sin marcar, sin adjuntos
        insert into pas_tab_tarjetas (lista_id, titulo, descripcion, etiquetas, tareas, enlaces, orden)
          select v_l, c.titulo, c.descripcion, c.etiquetas,
                 coalesce((select jsonb_agg(jsonb_build_object('t', x ->> 't', 'h', false)) from jsonb_array_elements(c.tareas) x), '[]'),
                 c.enlaces, c.orden
          from pas_tab_tarjetas c where c.lista_id = l.id and c.id = any(coalesce(p_plantillas, '{}'));
      end loop;
    end loop;
  end if;

  -- Se quedan el curso nuevo y los dos anteriores
  delete from pas_tab_cursos where curso not in (select curso from pas_tab_cursos order by curso desc limit 3);
  return v_nuevo;
end $$;

-- 30 de septiembre: si nadie ha empezado el curso, se empieza solo (sin plantillas)
create or replace function pas_tab_curso_automatico() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(pas_tab_curso_editable(), '') < pas_tab_curso_de(current_date) then
    perform pas_tab_nuevo_curso('{}');
  end if;
end $$;

-- Archivos del almacén que ya no tienen tarjeta (de cursos borrados o tarjetas borradas): la web los borra
create or replace function pas_tab_archivos_huerfanos() returns setof text
language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
  where pas_tab_es_equipo() and o.bucket_id = 'pas-tablero'
    and o.created_at < now() - interval '1 hour'
    and not exists (select 1 from pas_tab_adjuntos a where a.ruta = o.name)
  limit 200
$$;

revoke execute on function pas_tab_quien_soy(), pas_tab_equipo(), pas_tab_nuevo_curso(uuid[]), pas_tab_curso_automatico(),
  pas_tab_archivos_huerfanos(), pas_tab_es_equipo(), pas_tab_puede_editar(text) from public, anon;
grant execute on function pas_tab_quien_soy(), pas_tab_equipo(), pas_tab_nuevo_curso(uuid[]),
  pas_tab_archivos_huerfanos(), pas_tab_es_equipo(), pas_tab_puede_editar(text) to authenticated;

-- 6. Almacén privado de adjuntos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pas-tablero', 'pas-tablero', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pas-tablero: leer" on storage.objects;
create policy "pas-tablero: leer" on storage.objects for select to authenticated
  using (bucket_id = 'pas-tablero' and pas_tab_es_equipo());
drop policy if exists "pas-tablero: subir" on storage.objects;
create policy "pas-tablero: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'pas-tablero' and name ~ '^[0-9a-f-]{36}/'
              and pas_tab_puede_editar(pas_tab_curso_tarjeta(split_part(name, '/', 1)::uuid)));
drop policy if exists "pas-tablero: borrar" on storage.objects;
create policy "pas-tablero: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'pas-tablero' and pas_tab_es_equipo());

-- 7. Cambios al momento en las pantallas del equipo (Realtime respeta las reglas de arriba)
do $$
declare t text;
begin
  foreach t in array array['pas_tab_tematicas', 'pas_tab_listas', 'pas_tab_tarjetas', 'pas_tab_adjuntos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- 8. Curso de partida y temáticas iniciales (solo si el tablero está vacío). Se pueden cambiar desde la web.
insert into pas_tab_cursos (curso, creado_por) values (pas_tab_curso_de(current_date), 'inicio') on conflict do nothing;

do $$
declare
  v_curso text := pas_tab_curso_de(current_date);
  t record; v_t uuid; i int := 0;
begin
  if exists (select 1 from pas_tab_tematicas) then return; end if;
  for t in select * from (values
      ('Adviento',                 '🎁', '#009abb', 'Campaña de Adviento y Navidad'),
      ('Navidad',                  '⭐', '#b4be00', 'Celebraciones y actividades de Navidad'),
      ('Bocadillo solidario',      '🥪', '#ee712a', 'Organización de cada bocadillo'),
      ('Celebraciones salesianas', '🕯️', '#7c5cc4', 'Don Bosco, Mazzarello, María Auxiliadora…'),
      ('Campañas solidarias',      '🤝', '#939b00', 'DOMUND, Manos Unidas, recogidas…'),
      ('Cuaresma y Pascua',        '✝️', '#007791', 'Celebraciones y Buenos días'),
      ('Reuniones del equipo',     '🗒️', '#5b6b7b', 'Órdenes del día y acuerdos')
    ) as x(nombre, icono, color, descripcion) loop
    i := i + 1;
    insert into pas_tab_tematicas (curso, nombre, icono, color, descripcion, orden, creada_por)
      values (v_curso, t.nombre, t.icono, t.color, t.descripcion, i, 'inicio') returning id into v_t;
    insert into pas_tab_listas (tematica_id, nombre, color, orden, terminada) values
      (v_t, 'Por hacer', '#ee712a', 1, false), (v_t, 'En marcha', '#009abb', 2, false), (v_t, 'Hecho', '#b4be00', 3, true);
  end loop;
end $$;

-- 9. Tarea programada: 30 de septiembre a las 3:30 (UTC)
select cron.unschedule('pas-tablero-curso') where exists (select 1 from cron.job where jobname = 'pas-tablero-curso');
select cron.schedule('pas-tablero-curso', '30 3 30 9 *', 'select pas_tab_curso_automatico()');

commit;

-- Comprobaciones
-- a) Quién entra hoy (tienen que salir las personas del grupo Pastoral y quien tenga el permiso «pastoral_tablero»)
select p.nombre, p.email from personal p
where p.activo and ('pastoral' = any(p.grupos_entra)
  or exists (select 1 from permisos x where lower(x.email) = lower(p.email::text) and x.web = 'pastoral_tablero'))
order by p.nombre;
-- b) Tiene que salir el almacén con public = false
-- select id, public, file_size_limit from storage.buckets where id = 'pas-tablero';
-- c) Temáticas creadas
-- select curso, nombre from pas_tab_tematicas order by orden;
