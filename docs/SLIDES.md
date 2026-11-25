# Slide outline — final presentation (2 Dec 2026)

Eight slides, about 6 minutes plus the live demo (docs/DEMO.md).

1. **The problem.** Pakistani students pay consultants lakhs of rupees for advice that is often unverifiable: "guaranteed
   admission", "no IELTS", "PR in 2 years". Official information exists, but it is scattered, changes often, and is hard to compare.
2. **MastersPath in one line.** A free, open-source, evidence-first guide: every fact links to the official page, quotes it,
   and says when it was checked. No data, no answer.
3. **How it works.** Official page → proposal (AI allowed only here, offline) → *code* checks the quote appears word for word →
   human review → database. Fit, ranking, Plan B and claim checks are plain, tested code. The chat only explains rows it was given,
   and refuses otherwise.
4. **Trust by design.** Confidence is computed, never typed: Verified / Likely / Unverified / Conflict. No admission
   percentages. Missing data is never ranked as zero. robots.txt and bot walls are respected — some facts wait for a human.
5. **Live demo** (persona A, 2.5 CGPA): shortlist → Below minimum (verified) → Plan B warns instead of pushing →
   citizenship rules with sources → Consultant Check → chat refuses an unverifiable deadline.
6. **Built for phones in Pakistan.** Lighthouse mobile 93–99 performance, 100 accessibility; works offline as an installable app;
   no sign-up; grades stay on the device; hard delete; no passport or CNIC fields.
7. **Roadmap.** CV Tailor (code checks first, AI suggests program-specific changes, never invents experience, consent +
   delete after session, never scrapes other people's CVs) · more programs and fields · verified PKR exchange rates for cost
   ranking · scholarship deadlines · Urdu interface.
8. **Ask.** Contribute data: one fact = one pull request with a source URL and a verbatim quote (CONTRIBUTING.md).
   Licence: MIT today; moving to AGPL-3.0 (code) + CC BY 4.0 (data) is under consideration.

Numbers to quote (refresh before presenting): facts verified (`npm run validate:seed` coverage), tests passing (`npm test`),
Lighthouse scores (CI artifact).
