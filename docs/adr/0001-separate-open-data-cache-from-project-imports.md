# Separate shared Open Data cache from project imports

VisDrone raw archives and extraction are stored once in a verified shared cache, while each project owns only one disposable mapped and sampled import. This avoids repeated multi-gigabyte downloads and lets project deletion remain a complete resource cleanup without unexpectedly deleting data needed by other projects; the trade-off is explicit cache lifecycle management and symlink-safe file handling.
