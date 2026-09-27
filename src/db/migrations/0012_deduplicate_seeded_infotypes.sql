-- Custom SQL migration file, put your code below! --

-- Data cleanup, written by hand.
--
-- Three repeating infotypes — addresses, communication and family members —
-- have no unique index, unlike every time-sliced infotype, because HR is
-- free to record more than one of the same type (two phone numbers, two
-- children). The seed script assumed `.onConflictDoNothing()` would guard
-- them anyway; without a matching unique index it is a silent no-op, so
-- every re-run of `npm run db:seed` against an already-seeded database (this
-- one has been re-seeded after phases 9 through 13) inserted a fresh,
-- byte-for-byte duplicate of each seeded row. `src/db/seed/personnel.ts` now
-- checks before inserting, so this can only happen again by re-introducing
-- that mistake (see HANDOVER.md §7.2).
--
-- This collapses each group of duplicates — same employee, same content,
-- same validity window, differing only in `id` and `created_at` — down to
-- the one with the lowest id. It touches only genuine duplicates: two
-- legitimately different rows (a second real address, a second child) are
-- never grouped together, because their content differs.
DELETE FROM `pa_it0006_address` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `pa_it0006_address`
  GROUP BY `employee_id`, `address_type`, `line`, `city`, `state`, `postal_code`, `country`, `valid_from`, `valid_to`, `seq`
);--> statement-breakpoint
DELETE FROM `pa_it0105_communication` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `pa_it0105_communication`
  GROUP BY `employee_id`, `comm_type`, `value`, `valid_from`, `valid_to`, `seq`
);--> statement-breakpoint
DELETE FROM `pa_it0021_family_member` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `pa_it0021_family_member`
  GROUP BY `employee_id`, `relationship`, `name`, `date_of_birth`, `valid_from`, `valid_to`, `seq`
);
