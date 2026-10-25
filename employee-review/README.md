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

## Demo-only phone presentation candidate (2026-10-25)

`mobile-presentation.js` and `mobile-presentation.css` are an explicit presentation patch **on top of** the pinned reviewed UI, not a claim that this generated page is an unchanged source snapshot. Their hashes and scope are recorded separately in `manifest.presentationPatch`. The source, fixture, client allowlist and opaque sandbox/security policies remain unchanged.

The patch is active only for the sample employee at widths **≤1000px**, matching the existing Hub mobile layout and including phone landscape. It implements the three approved phone-review adjustments:

1. A compact native disclosure preserves a visible **DEMO / sample data / no live connections / no saves** label. Expand it to see the sample date, no-account-change and optional-Crew explanations and Reset. Reset restores the collapsed phone banner. Desktop retains the expanded full banner.
2. Today's actual production work columns and queue stay ahead of the seven original totals. The totals are moved, not copied or deleted, into a closed native disclosure underneath. DOM order matches the visual order.
3. Inventory and Crew use shorter mobile headings. Inventory search/materials precede collapsed stock totals and watch summaries; each material's status remains on its card. Crew retains revision, publication and active-approved labels while its full scope explanation is expandable.

Native `details`/`summary` controls retain keyboard Enter/Space operation and at least 44px touch targets. Resizing to desktop re-renders the original layouts and ordering; returning to mobile creates one fresh closed disclosure per section. No wrapper duplicates record buttons. Inventory search retains the original node/caret-preserving update path. Nothing persists between reloads.

Stable mobile selectors:

- `details#employeeDemoBanner > summary#employeeDemoBannerSummary`; expanded content `#employeeDemoBannerDetails`
- `#employeeProductionWork` (actual work columns), `details#employeeProductionTotals > summary`
- `#inventoryCatalog` (actual search and materials), `details#employeeInventoryTotals > summary`
- `details#employeeCrewDetails > summary`

This candidate is isolated for phone review. Any later adoption in the real employee UI requires a separately reviewed frontend patch and its authorization/device gates; no root source, management view or permissions are changed here.
