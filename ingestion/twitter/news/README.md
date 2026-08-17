# x news scraper

scrapes x.com explore (news / sports / entertainment) as one assigned audience persona and writes to postgres.

x personalizes the news tab, so each run is attributed to that persona in `audience_story_sightings`. that table is what the brand "audience trends" stage reads.

## layout

- `scrape_news.py` — playwright driver + html parsers + db write
- `audience.py` — claim / mark the least-recently-run assigned member
- `run_news_scraper.sh` — one-run wrapper

live auth is cookie injection (`auth_token` / `ct0`) into a per-member playwright profile, optionally behind a residential proxy. credentials live in postgres, not in this repo.
