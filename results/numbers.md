# Numbers

Every number in the README comes from `pnpm bench`, which writes this file, `results/raw/*.json` and the two tables in the README. Nothing here is edited by hand: `pnpm verify:numbers` reruns the bench and fails on any difference.

- Command: `pnpm bench`
- Commit: 228863d
- Machine: Apple M4, darwin 25.6.0, Node v24.21.0
- Runs: 200 seeds (0–199) × 20 visits at each fault level. Every number is an aggregate pooled over all prescriptions in those seeds, not a single run.
- Inputs are invented, not measured from any real service: failure rate 8% of prescriptions; terminal webhook delay lognormal (median 3 s, σ 1.5, at least 1 s); at fault level f, each webhook is dropped with probability f/2, delivered late (30 s to 10 min) with probability f, and delivered twice with probability f.
- The full read model's zeros below are by design, and the bench fails if they aren't zero. The conformance test (`tests/property.test.ts`) is what checks the design.

## Headline, fault level 10%

Seeds 0–199, 20 visits each: 8,044 synthetic prescriptions, 621 of which really failed. Fault level 10%. Pooled over all seeds.

| Read model | Silently wrong at visit close (per 1,000 prescriptions) | Known failure hidden (minutes per 1,000 prescriptions) | Failed with no owner 10 min after the visit |
|---|---:|---:|---:|
| Latest event wins | 13.3 | 670.1 | no issue list |
| Latest event wins, duplicates dropped | 11.6 | 340.2 | no issue list |
| **This read model** | 0.0 | 0.0 | 0.0% |

## Every row, fault level 10%

Add-one rows start from "latest event wins, duplicates dropped" and add one rule. Remove-one rows start from this read model and take one rule away.

| Read model | Silently wrong at visit close (per 1,000 prescriptions) | Known failure hidden (minutes per 1,000 prescriptions) | Failed with no owner 10 min after the visit |
|---|---:|---:|---:|
| Latest event wins | 13.3 | 670.1 | no issue list |
| Latest event wins, duplicates dropped | 11.6 | 340.2 | no issue list |
| **This read model** | 0.0 | 0.0 | 0.0% |
| Duplicates dropped + lifecycle rank | 9.8 | 0.0 | no issue list |
| Duplicates dropped + green only on delivery | 0.0 | 340.2 | no issue list |
| Duplicates dropped + "Not confirmed" after 90 s | 1.1 | 340.2 | no issue list |
| Duplicates dropped + next steps and clinic queue | 11.6 | 340.2 | 11.6% |
| This read model without lifecycle rank | 0.0 | 340.2 | 0.0% |
| This read model without green only on delivery | 1.1 | 0.0 | 0.0% |
| This read model without "Not confirmed" after 90 s | 0.0 | 0.0 | 4.0% |
| This read model without next steps and clinic queue | 0.0 | 0.0 | no issue list |

## Fault sweep

| Fault level | Read model | Silently wrong at visit close (per 1,000) | Known failure hidden (min per 1,000) | Failed with no owner | Prescriptions | Really failed |
|---|---|---:|---:|---:|---:|---:|
| 0% | Latest event wins | 0.4 | 0.0 | no issue list | 8,044 | 621 |
| 0% | Latest event wins, duplicates dropped | 0.4 | 0.0 | no issue list | 8,044 | 621 |
| 0% | This read model | 0.0 | 0.0 | 0.0% | 8,044 | 621 |
| 5% | Latest event wins | 6.3 | 376.7 | no issue list | 8,044 | 621 |
| 5% | Latest event wins, duplicates dropped | 5.6 | 196.9 | no issue list | 8,044 | 621 |
| 5% | This read model | 0.0 | 0.0 | 0.0% | 8,044 | 621 |
| 10% | Latest event wins | 13.3 | 670.1 | no issue list | 8,044 | 621 |
| 10% | Latest event wins, duplicates dropped | 11.6 | 340.2 | no issue list | 8,044 | 621 |
| 10% | This read model | 0.0 | 0.0 | 0.0% | 8,044 | 621 |
| 20% | Latest event wins | 23.0 | 1046.0 | no issue list | 8,044 | 621 |
| 20% | Latest event wins, duplicates dropped | 20.9 | 641.9 | no issue list | 8,044 | 621 |
| 20% | This read model | 0.0 | 0.0 | 0.0% | 8,044 | 621 |

## Cost of this read model, fault level 10%

"Not confirmed" is honest but not free. These come straight from the invented delay and drop inputs, so read them as a method to refit on real delay data, not as a finding.

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

## Where each README number comes from

| Number | What it measures | Single run or aggregate | Runs / seeds | Produced by | Raw output |
|---|---|---|---|---|---|
| Headline table | Silently wrong, known failure hidden, failed with no owner, three read models | Aggregate, pooled | 200 seeds × 20 visits | `pnpm bench` | `results/raw/fault-10.json` |
| Ablation table | Same three metrics, one rule added or removed | Aggregate, pooled | 200 seeds × 20 visits | `pnpm bench` | `results/raw/fault-10.json` |
| Cost of this read model | False "Not confirmed" and false issues | Aggregate, pooled | 200 seeds × 20 visits | `pnpm bench` | `results/raw/fault-10.json` |
