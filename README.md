# melea

melea: situational marketing for brands. discover the trending news your users are reading on social media as they emerge, then hijack the narrative with on-brand posts.

combines frontier ai and old-school crawling to learn a company's brand and determine their audience. then watches what its users see on social media and drafts posts in their voice.

## overview

python / fastapi. playwright scrape of x/twitter's personalized news to discover emerging narratives and locate the highest-engagement posts to respond to.

parses brand and audience from the company's marketing, website, and linkedin data. leverages word embeddings for brand↔story to find the most relevant trends. a custom-guided ai chat then collaborates with the user to draft posts that respond with the brand's voice and pov.

the prod service has been sunsetted. auth, admin, aws provisioning, reporting, and ci/cd are not included in this public version of the codebase.

## architecture

```
brand website
        │
        ▼
   jina / scraping
        │
        ▼
   llm synthesis ──► audience generation
        │
        ▼
       brand embedding
                    ▲
                    │ cosine similarity
                    │
x/twitter news ──► playwright
        │
        ▼
   parse / fuzzy dedupe
        ├─ trending stories
        ├─ audience sightings
        └─ story embeddings
                │
                ▼
           api (fastapi)
                │
                └─► sitmar  (story → post drafts)
```

- **brand pipeline** — homepage crawl, linkedin company page, audience generation, catalog match, brand synthesis
- **news** — for each assigned persona, x personalizes news, so `audience_story_sightings` is the actual product output
- **relevance** — story document is headline + topic + summary; brand document is brand synthesis + audience title; cosine similarity ranking
- **sitmar** — pick brand + story, llm proposes 3 campaign story seeds. once seed is locked, llm offers vibe chips, and post drafts
- **ui** — customer desktop (three-column dashboard), mobile shell, ops shell

## license

all rights reserved. source is published for reading, not as a hosted marketing service.
