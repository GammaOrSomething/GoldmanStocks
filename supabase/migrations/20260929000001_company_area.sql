-- Where the company is based. Forecasts are per site, so a new company with no sites had no
-- weather at all; until it adds one, the dashboard shows the forecast for this place, and the
-- maps start here. Coordinates are set together or not at all; the city is only a label.
alter table public.companies
  add column city text not null default '' check (length(city) <= 200),
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint companies_area_complete check ((lat is null) = (lng is null));

-- The update policy already limits this to the company's own boss; the column grant decides
-- which columns they may touch (see 20260923000003_rls.sql).
grant update (city, lat, lng) on public.companies to authenticated;
