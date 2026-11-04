# ValueHub OS — Valuation Operating System

Built from `ValueHub_Valuation_Operating_System_Blueprint.docx`. Layout: `apps/valuation-api`,
`apps/valuation-web`, `packages/valuation-shared`.

## Workflow and gates

`INTAKE → DOCUMENTS → INSPECTION → VALUATION → QUALITY_REVIEW → APPROVED → SUBMITTED → (REVISION) → CLOSED`

The API refuses a move until its requirement is on record:

| Move to | Required |
|---|---|
| INSPECTION | at least one property document |
| VALUATION | a submitted inspection |
| QUALITY_REVIEW | latest valuation sent for review; no material discrepancy unresolved |
| APPROVED | latest valuation approved **and** an approved report for it |
| SUBMITTED | an issued report (first successful submission moves the assignment automatically) |
| CLOSED | issued report, approved valuation, submission record, submitted inspection, documents, no open bank query |

## Design rules that are enforced, not just documented

- **Property ≠ assignment.** One property, many assignments; nothing is carried over silently.
- **Nothing issued is overwritten.** Valuations and reports are versions; a revision needs a reason and a reviewer.
- **OCR is a suggestion.** Read facts start `UNVERIFIED` with a page and confidence; a person verifies, corrects or marks unknown. Unverified area facts fail the report QC.
- **Discrepancies are flagged, never resolved by the system.** Both values are kept; resolving needs a written basis.
- **Four eyes.** Authors cannot approve their own valuation or report, a comparable's recorder cannot verify it, and an inspector cannot field-review their own visit (a firm admin is the one exception).
- **Every figure has a source.** Counted valuation lines need a stated source; comparables cited as evidence must be verified; templates may only pull from an approved list of source fields.
- **"Sent" is not "delivered".** Email results are `SENT` (accepted by the mail server) or `FAILED`; the bank's acknowledgement is recorded by a person.
- **Tenant isolation.** `firmId` comes from the account, never the request; role and active state are re-read on every request.
- **Audit.** Every material change writes an audit event in the same transaction.

## Roles

`FIRM_ADMIN` (everything incl. users, templates, fees, retention) · `VALUER` · `REVIEWER` ·
`INSPECTOR` (own visits only, field data) · `ACCOUNTS` (invoices and payments).

## Property classes

Flat, house, land, commercial (sales comparison or capitalised income), industrial (land +
building, plant only if the scope says so), mixed-use / project (components scaled to completion).
Engines are pure functions in `apps/valuation-api/src/modules/valuations/engines`; every stored
version records the engine version and the exact inputs.

## Operations

- **Backups:** `deploy/valuehub-os/backup.sh` (pg_dump + files, with checksums) and
  `restore.sh` (verifies checksums, restores into an empty database and directory). Test a
  restore on a scratch database regularly. `npm run verify:files` re-hashes
  every stored file against the hash recorded at upload.
- **Deploy:** `deploy/valuehub-os/` has Dockerfiles and a `docker-compose.yml`.
- **Retention:** an admin sets the retention period (there is no default). Closed assignments get
  a retain-until date; the Retention tab lists records past it. Nothing is deleted automatically.
  Legal hold keeps a record out of that list until released.
- **Login protection:** 10 failed attempts per address per 15 minutes, then refusal. The counter is
  per API instance (in memory); use a shared store if you run several.

## Known limits

- **File storage** is local disk by default. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and the
  same `StorageService` uses a private Supabase Storage bucket instead, with the hash checks unchanged.
  Deploy guide: `docs/deploy-supabase-render-vercel.md`.
- **OCR** reads PDF text layers and images (Tesseract, English, downloads language data on first
  use). Scanned PDFs without a text layer are reported as "no text", not guessed. It runs inside the
  request; large batches need a queue.
- **Area units** read from documents: sq. m, sq. ft, sq. yd/gaj. State-specific units (marla, kanal,
  bigha) are not converted.
- **PDF fonts** are the built-in Latin set; set `REPORT_FONT_PATH` / `REPORT_FONT_BOLD_PATH` to a
  TTF (e.g. Noto Sans) to print other scripts.
- **Legal and statutory content** (bank formats, retention periods, calculation rules) must be
  configured and verified per bank before production use. The system assists the valuer; it does not
  certify title or guarantee value.
