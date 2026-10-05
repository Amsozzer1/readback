# Design notes

Why each decision was made, what was tried and dropped, and what the numbers changed.

## 1. Compare read models, not storage models
**Chose:** both panes read the same events; they differ only in the rules that turn events into what the screen says.
**Because:** the rules that make the screen honest (lifecycle rank, green only on delivery, "Not confirmed", owned issues) could all be implemented on a status column. Crediting them to an event log would be a false claim.
**Tried first / what went wrong:** the first plan compared an event log against a status column that each webhook overwrites, with no dedupe, no ordering and no timeout. Review pointed out that the win came from those three missing features, not from the log, and that nobody would ship that baseline. The baseline became "latest webhook wins, duplicates dropped", which is what webhook guides tell you to do first, and an ablation table shows what each rule adds.

## 2. Lifecycle rank, not sequence numbers
**Chose:** submitted < delivered < error; a webhook never overwrites one of higher or equal rank.
**Because:** webhook providers don't send a per-prescription sequence number, and Stripe's docs say not to order events by their `created` timestamp, which has one-second resolution.
**Tried first / what went wrong:** the first plan ordered webhooks by a gateway sequence number. That assumed the hard part away, and the baseline couldn't see the number, so the comparison was rigged. The first money shot also showed "accepted, then rejected" for one transmission, which doesn't happen; the flip on screen now comes from a late first delivery of "submitted".

## 3. A conformance test and an ablation, not "0% vs X%"
**Chose:** an oracle written separately from the fold says what a correct screen shows at time t from the webhooks that had arrived by t. The read model must match it everywhere sampled; removing any one rule must make it fail; injecting duplicates must change nothing.
**Because:** "the screen matches the simulator's ground truth" can't pass when webhooks are dropped (the screen can't know), and when it does pass it is true by construction. The README says the read model's zeros are by design and points at this test.
**Tried first / what went wrong:** the first ablation said "turning off dedupe makes the test fail". It can't: once rank is on, a duplicate never changes a line. Dedupe moved to the log's unique key, and the test became an idempotence check.

## 4. What the measurements changed
- **"Silently wrong at visit close" is mostly about errors that haven't arrived yet.** Breaking the baseline's silent failures down by cause showed that most come from errors dropped or delivered after the visit ended, and fewer from a late webhook overwriting an error that had arrived. Even with no faults at all, a few errors arrive after the visit, so the baseline is never at zero. That is why the README also reports "known failure hidden": it is the metric that shows what lifecycle rank does, which "silently wrong at close" alone hides.
- **"Late first delivery" applies to every webhook.** The first fault model only delayed "submitted", the one webhook whose lateness hurts the baseline and costs this read model nothing. Delaying "delivered" too is what makes the "Not confirmed" cost table honest.
- **The first GIF captured a stale build.** Killing the `pnpm` wrapper left a `next start` server running, and the next capture quietly used it. The capture script now refuses to start if the port is taken and stops its server's whole process group.
