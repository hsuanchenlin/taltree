# Local-first JSON on the device

Taltree Slice 0 has no accounts, backend, or telemetry. The plan is a versioned JSON document the person owns, saved in `localStorage` and exportable as a file. That format is the source of truth so later adapters (files on disk, sync) can sit behind the same parse/save functions without changing the domain module.
