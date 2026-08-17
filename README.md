# melea

melea: situational marketing for brands. crawl a website, learn the brand, watch what its audiences see in the news, then draft the post.

## overview

python / fastapi. playwright scrape of x explore as in-house audience personas. embeddings for brand↔story relevance. a guided opus chat (sitmar) that turns a trending story into tweet drafts.

the prod service has been sunsetted. ci/cd, aws provision, and a linkedin-stories experiment are not included in this public version of the codebase.

brand profiling and the sitmar chat were written with agents in the loop. the news scraper — cookie injection, residential-proxy rotation, explore-tab parse, fuzzy headline dedup — is the systems piece.

## architecture

```
brand website
        │
        ▼
   jina / scrapingbee
        │
        ▼
   llm synthesis ──► generated audiences ──► match to in-house catalog
        │
        ▼
   brand embedding
                ▲
                │ cosine (python)
                │
x explore ──► playwright (per-persona cookies + proxy)
        │
        ▼
   parse / fuzzy dedup
        ├─ trending_stories
        ├─ audience_story_sightings
        └─ story embedding
                │
                ▼
           api (fastapi)
           /app  /m  /ops
                │
                └─► sitmar  (opus: seeds → confirm → tweets)
```

- **brand pipeline** — homepage crawl, linkedin company page, audience generation, catalog match, brand synthesis. stages write status so the ui can poll.
- **news** — each scrape runs as one assigned persona. x personalizes explore, so `audience_story_sightings` is the product, not just a login bypass.
- **relevance** — story document is headline + topic + summary; brand document is name + synthesis + audience titles. hnsw indexes exist; ranking is cosine in python.
- **sitmar** — pick brand + story, opus proposes 3 campaign seeds, a confirmation turn locks a seed and offers vibe chips, then 3 tweet drafts. not a one-shot prompt.
- **ui** — customer desktop (three-column dashboard), mobile shell, ops shell. clerk is two apps: customer vs invite-only ops.

## license

all rights reserved. source is published for reading, not as a hosted marketing service.
