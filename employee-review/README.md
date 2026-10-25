# Isolated employee review demo

This additive `/employee-review/` page lets the existing administrator review the employee UI on desktop and phone **without changing their account**. It is not an employee-access grant or the live application release.

- Every job, item, crew member, location and quantity is invented sample data.
- Production retains the reviewed Today, 5-Day Production Flow, Table Board and Weekly Forecast screens.
- Inventory search/filter and the physical-count form can be reviewed; Save and count +/− controls are disabled. Cancel discards the sample form safely.
- The optional approved Crew example shows the read-only reader. It does not imply that any real account has Crew access.
- The visibly labeled sample clock is fixed to October 26, 2026, and the sample week is October 26–30. Today/current-week controls use that sample clock, not the device date. Refresh rereads the in-memory fixture; **Reset demo** restores the sample view. Closing or reloading the page retains nothing.

## Isolation boundary

`index.html` is a small outer document containing one `iframe#employeeReviewFrame` with `sandbox="allow-scripts"` and its child embedded as escaped `srcdoc`. There is **no standalone child HTML URL**, same-origin permission, form submission, popup, download, top-navigation permission, storage, parent bridge or message bridge. Outer CSP blocks fetched frames; child CSP begins the child head and blocks network connections, external resources, forms and base URLs. Inline styles/scripts are the only permitted resources.

The build strips external/config/client scripts, authentication/bootstrap, persistent UI preferences, legacy catalog records, private-name/email literals, document-link targets, and live assistant authentication. The only service client is an in-memory five-read allowlist; all writes, raw tables, authentication, realtime and other service calls are rejected. No keys or real session are used. The reviewed renderers remain, while demo-only mutation wrappers and count controls refuse saves. The page never reads the live Hub's storage or changes any permission.

**Browser CI must verify the opaque origin, storage/cookie/parent isolation, self-navigation blocking by outer CSP, no requests, read-only workflows, reset and phone layouts before publication.** A synthetic demo does not validate employee backend authorization or an actual mobile device.

## Rebuild and provenance

The source is pinned by full commit, tree and exact index SHA-256 in `manifest.json` and the builder. An unreviewed source is rejected. A remote candidate retrieval reference (PR 102) is recorded alongside the local reviewed commit; the builder still rejects any retrieved bytes that do not match the exact index hash. The source does not need to replace the live root index.

```sh
# Supply the exact reviewed source index from the isolated release candidate:
node employee-review/build-demo.mjs /path/to/reviewed/index.html
node employee-review/build-demo.mjs --check /path/to/reviewed/index.html
```

The builder is service-free, requires only Node.js, and writes only `employee-review/index.html` and `employee-review/manifest.json`. The manifest records source, builder, fixture, runtime, child and outer-document hashes. Changes to fixtures or runtime require regeneration and another visual/security review. No separately served source snapshot or child page is needed.

Stable review selectors: `#employeeReviewFrame` outside; `#employeeDemoBanner`, `#employeeDemoReset`, existing `#view`, `[data-production-view]`, `[data-inv-action="edit"]`, `#inventoryModal`, and `[data-employee-crew-read]` inside. `employeeDemoStatus()` returns only a copied sample-count/revision/reset/denial diagnostic; it cannot change data or bridge out of the frame.
