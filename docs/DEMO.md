# Demo script (about 4 minutes, on a phone)

## Before you start (10 minutes, the night before)

1. Open the deployed URL on the phone, **Add to Home screen**, then open every screen once so the service worker caches it.
2. On the deployment, set `MASTERSPATH_NOW=2026-12-02` so "checked N days ago" and the 30-day Verified window are stable on stage.
3. **Conflict badge (wow #2) needs one human check.** Open both pages below in a normal browser. If they still disagree on the
   TOEFL minimum for the CSUDH MS Computer Science, set both `review.verdict` values to `"accept"` in
   `data/proposals/needs-human/robots-blocked-and-conflict.json` (only those two `csudh-mscs` `language_req` entries, or all
   entries you checked), run `npx tsx scripts/merge-proposals.ts data/proposals/needs-human/robots-blocked-and-conflict.json`
   and `npm run validate:seed`, commit, deploy.
   - https://catalog.csudh.edu/academics/computer-science/computer-science-ms/ (program catalog: "A minimum TOEFL score of 90 …")
   - https://www.csudh.edu/future-students/international/english-proficiency (graduate table: TOEFL iBT 80)
   If they no longer disagree, skip the Conflict moment (never fake one) and show the Conflict state in the badge legend instead.
4. Keep a second tab open on https://www.brookes.ac.uk/study/international-students/your-country/pakistan/entry-requirements
   to prove the quoted sentence really is on the official page.

## Story: "Ayesha" (persona A)

CGPA 2.5/4, BS Computer Science from a mid-ranked private university, limited budget (PKR 60 lakh).
A consultant told her: *"Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in UK in 2 years."*

| # | Screen | Tap | Say |
| --- | --- | --- | --- |
| 1 | Home | **Load demo persona A** | "No sign-up, under a minute, no passport or ID — ever. Her grade is saved on this device; we never ask for ID numbers." |
| 2 | Shortlist | Scroll to the two **Below minimum** cards; point at the coverage box | "Code decided this, not AI: USF publishes a B average, 3.00 on a 4.00 scale (Verified). Oxford Brookes publishes GPA 2.7 for a 2:2 but does not name the scale, so we mark it *Likely* and say why. Everything without a published minimum stays *Competitive range unknown* — we never guess." Point at an Imperial card: "*Who it's for*: a conversion course for non-computing graduates — quoted from Imperial." |
| 3 | Program: Oxford Brookes (MSc Advanced Computer Science) | Open **Evidence from the official page** on the minimum grade; point at the **Pakistan note** | "Every value has its source, quote and date. And look: Brookes' own page lists extra compliance measures for Pakistani applicants — a consultant may not tell you that." |
| 4 | Program: CSUDH (if step 3 above was done) | The **Conflict** badge on English test | "Two official pages disagree — 80 vs 90. We show both and write the email to admissions." Tap **Copy email to admissions**. |
| 5 | Plan B | Bottom nav → **Plan B** (or tap **See other routes (Plan B)** on the USF card) | "Below minimum is not the end. NYIT publishes a route for a GPA of 2.5 to 2.84: earn 3.0 in your first four courses. UCCS admits provisionally. Both quoted from the official pages, with the conditions shown." Then the **QMUL pre-master's**: "an agent would sell this as your way in. We warn first: *Check you are eligible* (it leads to a conversion MSc for non-computing graduates) and *the official page does not guarantee progression*." Show **Why this order** and **Improve and reapply**. |
| 6 | Citizenship & cost | Header → **Citizenship & cost**; scroll to **Money to show for the student visa** | "Canada: 1,095 days in 5 years, temporary days count half — quoted from canada.ca. Earliest *rule*, not a guarantee. Pakistan's own dual-nationality rule: *Not verified yet* — and we say so. And the money you must show for the visa: Germany's €11,904 blocked account, from the German Embassy in Pakistan." |
| 7 | Consultant Check | Bottom nav → **Check**, paste the consultant message | "'No IELTS' differs from Brookes' official IELTS 6.0. 'PR in 2 years' differs from the UK rule. 'Guaranteed admission' — no official page guarantees it. Questions to ask *in writing*." Tap **Share on WhatsApp**. |
| 8 | Ask | **What is the deadline for Imperial MSc Computing?** (wow #1) | "It refuses. We don't hold a verified Imperial deadline, so it won't invent one — it links the official page." Then tap **What IELTS score does Oxford Brookes need?** — it answers with the source and a Verified badge. |

Close: "Open source, MIT. Every fact is a pull request with a source and a quote. The AI explains; it never decides."

## Persona B (if time)

**Load demo persona B** (same grade + a fictional preprint and supervisor). Research-led routes show "Your research may matter
here" where an official page says research is considered. The fit label does **not** change — strengths never change fit.

## If something fails live

- No network: installed PWA still opens the saved shortlist and checklists.
- No API key or budget reached: chat lists the verified rows instead of writing prose — and still refuses unverifiable questions.
- Vercel down: run `npm run build && npm start` on the laptop (do NOT set CSP_UPGRADE_INSECURE for this build) and use the phone on the same Wi-Fi (`http://<laptop-ip>:3000`). Rehearse this once on the phone the day before.
