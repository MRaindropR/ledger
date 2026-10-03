-- New tables only. The legacy sync_data table is not read or modified.
create table if not exists public.ledger_books (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 80), created_at timestamptz not null default now()
);
create table if not exists public.ledger_records (
 book_id uuid not null references public.ledger_books(id), kind text not null check(kind in ('account','transaction','settings')),
 id text not null check(length(id) between 1 and 128), value jsonb, deleted boolean not null default false,
 version bigint not null check(version>0), operation_id uuid not null,
 cursor bigint generated always as identity, updated_at timestamptz not null default now(),
 primary key(book_id,kind,id), unique(cursor)
);
create table if not exists public.ledger_receipts (
 book_id uuid not null references public.ledger_books(id), operation_id uuid not null,
 operation jsonb not null, response jsonb not null, primary key(book_id,operation_id)
);
alter table public.ledger_books enable row level security;
alter table public.ledger_records enable row level security;
alter table public.ledger_receipts enable row level security;
create policy ledger_books_read on public.ledger_books for select to authenticated using(owner_id=auth.uid());
create policy ledger_records_read on public.ledger_records for select to authenticated using(exists(select 1 from public.ledger_books b where b.id=book_id and b.owner_id=auth.uid()));
-- Writes occur exclusively through revision-checked RPCs.
revoke all on public.ledger_books,public.ledger_records,public.ledger_receipts from anon,authenticated;
grant select on public.ledger_books,public.ledger_records to authenticated;

create or replace function public.ledger_create(p_name text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare book uuid;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 insert into ledger_books(owner_id,name) values(auth.uid(),p_name) returning id into book;
 return book;
end $$;

create or replace function public.ledger_apply(p_book uuid,p_operations jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare op jsonb; prior ledger_records%rowtype; receipt ledger_receipts%rowtype;
 opid uuid; entity_id text; entity_kind text; base_version bigint; result jsonb; results jsonb:='[]'::jsonb;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 -- This lock serializes operations for a book and closes the create-row race.
 perform 1 from ledger_books where id=p_book and owner_id=auth.uid() for update;
 if not found then raise exception 'book_access_denied'; end if;
 if p_operations is null or jsonb_typeof(p_operations)<>'array' then raise exception 'invalid_batch'; end if;
 if jsonb_array_length(p_operations)>100 or octet_length(p_operations::text)>1048576 then raise exception 'invalid_batch'; end if;
 for op in select value from jsonb_array_elements(p_operations) loop
  opid:=(op->>'operationId')::uuid; entity_id:=op->>'id'; entity_kind:=op->>'kind'; base_version:=(op->>'baseVersion')::bigint;
  if opid is null or entity_id is null or length(entity_id) not between 1 and 128 or entity_kind is null or entity_kind not in ('account','transaction','settings') or base_version is null or base_version<0 or coalesce(jsonb_typeof(op->'deleted'),'null')<>'boolean' or (not (op->>'deleted')::boolean and coalesce(jsonb_typeof(op->'value'),'null')<>'object') then raise exception 'invalid_operation'; end if;
  select * into receipt from ledger_receipts where book_id=p_book and operation_id=opid;
  if found then
   if receipt.operation<>op then raise exception 'operation_id_reused'; end if;
   results:=results||jsonb_build_array(receipt.response);continue;
  end if;
  select * into prior from ledger_records where book_id=p_book and kind=entity_kind and id=entity_id;
  if coalesce(prior.version,0)<>base_version then
   result:=jsonb_build_object('status','conflict','remote',jsonb_build_object('kind',prior.kind,'id',prior.id,'value',prior.value,'deleted',prior.deleted,'version',prior.version,'operationId',prior.operation_id),'operationId',opid);
  else
   insert into ledger_records(book_id,kind,id,value,deleted,version,operation_id)
   values(p_book,entity_kind,entity_id,op->'value',(op->>'deleted')::boolean,base_version+1,opid)
   on conflict(book_id,kind,id) do update set value=excluded.value,deleted=excluded.deleted,version=excluded.version,operation_id=excluded.operation_id,cursor=default,updated_at=now()
   returning * into prior;
   result:=jsonb_build_object('status','accepted','remote',jsonb_build_object('kind',prior.kind,'id',prior.id,'value',prior.value,'deleted',prior.deleted,'version',prior.version,'operationId',prior.operation_id),'operationId',opid);
   insert into ledger_receipts(book_id,operation_id,operation,response) values(p_book,opid,op,result);
  end if;
  results:=results||jsonb_build_array(result);
 end loop;
 return results;
end $$;
revoke all on function public.ledger_create(text), public.ledger_apply(uuid,jsonb) from public,anon;
grant execute on function public.ledger_create(text), public.ledger_apply(uuid,jsonb) to authenticated;
