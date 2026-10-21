---
name: affiliate-control-center
description: "Trung tâm điều hành affiliate: quét link Shopee theo ngành, đăng bài Facebook hàng loạt, sổ đơn và hoa hồng. Use when the user opens the Affiliate Control Center app or asks to open the affiliate center or manage links, products, posts, orders, or commissions in one screen."
---

# Affiliate Control Center

An AI App (`app.json`): the page is `assets/app.html`, the backend is `backend/` and runs
with no model turn. The user opens it from **AI Apps**; you are its assistant.

## Working with the app

- Resolve bundled paths relative to this skill directory; never assume a workspace name or machine path.
- Run its backend with the `app` tool instead of redoing its work by hand:
  `{"action":"list"}` shows the commands it offers you; `{"action":"call","id":"app-affiliate-control-center","name":"<command>","args":{…}}` runs one.
- Change what the page shows with the `artifact` tool on id `app-affiliate-control-center`
  (`data` to push values, `update` to change the page). Never open a second window.

## When a message arrives from the page

A user message starting with `[artifact-reply: Affiliate Control Center]` was sent by the page
(`aicw.send`). Handle it as a request about this app.
