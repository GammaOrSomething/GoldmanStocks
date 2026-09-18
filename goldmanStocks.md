goldmanStocks
One-liner
The AI assistant that plans every worker's day around each plant's needs and the weather, so gardening and landscaping companies keep plants alive, prove their work and book repeat jobs.
Problem statement
Gardening and landscaping companies look after thousands of trees, hedges, lawns and flower beds for dozens of clients, but the boss plans the work from memory, spreadsheets and phone calls. Schedules ignore the weather, seasonal workers don't know what each plant needs, and there's no record of what was done. The result is dead plants replaced at the company's cost, wasted trips, disputes with clients, and repeat work that never gets booked.
Slide version: Landscaping companies care for thousands of plants but plan the work from memory, so plants die, work goes unproven, and repeat jobs slip away.
Customer
ICP: EU-based gardening, landscaping and tree-care companies with at least 5 employees whose main income comes from ongoing maintenance for many clients across many sites. They typically bring in seasonal workers every spring.
Buyer: the owner, usually the head gardener or landscaper. He buys it to manage his workers more effectively: less time spent assigning and checking work, fewer mistakes, less wasted labor.
Users: the boss uses the management web app; workers use the mobile app. If workers find it annoying it won't get used, so the worker app must be dead simple.
Beachhead: Estonia first (reachable, small market, TalTech network), then the Baltics and Nordics, then the wider EU.
Solution
Every plant or area gets an ID, a care schedule and a history. Each morning, the AI combines those schedules with the weather forecast and builds every worker's task list. The boss sees the whole operation in one place and approves the plan.
How it works:
1. Snap: a worker photographs a plant or marks an area (lawn, hedge, bed). The AI identifies the species, pins it on the map and creates a care schedule.
2. Plan: every morning, the AI checks schedules against the weather (skip watering after rain, move clipping earlier after a warm spell) and proposes each worker's list and route. The boss approves or adjusts.
3. Do and prove: workers check off tasks with a photo, creating a timestamped, location-stamped record.
4. Grow: the AI predicts when each client's lawn or hedge is due again and drafts an offer for the boss to approve and send.
Features
Core (what the boss pays for):
* AI daily planning: tasks and routes for each worker, based on plant schedules and weather.
* Worker app: today's list, tap done, take photo. Available in local languages (English, Estonian and Latvian first).
* Plant and area register: IDs, map, species, schedule and history, added by photo.
* Proof of work and client reports: automatic monthly summary per client with photos.
* Repeat-work outreach: growth prediction from weather data plus drafted offers, always approved by the boss before sending.
### Time per client: shows which clients are profitable and which eat hours.
Background, not sold as features: plant database and seasonal care info (the AI uses these), route optimization.
Cut for now: supply management, and any fully automatic messaging without approval.
Why us
General field-service tools (Jobber, Aspire, LMN and local equivalents) manage jobs and invoices but know nothing about plants. Consumer plant apps (Planta, Greg) know plants but not crews or clients. Rootline sits in between: crew management built around each plant's needs and the weather.
Business model
* Annual subscription per company, priced by number of workers or managed sites. Annual pricing avoids customers cancelling every October when the Baltic season ends.
* Indicative range to test: about €50–200 per month equivalent, billed annually, depending on crew size.
* Free guided setup for the first site during pilots, since onboarding effort is the biggest reason a company would say no.
Validation (Mom Test)
Ask about past behavior, never "would you use this?":
* Kā Tu plāno savu laiku un kā Tu plāno savu darbinieku laiku?
* Kā Tu nosaki prioritāros klientus - obligāti jāapkopj tagad, citādi augi nomirs?
* Kāds ir veids, kurā Tu centies atgūt jau bijušos klientus?
Hackathon demo
Story: "Monday morning at a landscaping company."
1. The boss opens the web app: a map of plants colored by status, and a note that it rained last night so 18 watering tasks were skipped.
2. The AI's plan for three workers is shown with routes. The boss approves.
3. On the mobile app, a worker completes a task with a photo, then adds a new shrub by photographing it; it's recognized and pinned.
4. The revenue card: "14 clients' hedges reach clipping stage next week, about €3,200." Tap to see drafted offers, tap to approve.
Stack: Next.js on Vercel (two views: management web and mobile worker), Supabase for data and auth, Open-Meteo for weather (free, no key), a plant-recognition API (Pl@ntNet or Plant.id), a map library, an LLM for planning explanations and outreach drafts, and nearest-neighbor plus 2-opt for routes.
Risks and answers
* Onboarding effort: start with areas instead of individual plants, and set up the first site for them.
* Workers won't use it: a one-screen app in their language, with photo check-off only.
* Seasonality: annual pricing.
* Competitors add plant features: go deep on weather-driven plant logic and the local EU market, where large US tools are weak.
* EU marketing rules: outreach only to existing clients, with the boss approving every message and an easy opt-out.
