-- 0003_plant_coordinates.sql — real GPS positions for plants and areas.
-- Nullable on purpose: plants without them are drawn from their site-plan x/y around the site
-- (src/lib/geo.ts), so they keep following the site if it's moved on the map.
alter table plants
  add column if not exists lat double precision,
  add column if not exists lng double precision;
