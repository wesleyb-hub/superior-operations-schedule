-- Import the October 14, 2026 Titan physical-inventory exports.
-- Adds Superior Walls foam and Box Culvert component materials without
-- altering any existing inventory row, event, alert, or reorder threshold.
-- Prepared by Scout for Wes Borgen

begin;

insert into public.inventory_categories(division_key,inventory_area,category,legal_entity,enabled,created_by) values
  ('walls','production','RM Foam','Superior Walls of North Dakota, LLC',true,'titan-import-2026-10-14'),
  ('boxes','production','RM Misc. Precast','Superior Precast Structures, LLC',true,'titan-import-2026-10-14')
on conflict (division_key,inventory_area,category) do nothing;

do $$
declare v_matches integer;
begin
  with candidates(division_key,inventory_area,titan_code) as (values
    ('walls'::text,'production'::text,'10 OXB'::text),
    ('walls','production','10ftlid'),
    ('walls','production','10ftstudinsulation'),
    ('walls','production','19 5/8 eps'),
    ('walls','production','19 5/8x36 1/2 x48 Footer'),
    ('walls','production','36 1/2 x 44 3/4 x 48 Bill'),
    ('walls','production','36 1/2x48x107 3/4 Studs'),
    ('walls','production','36 x 24 x 120 Billet'),
    ('walls','production','36 x 24 x 83 3/4 Billet'),
    ('walls','production','36 x 48 x 59 3/4 Billet'),
    ('walls','production','36 x 48 x 83 3/4 Billet'),
    ('walls','production','4ft lids 5 in'),
    ('walls','production','4ftstudinsulation'),
    ('walls','production','9ftlid'),
    ('walls','production','9ftstudinsulation'),
    ('walls','production','9OxB'),
    ('walls','production','bondbeam'),
    ('walls','production','EPS37x49x124'),
    ('walls','production','footerbeam'),
    ('walls','production','lidblt5'),
    ('boxes','production','6UA'),
    ('boxes','production','Box-Lox10'),
    ('boxes','production','Dog Bone 8Tx 8-3/4'),
    ('boxes','production','Dog Bone 8Tx6 3/4'),
    ('boxes','production','Sheet Metal 4x10'),
    ('boxes','production','Steps')
  )
  select count(*) into v_matches
  from candidates c
  join public.inventory_items i
    on i.division_key=c.division_key
   and i.inventory_area=c.inventory_area
   and lower(i.titan_code)=lower(c.titan_code);

  if v_matches<>0 then
    raise exception 'Titan import stopped: % candidate product code(s) already exist',v_matches;
  end if;
end $$;

insert into public.inventory_items(
  legal_entity,division_key,inventory_area,titan_code,description,category,
  unit,quantity,reorder_threshold,ordered,reorder_alert_open,updated_by
) values
  ('Superior Walls of North Dakota, LLC','walls','production','10 OXB','10 foot Ox Board','RM Foam','units',296,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','10ftlid','10 ft lid','RM Foam','units',564,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','10ftstudinsulation','10 ft stud insulation','RM Foam','units',393,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','19 5/8 eps','19 5/8 eps billet for bond beam and footer beam','RM Foam','units',10,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','19 5/8x36 1/2 x48 Footer','19 5/8x36 1/2 x48 Footer Billet','RM Foam','units',8,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 1/2 x 44 3/4 x 48 Bill','36 1/2 x 44 3/4 x 48 Billet','RM Foam','units',22,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 1/2x48x107 3/4 Studs','36 1/2x48x107 3/4 Studs','RM Foam','units',10,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 x 24 x 120 Billet','36 x 24 x 120 Billet','RM Foam','units',1,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 x 24 x 83 3/4 Billet','36 x 24 x 83 3/4 Billet','RM Foam','units',1,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 x 48 x 59 3/4 Billet','36 x 48 x 59 3/4 Billet','RM Foam','units',2,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','36 x 48 x 83 3/4 Billet','36 x 48 x 83 3/4 Billet','RM Foam','units',1,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','4ft lids 5 in','4 foot 5 inch foam lids','RM Foam','units',244,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','4ftstudinsulation','4 foot eps stud insulation','RM Foam','units',2691,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','9ftlid','9 foot lid','RM Foam','units',317,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','9ftstudinsulation','9 foot foot eps stud insulation','RM Foam','units',22,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','9OxB','9 foot Ox Board','RM Foam','units',199,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','bondbeam','Bond Beam Insulation','RM Foam','units',112,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','EPS37x49x124','EPS Block 37x49x124 1.5D','RM Foam','units',18,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','footerbeam','Footer Beam insulation','RM Foam','units',55,null,false,false,'titan-import-2026-10-14'),
  ('Superior Walls of North Dakota, LLC','walls','production','lidblt5','5" foam sheet 48"x124"','RM Foam','units',8,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','6UA','6" Utility Anchor','RM Misc. Precast','units',169,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','Box-Lox10','1.0x7.75x1.0 Box-Lox 10','RM Misc. Precast','units',1502,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','Dog Bone 8Tx 8-3/4','Dog Bone 8 Ton x 8-3/4','RM Misc. Precast','units',38,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','Dog Bone 8Tx6 3/4','Dog Bone 8 Ton 6-3/4"','RM Misc. Precast','units',959,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','Sheet Metal 4x10','4x10 Sheet Metal','RM Misc. Precast','units',4,null,false,false,'titan-import-2026-10-14'),
  ('Superior Precast Structures, LLC','boxes','production','Steps','PS12 Steps','RM Misc. Precast','units',100,null,false,false,'titan-import-2026-10-14');

do $$
begin
  if (select count(*) from public.inventory_items where division_key='walls' and inventory_area='production' and category='RM Foam')<>20 then
    raise exception 'Titan import verification failed: expected 20 foam products';
  end if;
  -- The 20 printed line items total 4,974; Titan's printed report total says 4,973.
  -- Preserve the item-level quantities and retain the one-unit discrepancy in project records.
  if (select sum(quantity) from public.inventory_items where division_key='walls' and inventory_area='production' and category='RM Foam')<>4974 then
    raise exception 'Titan import verification failed: expected foam line-item quantity 4974';
  end if;
  if (select count(*) from public.inventory_items where division_key='boxes' and inventory_area='production' and category='RM Misc. Precast')<>6 then
    raise exception 'Titan import verification failed: expected 6 box component products';
  end if;
  if (select sum(quantity) from public.inventory_items where division_key='boxes' and inventory_area='production' and category='RM Misc. Precast')<>2772 then
    raise exception 'Titan import verification failed: expected box component quantity 2772';
  end if;
end $$;

commit;
