# Use one Current Split for new training

New training automatically uses the sole valid Current Split, while previous split records remain lineage history and each UI-built split uses an immutable materialized directory. This keeps the interface small and prevents ambiguous training input after Review or Open Data changes; the trade-off is that users must rebuild Current Split whenever active project data changes.
