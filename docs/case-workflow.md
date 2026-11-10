# Case workflow: valuer → drafter + inspector → valuer → bill

How one valuation case moves through the firm, and what is built for each step.
Status: ✅ exists today · 🔧 being built · ⬜ later phase.

## The people

| Role | Does |
|---|---|
| Owner (Firm admin) | Creates staff accounts, sees every case and its history |
| Valuer | Logs the case in, assigns the drafter and the site inspector, does the final cross-check, submits and sends |
| Drafter | Reads the documents, extracts the facts, builds the report as per documents and as per site |
| Inspector | Visits the property and records what is actually there |

Everyone has their own user ID and password. A drafter or inspector sees only the cases given to them.

## The flow

1. **Case login (valuer).** Work arrives by WhatsApp or email with the papers (deed, approved plan, layout plan,
   occupation / completion certificate, jamabandi, registry, shajra plan, magistrate certificate, property tax,
   electricity bill, other). The valuer logs a case: an automatic case number, bank, branch, the branch's city /
   district / state, login date, client name and phone, purpose (e.g. valuation + restatement), and uploads the papers.
   — 🔧 Phase 1. Case number, bank, branch, login date and upload ✅; client phone, drafter / inspector,
   branch district & state, the extra document types 🔧.
2. **Hand-off.** As soon as the case is saved, the assigned drafter and inspector get a pop-up, and the case appears
   in their list with a briefing: client name, phone, bank, purpose, documents. ✅ pop-up · 🔧 drafter and inspector as
   separate assignees.
3. **Drafter extracts facts (split screen).** Left: the working form. Right: the document being read. For each
   document type the drafter records the same facts side by side: address, owner, land / built-up / floor / flat /
   shop area, boundaries (east, west, north, south, road width), construction details, year of construction.
   — ⬜ Phase 2.
4. **Autofill.** The facts become one record for the case. On submit, every place the bank's format asks for the same
   thing (address, owner, buyer, area, boundaries, year) is filled in at once. ✅ Phase 3: the workbench facts feed all
   three formats (address, areas, boundaries, year, age, construction, floors, adjoining property). When documents
   disagree the drafter picks which one the report uses; answers saved earlier show "records now say …" with a
   one-click update.
5. **Inspector records the site.** Sees the same case briefing, then records as per site: address, measurements
   (length, breadth, shape), ground / first floor coverage, accommodation, water and electricity source, locality,
   road and widening, photos. ✅ Phase 4: the inspector starts their own visit on a case given to them; the form now also
   covers address and boundaries as per site, plot length and breadth, floor-wise accommodation, year built, road
   widening and locality.
6. **Compare.** The drafter sees as-per-document next to as-per-site, cross-checks, finishes the report and submits
   it to the valuer. ✅ Phase 4: the Compare page puts each fact as per documents beside as per site with match / differs /
   missing, and the site's boundaries fill the bank format's "as per actual" boxes.
7. **Valuer cross-check.** A tick beside each key item (name, address, boundaries, land area, built-up area,
   market rate) and the market-rate evidence. Then submit. ✅ Phase 5: the Check & send page shows each item as in the
   bank's report beside documents and site, with a tick and a note, and the market-rate evidence; approving needs every
   tick (unless RELAX_CHECKS is on).
8. **Bill and send.** Submitting raises the bill automatically and the case shows "unpaid". The valuer sends the
   report to the bank manager by WhatsApp or email; the send and the bills are saved on the case.
   ✅ Phase 5: approving raises the bill automatically (the case's fee, or an amount typed then) and the inbox and case
   show unpaid / part paid / paid. Sending: email goes from the system when SMTP is set up (report and bill attached);
   WhatsApp opens with the message ready (the system cannot attach files there); every send is recorded.

## Build order

1. **Phase 1 — Case login and team.** Client phone, drafter and inspector on the case, branch city / district /
   state, the missing document types, briefing screen, pop-ups for all three people, drafter and inspector see only
   their own cases.
2. **Phase 2 — Drafter workbench.** Split screen, per-document fact grid, saved to the case.
3. **Phase 3 — Autofill from the workbench (done).**
   **Phase 4 — Site form and compare (done).**
4. **Phase 5 — Valuer check with ticks, automatic bill, send and record (done).**

## Against the SRS (ValuHub Valuation Platform Workflow SRS)

Built in the "must-have" round:

- **Status lifecycle (SRS 12).** Every case shows the furthest of the 15 stages it has reached, from New case to
  Paid, closed. It is worked out from what has happened on the case (documents, team, facts typed, site visit,
  decisions, draft handed over, returns, approval, sends, bill), so it cannot drift from the real state.
- **Rework loop (SRS 9, 10).** The valuer can return the report to the drafter, ask for a new site visit, or ask for more
  documents, each with a reason and an optional due date. The person gets a pop-up, the case page shows the request
  and its round number, and sending the draft again or submitting the new visit answers it.
- **Final report (SRS 11).** Approving stores the PDF with a report number (`<case>-<bank>-R<revision>`), the approval
  time and approver, and a fingerprint. This is a record of the approval, not a legal e-signature. After approval the
  report is locked; the valuer can reopen it for a revision, which becomes the next revision on approval.
- **Comparison decisions (SRS 7).** For any difference or missing value a person records the outcome (document right,
  site right, explained, not applicable, not available) and the reason. The decision is kept with who and when, and goes
  stale if either value changes. Approval is blocked while a difference has no decision (unless RELAX_CHECKS is on).
- **Never auto-resolve (SRS 16).** When two documents are typed differently and nobody has chosen, the report leaves the
  box empty and says so, and the Compare page shows a difference.
- **Source page, note, unit (SRS 5.1, 5.2).** Each typed value keeps the page it was read from, an optional note, who
  typed it, and the unit an area was written in (sq m, sq yd, sq ft). Comparisons convert to sq m and show the original.
- **Year of construction basis (SRS 6.2).** The inspector says how the year is known; an owner-stated or estimated year
  is shown as "needs verification", never as verified.
- **Document access (SRS 14).** A drafter or inspector can open files, facts and case records only for cases given to them.

Still open: mobile and offline inspector app, configurable and versioned bank templates, valuation workings, legal
e-signature, malware scanning, expiring links, document version history, taxes on the invoice, more case and
extraction fields (owner and proposed buyer at registration, services required, plan numbers, and so on).
