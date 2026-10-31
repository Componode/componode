# Research: Catalog Authoring

Verified in-code before planning:

1. **G29 backend gap**: `POST /component-groups` exists (`createComponentGroupSchema`,
   `componentGroup:create` → EDITOR). `POST /components` is missing — only
   `PATCH /components/:id` and `/promote-to-platform`. New endpoint follows
   the component-groups precedent.
2. **Permission**: `component:create` absent from `PERMISSIONS` — add as EDITOR;
   enumerated set → ADR-054 Amendment (ADR fidelity rule).
3. **G31**: three POST/DELETE edge route pairs already exist under
   `product:edge:add`/`product:edge:remove` (EDITOR). `useAddEdge`/`useRemoveEdge`
   hooks are live but have zero call sites. Relations render via the product
   detail `relations` prop — authoring slot added there, not on the canvas.
   `409 CYCLE` enforced server-side; surface via mutation `onError`.
4. **G32**: `useSuggestions("PENDING", 0, 100)` — status is a positional
   param; a disabled History button already exists on the page.
   Decide hook semantics for decided statuses at implementation (inspect
   `useSuggestions` signature).
5. **Forms**: `Dialog` + `SettingRow`/input patterns in teams/lobs/users
   pages; slug derivation util exists in `ux/lib`.
6. **Component contract fields**: mirror PATCH/upsert writable fields —
   verify `updateComponentSchema`/`Component` contract for the exact
   create payload at implementation.
