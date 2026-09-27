-- Address search goes through our server to Nominatim, whose usage policy allows about one
-- request a second and bans abusive addresses. Signup is open, so without a cap one company
-- could get our server banned and break address search for every company. Metered like the
-- AI features; a boss placing sites needs a handful a day.
insert into private.usage_limits (kind, daily_limit) values ('geocode', 300);
