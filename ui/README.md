# ui

customer desktop, mobile, and ops shells served by the fastapi app.

- `/` and `/app/home` — three-column desktop dashboard
- `/m` — mobile customer shell
- `/ops` — operator shell (separate clerk app)

the later production deploy moved these onto s3/cloudfront and left a teaser on the api box. this snapshot serves them from fastapi again so the product is visible in one tree.
