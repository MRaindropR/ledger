-- Read-only deployment evidence. No ledger rows, emails, keys or sessions.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
 has_table_privilege('anon', c.oid, 'SELECT') as anon_can_read,
 has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read,
 has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_can_insert,
 has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_can_update,
 has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_can_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ledger_books','ledger_records','ledger_receipts')
order by c.relname;

select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname='public' and tablename in ('ledger_books','ledger_records','ledger_receipts')
order by tablename, policyname;

select p.proname as function_name, p.prosecdef as security_definer,
 p.proconfig as fixed_config,
 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
 has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ledger_create','ledger_apply')
order by p.proname;
