-- DISPOSABLE DB ONLY. Retained accounting rows survive actual snapshot persistence.
-- The frontend owns reconciliation; SQL must not rewrite retained invoice evidence.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
do $$
declare snap jsonb; payload jsonb; invoices jsonb; actual jsonb; source_state text; v_collection text;
begin
 invoices:='[
  {"key":"wall:TEST-INVOICE-WALL","division":"walls","project":"Synthetic billed wall","customer":"Synthetic customer","billableDate":"2026-10-20","billableMonth":"2026-10","qty":120,"unit":"LF","status":"Billed","invoice":"TEST-INV-WALL","invoiceDate":"2026-10-21","notes":"Retain accounting notes"},
  {"key":"precast:TEST-INVOICE-PRECAST","division":"boxes","project":"Synthetic billed precast","customer":"Synthetic customer","billableDate":"2026-10-20","billableMonth":"2026-10","qty":2,"unit":"pcs","status":"Billed","invoice":"TEST-INV-PRECAST","invoiceDate":"2026-10-21","notes":"Retain accounting notes"},
  {"key":"wall:TEST-INVOICE-HOLD","division":"walls","project":"Synthetic invoice hold","customer":"Synthetic customer","billableDate":"2026-10-20","billableMonth":"2026-10","qty":30,"unit":"LF","status":"Hold","invoice":"TEST-INV-HOLD","invoiceDate":"","notes":"Retain hold and invoice"},
  {"key":"precast:TEST-INVOICE-DATED","division":"boxes","project":"Synthetic dated invoice","customer":"Synthetic customer","billableDate":"2026-10-20","billableMonth":"2026-10","qty":1,"unit":"pcs","status":"Ready to Bill","invoice":"","invoiceDate":"2026-10-21","notes":"Retain dated evidence"}
 ]'::jsonb;
 -- Establish actual completed source records before correcting or deleting them.
 perform test_workflow.patch('walls','TEST-INVOICE-WALL','{"job":"TEST invoice wall","lf":120,"planReview":{"stages":{"approvedProduction":{"status":"Complete"}}},"completedDate":"2026-10-20","completedMonth":"2026-10"}');
 perform test_workflow.patch('walls','TEST-INVOICE-HOLD','{"job":"TEST invoice hold","lf":30,"planReview":{"stages":{"approvedProduction":{"status":"Complete"}}},"completedDate":"2026-10-20","completedMonth":"2026-10"}');
 perform test_workflow.patch('jobs','TEST-INVOICE-PRECAST','{"job":"TEST invoice precast","division":"boxes","qty":2,"completedDate":"2026-10-20","completedMonth":"2026-10"}');
 perform test_workflow.patch('jobs','TEST-INVOICE-DATED','{"job":"TEST invoice dated","division":"boxes","qty":1,"completedDate":"2026-10-20","completedMonth":"2026-10"}');
 snap:=public.get_schedule_snapshot();payload:=snap#>'{payload,data}';
 payload:=jsonb_set(payload,'{billing}',coalesce(payload->'billing','[]')||invoices);
 perform public.save_schedule_snapshot((snap->>'revision')::bigint,payload,'TEST retained invoices');
 foreach source_state in array array['completion removed','source removed'] loop
  snap:=public.get_schedule_snapshot();payload:=snap#>'{payload,data}';
  foreach v_collection in array array['walls','jobs'] loop
   if source_state='completion removed' then
    select jsonb_agg(case when value->>'id' like 'TEST-INVOICE-%' then value||'{"completedDate":"","completedMonth":""}'::jsonb else value end)
     into actual from jsonb_array_elements(payload->v_collection);
   else
    select coalesce(jsonb_agg(value),'[]') into actual from jsonb_array_elements(payload->v_collection) where value->>'id' not like 'TEST-INVOICE-%';
   end if;
   payload:=jsonb_set(payload,array[v_collection],actual);
  end loop;
  perform public.save_schedule_snapshot((snap->>'revision')::bigint,payload,'TEST source correction, preserve accounting');
  snap:=public.get_schedule_snapshot();
  select jsonb_agg(value order by value->>'key') into actual from jsonb_array_elements(snap#>'{payload,data,billing}') where value->>'key' like '%:TEST-INVOICE-%';
  perform test_workflow.assert(actual=(select jsonb_agg(value order by value->>'key') from jsonb_array_elements(invoices)),'billing evidence round-trips unchanged after '||source_state);
  perform test_workflow.assert((select count(*)=4 from public.schedule_records where collection='billing' and record_id like '%:TEST-INVOICE-%'),'four retained invoice keys persist after '||source_state);
 end loop;
end $$;
rollback;
