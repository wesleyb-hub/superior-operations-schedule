# Superior Operations Architecture

Prepared by Scout for Wes Borgen

## Current production design

- `schedule_meta` is the concurrency and source-timestamp record.
- `schedule_records` stores one row per wall job, precast project, billing record, delivery load, and history item.
- `schedule_milestones` provides queryable evidence status for each Superior Walls planning milestone.
- `schedule_change_log` is append-only and supplies the dashboard history.
- `schedule_revision_backups` automatically preserves every successfully saved revision, with a fingerprint and restore function.
- Database functions assemble a compatible dashboard snapshot and atomically validate and save changes.
- All company-domain users may read. Only approved application-role rows may save or restore.

## Operating gates

- A new or changed Superior Walls Production Date requires `Approved for Production` to be Complete.
- Wall completion requires the same production-release evidence.
- Precast project completion requires every listed product to be QC released.
- Billed status requires an invoice number and invoice date.
- Delivery must move through Loaded before Delivered.

The database enforces these rules. The browser cannot bypass them.

## Backup and recovery

Every successful save writes a complete revision backup in the same database transaction. `list_schedule_backups()` verifies the catalog. `restore_schedule_revision()` creates a new revision from a selected backup instead of overwriting history. Supabase platform backups remain an additional infrastructure layer and should be enabled according to the project plan and retention requirements.

## Read-only assistant

The embedded Operations Assistant answers common schedule, exception, delivery, QC, and billing questions from the authenticated in-memory snapshot. It cannot mutate the schedule. Its answers show the live revision and source timestamp. A later LLM service can be added behind a server-side function without changing this read-only boundary.
