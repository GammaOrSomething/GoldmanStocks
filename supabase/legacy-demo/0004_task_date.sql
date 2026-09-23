-- 0004_task_date.sql — a real calendar date for a task, so the schedule can show a month.
--
-- Nullable on purpose. A task has always been a recurring weekly template (`day` 0-6 + `start`
-- hour), and every seeded task still is: null here means "every week on `day`", which is what the
-- day and week views and the worker app read. A task with a date is a one-off on that date, and
-- `day` is kept in step with it (derived from the date on write) so the weekday-based views need
-- no change.
alter table tasks
  add column if not exists date date;

-- The month view queries a window of dates; the day/week views still go through `day`.
create index if not exists tasks_date_idx on tasks (date);
