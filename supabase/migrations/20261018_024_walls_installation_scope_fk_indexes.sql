-- Cover the two new foreign keys that do not lead an existing primary-key/index.
create index if not exists walls_installation_activity_assignments_load_assignment_idx
  on public.walls_installation_activity_assignments(load_record_id,assignment_id);
create index if not exists walls_installation_activity_assignments_linked_by_idx
  on public.walls_installation_activity_assignments(linked_by_user_id);
