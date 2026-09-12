# Current application baseline

Sanitized snapshot of the current Cloudflare/D1 app. UI and API behavior are preserved. Personal plan and performance seeding is removed; the public baseline seeds only the common exercise catalog. Original data and deployment remain in the original private workspace.

The contract test harness executes this route with disposable SQLite. Set BASELINE_SOURCE to the original app directory to run the same tests against the original route (automatic seed/import hooks disabled in the test harness only). No test connects to the live app.
