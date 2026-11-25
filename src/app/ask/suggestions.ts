/**
 * Example questions on /ask (one tap asks). Kept in their own module so a test can check each one against the
 * live seed (src/lib/chat/live-seed.test.ts):
 *  1. Imperial deadline   -> the refusal demo ("not verified yet" + official page; the deadline is not in the data)
 *  2. Brookes IELTS       -> answered from a Verified row
 *  3. UK work after study -> answered from the Verified Graduate visa row, with "not legal or immigration advice"
 *  4. Visa certainty      -> refused by code as a prediction
 */
export const ASK_SUGGESTIONS: readonly string[] = [
  'What is the deadline for Imperial MSc Computing?',
  'What IELTS score does Oxford Brookes need?',
  'How long can I work in the UK after my Masters?',
  'Will I definitely get a UK visa?',
];
