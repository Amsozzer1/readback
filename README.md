# readback

By [Ahmed Sozzer](https://amsozzer.com) · [github.com/Amsozzer1](https://github.com/Amsozzer1)

A medication list for a telehealth psychiatry visit whose prescription statuses stay true when e-prescribing webhooks arrive late, twice, out of order, or not at all.

After a clinician signs a prescription, the e-prescribing service reports back through webhooks: "submitted", then "delivered" or "error". Webhook delivery is messy. A screen that shows the latest webhook to arrive, and treats "submitted" as "Sent", can show a prescription the service rejected as green "Sent". The clinician moves on to the next patient, and the patient finds out at the pharmacy counter. This project builds the screen and the read model behind it, and measures both against the simple version on a simulated service.

![Two panes showing the same visit's prescriptions; the left flips a failed prescription back to Sent, the right keeps it Failed and later queues it with an owner](docs/demo.gif)

*One scripted, synthetic visit, the same webhook stream on both sides. Left: latest webhook wins, duplicates dropped. Right: this read model. At 17:04 the service returns an error for lamotrigine. At 19:00 that prescription's "submitted" webhook arrives for the first time (the service retried after our endpoint timed out), and the left side flips back to green "Sent". Dropping duplicates doesn't catch it, because it isn't one. After the visit ends at 20:00, the right side puts both problems in a clinic queue with an owner, a next step and an age.*

## Results

Measured with `pnpm bench` on the simulator in this repo, on an Apple M4 laptop. These are counts from seeded runs, not timings, so the machine doesn't change them; `pnpm verify:numbers` reruns the bench in CI and fails if any number below differs.

<!-- results:headline -->
| Read model | Silently wrong at visit close (per 1,000 prescriptions) | Known failure hidden (minutes per 1,000 prescriptions) | Failed with no owner 10 min after the visit |
|---|---:|---:|---:|
| Latest event wins | 13.3 | 670.1 | no issue list |
| Latest event wins, duplicates dropped | 11.6 | 340.2 | no issue list |
| **This read model** | 0.0 | 0.0 | 0.0% |

*Seeds 0–199, 20 visits each: 8,044 synthetic prescriptions, 621 of which really failed. Fault level 10%. Pooled over all seeds.*
<!-- /results:headline -->

- **Silently wrong at visit close:** the line is green ("Sent" or "Delivered") when the visit ends, but the prescription really failed.
- **Known failure hidden:** time a prescription whose error had already reached us was shown as anything other than Failed, counted until an hour after the visit.
- **Failed with no owner:** prescriptions that really failed and have no open issue 10 minutes after the visit.

This read model's zeros are by design: it never shows green without a delivery confirmation, a lower-ranked webhook never overwrites a higher one, and after the visit every failed or unconfirmed line becomes an issue. What checks the design is a conformance test (below). The rows worth reading are the baselines, what each rule contributes, and what the honesty costs.

### What each rule contributes

Each row takes one rule away from this read model, or adds one to the baseline.

<!-- results:ablation -->
| Read model | Silently wrong at visit close (per 1,000 prescriptions) | Known failure hidden (minutes per 1,000 prescriptions) | Failed with no owner 10 min after the visit |
|---|---:|---:|---:|
| Latest event wins | 13.3 | 670.1 | no issue list |
| Latest event wins, duplicates dropped | 11.6 | 340.2 | no issue list |
| **This read model** | 0.0 | 0.0 | 0.0% |
| Duplicates dropped + green only on delivery | 0.0 | 340.2 | no issue list |
| This read model without lifecycle rank | 0.0 | 340.2 | 0.0% |
| This read model without green only on delivery | 1.1 | 0.0 | 0.0% |
| This read model without "Not confirmed" after 90 s | 0.0 | 0.0 | 4.0% |
| This read model without next steps and clinic queue | 0.0 | 0.0 | no issue list |

*Seeds 0–199, 20 visits each: 8,044 synthetic prescriptions, 621 of which really failed. Fault level 10%. Pooled over all seeds.*
<!-- /results:ablation -->

Going in, the hypothesis was: not showing "submitted" as green removes the silent failures by itself; lifecycle rank keeps a known failure visible as Failed; "Not confirmed" and the clinic queue give unconfirmed and failed lines an owner; dropping duplicates changes nothing once rank is on. The table bears out the first three. The fourth is checked by a test instead: injecting duplicate webhooks, with the same or a new id, changes no line of this read model at any moment. Dropping duplicates does help the baseline, but it leaves most of the silent failures in place.

None of these rules needs an event log. A status column could implement all four. The log is what makes the scrubber possible and lets the projection be rebuilt from zero after a rule changes.

### What "Not confirmed" costs

A line with no confirmation 90 seconds after signing turns amber. Sometimes the confirmation was only late, and someone looks at a prescription that was fine.

<!-- results:cost -->
| Threshold for "Not confirmed" | Shown "Not confirmed", then delivered (per 1,000 prescriptions) |
|---|---:|
| 60 s | 102.3 |
| 90 s | 88.3 |
| 180 s | 71.0 |

At the 90 s threshold, issues opened after the visit for prescriptions that were in fact delivered, per 1,000 delivered prescriptions:

| Kind | Per 1,000 delivered | Count |
|---|---:|---:|
| Confirmation never arrived (issue never resolves) | 53.1 | 394 |
| Confirmation arrived late (issue resolves on its own) | 78.3 | 581 |

Median time from visit close to a late confirmation: 3.6 min.

*Seeds 0–199, 20 visits each: 8,044 synthetic prescriptions, 621 of which really failed. Fault level 10%. Pooled over all seeds.*
<!-- /results:cost -->

These numbers come straight from the invented delay and drop inputs, so read them as a method to refit on real delivery data, not as a finding. Full tables, including a fault sweep from 0% to 20%: [`results/numbers.md`](results/numbers.md).

## How it works

```
simulated service --webhooks: late, twice, dropped--> events (append-only, unique key)
     --step--> per-prescription state --view(time, rules)--> each pane of the screen
```

- **Simulated e-prescribing service** (`src/domain/sim.ts`): seeded and deterministic. Each signed prescription gets a "submitted" webhook and exactly one terminal webhook, "delivered" or "error". At fault level f, each webhook is dropped with probability f/2, delivered late (30 s to 10 min) with probability f, and delivered twice with probability f. Failure rate, delays and failure categories are invented.
- **One fold, many read models** (`src/domain/fold.ts`): `step` folds events into per-prescription state (the highest-ranked event and the last one to arrive) and never looks at rules. `view` turns that state into what a pane shows at a given moment under four rules: lifecycle rank, green only on delivery, "Not confirmed" after 90 s, and next steps with a clinic queue. The baselines and every ablation row are the same code with rules switched off, so the comparison can't drift.
- **Conformance test** (`tests/property.test.ts`): an oracle written separately from the fold says what a correct screen should show at time t, given only the webhooks that had arrived by t. Over 500 seeds at two fault levels, the read model has to match it at every arrival, around the 90 s edge, at visit close and at the end of the run. Turning off any one rule has to make the test fail, so the test can catch each rule going missing.
- **Postgres** (`src/db/projection.ts`): `events` is append-only with a unique idempotency key, so a repeated webhook is a no-op at insert. `rx_status` stores the fold's state, never a status, because what a screen shows depends on when it is read. One writer applies events in arrival order, insert and projection in one transaction. Tests check the stored state against the in-memory fold at visit close and at the end of each run, and that a rebuild from zero equals the incremental result.
- **Compare page** (`src/components/Compare.tsx`): replays the scripted stream in the browser through both read models at the scrubber's time. Each pane's text comes only from its own read model.

### How it was built

I built this with Claude Code, from a written spec that three review agents (a founder, a senior engineer and a scope cutter) argued over for five rounds before any code was written. The agent wrote the code, tests and scripts and ran them. Two rules in [`CLAUDE.md`](CLAUDE.md) limited what it could do: "Never edit files in `results/` by hand; regenerate them with `pnpm bench`." and "Don't change the simulator's fault model unless a test fails first." Its work was checked by the conformance test as the gate for the read model, by `pnpm verify:numbers` in CI for every committed number and README table, and by a pre-commit hook that blocks words that must not appear in the repo.

## Run it

```sh
# requirements: Node 24 (.nvmrc), pnpm 12 (package.json), Docker for the Postgres tests
pnpm install
pnpm db:up && pnpm migrate
pnpm test               # unit, conformance, Postgres and component tests
pnpm bench              # regenerates results/ and the tables in this README
pnpm verify:numbers     # fails if anything committed differs from a fresh run
pnpm dev                # then open http://localhost:3000/compare
```

To record the GIF again: `PLAYWRIGHT_BROWSERS_PATH=0 pnpm exec playwright install chromium`, then `pnpm build && pnpm gif`. To print one seed's webhook stream: `pnpm sim --seed 42`.

## Named assumptions

- A prescription's transmission ends in exactly one of "delivered" or "error", and each prescription is transmitted once.
- "Submitted" means the service accepted the request, not that a pharmacy has it. Only "delivered" means the pharmacy has it.
- Webhooks behave the way [Stripe documents its own](https://docs.stripe.com/webhooks): no ordering guarantee, retries with exponential backoff for up to three days, the same event sometimes delivered more than once, and sometimes two separate events for the same change. Webhooks that never arrive at all are this project's own assumption, with an invented rate.
- "Not confirmed" starts 90 s after signing. Visits last 20 minutes, prescriptions are signed 15 to 19 minutes in, and all visits in a seed share one clock.

## Honest limits

- Everything is simulated and synthetic. There is no real e-prescribing service, network or pharmacy, and the patients, medications and pharmacies are made up. Fault rates, delays and failure categories are invented.
- This read model's zeros are by design. The conformance test checks them against an oracle written from the same spec, so it shows the rules are implemented as specified, not that they are the right rules for a real service.
- In this simulator, lifecycle rank gives the same result as ordering by the service's event timestamp, because simulated timestamps are exact. Rank still holds when timestamps tie or are skewed: Stripe's `created` has one-second resolution, and its docs say not to use it for ordering.
- The demo on the compare page is a hand-written scenario, labeled as scripted on screen. The numbers come from random seeds.
- Not modeled: re-sending to another pharmacy, automatic retries, change requests from the pharmacy, cancels, fill notices, and controlled-substance prescriptions.
- No sign-in, no users and no patient-facing screens. The compare page needs no database; Postgres runs in the tests and locally.

## What I'd do next

- A pharmacy picker that tells same-name stores apart by street and checks the directory before signing.
- When a line goes "Not confirmed", ask the service for the prescription's current status before opening an issue.
- An agent on the clinic queue that drafts the message to the patient and proposes a nearby pharmacy that takes e-prescriptions, with a person approving it.
- Replay any seed on the compare page, and show each line's event trail on click.
- Refit the delay model and the 90 s threshold on real delivery logs.

## License

MIT
