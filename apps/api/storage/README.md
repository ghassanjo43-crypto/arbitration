# Local object storage (development)

This directory is the **local storage driver's** root (`STORAGE_LOCAL_ROOT=./storage`).
Uploaded case documents are written here under a year-prefixed, UUID-named path and are
served only through the API's access-checked, signed-URL download endpoint — never as static
files.

**The contents of this folder are intentionally git-ignored.** Uploaded documents are
confidential case material (evidence, pleadings, identity documents) and must not be committed
to source control. Only this `README.md` and `.gitkeep` are tracked, so the folder exists in a
fresh clone.

For production, set `STORAGE_DRIVER=s3` and point the storage abstraction
(`src/providers/storage/storage.service.ts`) at an encrypted object store; nothing here is used.
