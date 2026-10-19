-- Allow multiple standalone Installation catch-up cards on the same date.
-- Each card remains individually versioned; existing cards and tasks are preserved.
-- Prepared by Scout for Wes Borgen

drop index if exists public.walls_installation_one_active_day_card_idx;
