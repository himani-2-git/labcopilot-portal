# Worker boundary

Reserved for server-side background jobs in later phases. Phase 1 patient commands run in the API transaction; no worker, AI job, delivery queue or background synchronization is implemented here. Do not start a dummy worker to imply those capabilities exist.
