-- Production baseline, part 4 of 4: the photo bucket and who may use it.
--
-- One private bucket. Every object sits under its company's folder:
--   <company_id>/tasks/<task_id>/<uuid>.<ext>   photo proof of a finished task
--   <company_id>/plants/<uuid>.<ext>            the picture a plant was registered with
-- The app signs upload and download URLs with the user's own session, so these policies decide.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-photos',
  'task-photos',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "task-photos: members read their company's photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-photos'
    and (storage.foldername(name))[1] = (select private.company_id())::text
  );

-- Task proof: the worker the task is assigned to, or a boss. Plant pictures: any member.
-- The whole name must match, with a plain file name and an image extension, so nothing can
-- hide behind '..', an empty name or an odd file type.
create policy "task-photos: members upload into their company's folders" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-photos'
    and name ~ (
      '^' || (select private.company_id())::text
      || '/(plants|tasks/[0-9a-f-]{36})/[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$'
    )
    and (
      (storage.foldername(name))[2] = 'plants'
      or exists (
        select 1 from public.tasks t
        where t.id::text = (storage.foldername(name))[3]
          and t.company_id = (select private.company_id())
          and ((select private.is_boss()) or t.worker_id = (select private.worker_id()))
      )
    )
  );

create policy "task-photos: boss deletes" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-photos'
    and (storage.foldername(name))[1] = (select private.company_id())::text
    and (select private.is_boss())
  );
-- No update policy: a photo, once uploaded, is never overwritten.
