-- =====================================================================
-- Ello · Gestão do Time — estrutura do banco no Supabase
-- Cole TUDO no Supabase → SQL Editor → New query → Run.
-- Pode rodar mais de uma vez sem problema.
-- =====================================================================

-- 1) Uma tabela guarda todos os "documentos" da plataforma
--    (col = coleção, ex.: shared_data ; id = nome do documento, ex.: feedbacks)
create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists docs_col_idx on public.docs (col);

-- 2) Junta objetos "em profundidade" (como o merge do Firebase): mapas se somam, o resto é substituído
create or replace function public.jsonb_merge_deep(a jsonb, b jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; r jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then
    return b;
  end if;
  r := a;
  for k in select jsonb_object_keys(b) loop
    if r ? k then r := jsonb_set(r, array[k], public.jsonb_merge_deep(r -> k, b -> k));
    else r := r || jsonb_build_object(k, b -> k);
    end if;
  end loop;
  return r;
end $$;

-- 3) Gravação atômica com merge (vários usuários salvando ao mesmo tempo não se atropelam)
create or replace function public.doc_merge(p_col text, p_id text, p_data jsonb)
returns void language sql security invoker as $$
  insert into public.docs as d (col, id, data, updated_at)
  values (p_col, p_id, coalesce(p_data, '{}'::jsonb), now())
  on conflict (col, id) do update
    set data = public.jsonb_merge_deep(d.data, excluded.data), updated_at = now();
$$;

-- 4) Segurança: só quem fez login na plataforma lê e grava
alter table public.docs enable row level security;
drop policy if exists "logados leem"     on public.docs;
drop policy if exists "logados inserem"  on public.docs;
drop policy if exists "logados alteram"  on public.docs;
drop policy if exists "logados apagam"   on public.docs;
create policy "logados leem"    on public.docs for select to authenticated using (true);
create policy "logados inserem" on public.docs for insert to authenticated with check (true);
create policy "logados alteram" on public.docs for update to authenticated using (true) with check (true);
create policy "logados apagam"  on public.docs for delete to authenticated using (true);
grant select, insert, update, delete on public.docs to authenticated;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;
revoke all on public.docs from anon;

-- 5) Tempo real (a tela atualiza sozinha quando alguém salva)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

select 'Pronto! Estrutura criada.' as resultado;
