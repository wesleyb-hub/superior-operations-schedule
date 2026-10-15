-- Import the Superior Walls Install products from the October 14, 2026
-- Titan physical-inventory export supplied on October 15, 2026.
-- The export leaves every item Count cell blank. Its report-level total of 607
-- is therefore not assigned to individual products, and reorder minimums remain unset.
-- Prepared by Scout for Wes Borgen

begin;

insert into public.inventory_categories(
  division_key,inventory_area,category,legal_entity,enabled,created_by
) values (
  'walls','install','RM Install SW','Superior Walls of North Dakota, LLC',true,
  'titan-install-import-2026-10-15'
)
on conflict (division_key,inventory_area,category) do nothing;

do $$
declare v_matches integer;
begin
  with candidates(titan_code) as (values
    ('1/2-3'::text),('1/2x1-1/2'),('1/2x2'),('1/2x2-1/2'),('1/2x6'),
    ('104pc'),('105finstall'),('105hinstall'),('105install'),('17FSwN'),
    ('2.5x6FAwS'),('4x6x5/16AwS'),('6intitan'),('APDBP'),('AT1/2'),
    ('IC'),('ICwS'),('SWA Sealant')
  )
  select count(*) into v_matches
  from candidates c
  join public.inventory_items i
    on i.division_key='walls'
   and i.inventory_area='install'
   and lower(i.titan_code)=lower(c.titan_code);

  if v_matches<>0 then
    raise exception 'Titan Install import stopped: % candidate product code(s) already exist',v_matches;
  end if;
end $$;

insert into public.inventory_items(
  legal_entity,division_key,inventory_area,titan_code,description,category,
  unit,quantity,reorder_threshold,ordered,reorder_alert_open,updated_by
) values
  ('Superior Walls of North Dakota, LLC','walls','install','1/2-3','1/2-3 install bolt','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','1/2x1-1/2','Install Bolt 1/2"x1-1/2"','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','1/2x2','Install Bolt 1/2x2"','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','1/2x2-1/2','Install Bolt 1/2"x2-1/2"','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','1/2x6','Install Bolt 1/2"x6"','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','104pc','104 pc install','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','105finstall','105 F install','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','105hinstall','105 h install','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','105install','105 pc install','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','17FSwN','17 inch framing straps w/Nails','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','2.5x6FAwS','Install-2.5x6 formed Angle w/Slot','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','4x6x5/16AwS','Install-4x6x5/16 Angle w/Slot','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','6intitan','6 inch concrete anchor','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','APDBP','Install- Alternative Panel Divider Bolt Plate','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','AT1/2','Install Bolt- All Thread 1/2"','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','IC','I/C Install Clip-Galv','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','ICwS','Install- Inside Corner w/Slot','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15'),
  ('Superior Walls of North Dakota, LLC','walls','install','SWA Sealant','SWA Sealant 10.1 oz-tubes','RM Install SW','units',null,null,false,false,'titan-install-import-2026-10-15');

do $$
begin
  if (select count(*) from public.inventory_items where division_key='walls' and inventory_area='install' and category='RM Install SW')<>18 then
    raise exception 'Titan Install import verification failed: expected 18 products';
  end if;
  if (select count(*) from public.inventory_items where division_key='walls' and inventory_area='install' and category='RM Install SW' and quantity is not null)<>0 then
    raise exception 'Titan Install import verification failed: item counts must remain unrecorded';
  end if;
end $$;

commit;
