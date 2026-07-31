# Debug Report: Build Version Refresh And Loss Chart

- Symptom: Augment created multiple builds, but Split/Train/Validate did not immediately show or select the latest upstream build. Review/bbox-heavy views felt unresponsive, and Train loss chart was too wide, flat, and lacked axis labels.
- Root cause: Each workflow page owned its own local build list and mostly refreshed only on project mount. Completed jobs updated Task Center and workflow context, but did not broadcast a project artifact revision to downstream selectors. The loss chart plotted box/cls/dfl on one shared wide SVG without axis ticks or per-metric scaling.
- Fix: Added an app-level artifact revision bump on completed artifact-producing jobs and wired downstream pages to refresh on that signal. Split now prefers the newest augment/source build after artifact refresh and shows explicit loading feedback while syncing. Train and Validate also refresh inputs/models on artifact revision. Review now prefetches nearby image annotations and image files. Train loss is split into box/class/DFL charts with y ticks, epoch x labels, data points, and regression trend lines.
- Evidence: `npm --prefix frontend test` passed 71 tests. `npm --prefix frontend run build` passed. Docker Jetson image rebuilt and `http://127.0.0.1:8501/` serves `index-C4sVF2p2.js`.
- Regression tests: `frontend/src/App.test.tsx` covers latest build selection and readable loss charts. `frontend/src/components/review/reviewPanels.test.tsx` covers Review prefetch feedback.
- Status: DONE.
