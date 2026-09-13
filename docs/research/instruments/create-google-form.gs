/**
 * ChatterED — builds the Assignment 1 learner survey as a Google Form.
 *
 * How to use: go to https://script.google.com → New project → paste this file →
 * run `createChatterEdForm` (authorise once) → open the URL printed in the log
 * (View → Logs / Executions). Then in the form's Settings turn OFF "Collect
 * email addresses" and "Limit to 1 response" (both force sign-in) and turn ON
 * "Show progress bar". The spec is docs/research/instruments/question-bank.md §2.
 */

const TASK =
  'problem sets, tutorials or past-year questions in a quantitative or proof-based module ' +
  '(e.g. MA3236 Non-Linear Programming, MA2001 Linear Algebra, ST2334 Probability & Statistics, ' +
  'CS3230 Algorithms) with the help of ChatGPT, Claude, Gemini, Copilot or similar';

function createChatterEdForm() {
  const form = FormApp.create('How do you actually use AI for maths / stats / algorithms coursework?');
  form.setDescription(
    "I'm a CS3249 (Conversational UX) student. For Assignment 1 I have to design a conversational " +
    'learning tool based on real NUS students, not made-up ones. This form asks how you use AI tools ' +
    '(ChatGPT, Claude, Gemini, Copilot…) for problem sets, tutorials or past-year questions in a ' +
    'quantitative or proof-based module — maths, statistics, optimisation, algorithms — and what still ' +
    'feels hard afterwards.\n\n' +
    "THERE IS NO RIGHT WAY TO USE AI AND NOBODY IS BEING ASSESSED. I'm not from the department and " +
    'this has nothing to do with academic-integrity policy. Honest answers, including "I just paste ' +
    'the question", are the useful ones.\n\n' +
    'About 8–10 minutes. No name, email or student ID is collected. I record only your programme, ' +
    'year and gender, and you may skip those. Short anonymised quotes may appear in my report and ' +
    'video. You can close the tab at any point and nothing is saved.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setProgressBar(true);
  form.setConfirmationMessage(
    'Thank you. If you later want your answers removed, message me with the time you submitted and ' +
    "I'll delete that row."
  );

  // Section 1 page break is created first so K1 can navigate to it.
  const K1 = form.addMultipleChoiceItem().setTitle('I confirm that I have read the above and agree to take part.').setRequired(true);
  const pEligibility = form.addPageBreakItem().setTitle('Eligibility');
  K1.setChoices([
    K1.createChoice('I agree', pEligibility),
    K1.createChoice('I do not agree', FormApp.PageNavigationType.SUBMIT),
  ]);

  const E1 = form.addMultipleChoiceItem()
    .setTitle('Do all three of these apply to you? (1) I am 18 or older. (2) I am currently enrolled at a university. (3) In the last 4 weeks I have used an AI tool for ' + TASK + '.')
    .setRequired(true);
  const pUse = form.addPageBreakItem().setTitle('How you use AI for this work')
    .setHelpText('The questions in this section are about what you actually do, not what you think you should do.');
  E1.setChoices([
    E1.createChoice('Yes, all three', pUse),
    E1.createChoice('No', FormApp.PageNavigationType.SUBMIT),
  ]);

  // ---- Section 2: workflow (U)
  cb(form, 'U1. Which AI tools have you used for this kind of coursework in the last 4 weeks?',
    ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'DeepSeek', 'Perplexity', 'NotebookLM'], true, true);
  mc(form, 'U2. In the last 2 weeks, roughly how many separate times did you use an AI tool for this kind of coursework?',
    ['0', '1–2', '3–5', '6–10', 'More than 10'], true);
  cb(form, 'U3. Think about the MOST RECENT time you used AI for this work. What did you give the AI? Tick all that apply.',
    ['The question only', 'The question plus my own attempt', 'Lecture notes or slides', 'A screenshot or photo', 'My full working'], true, true);
  mc(form, 'U4. On that same occasion, what did you mainly ask it to do?',
    ['Give the full solution', 'Check my working', "Explain one step I didn't get", 'Suggest which method or theorem to use', 'Explain a concept from the lecture'], true, true);
  mc(form, 'U5. What did you then do with what it gave you?',
    ['Copied it into my work as-is', 'Rewrote it in my own words', 'Used it to check an answer I already had', 'Read it, closed it, and solved the problem myself', "Didn't use it"], true, true);
  form.addParagraphTextItem().setTitle('U6. In a sentence or two: on that occasion, what were you stuck on, and what happened?').setRequired(false);

  // ---- Section 3: persistence (P)
  form.addPageBreakItem().setTitle('When it gets hard')
    .setHelpText('Think about the last time you were STUCK on a step in this kind of problem.');
  mc(form, 'P1. Roughly how long did you work on it yourself before asking an AI?',
    ['I asked almost immediately', 'Under 2 minutes', '2–10 minutes', '10–30 minutes', 'Over 30 minutes', "I didn't ask an AI that time"], true);
  mc(form, 'P2. Before asking, how much of your own attempt had you written down?',
    ['Nothing', 'A few notes', 'A partial attempt', 'A full attempt'], true);
  mc(form, 'P3. Compared with before you started using AI tools, how long do you now stay on a hard step before seeking any help?',
    ['Much shorter', 'Somewhat shorter', 'About the same', 'Somewhat longer', 'Much longer', "Can't say"], true);
  mc(form, 'P4. If AI tools were unavailable for a day, what would you most likely do with a step like that?',
    ['Keep trying on my own', 'Check notes or the textbook', 'Ask a friend or group chat', 'Ask a TA or forum', 'Skip it and move on'], true, true);

  // ---- Section 4: uncritical use (C)
  form.addPageBreakItem().setTitle('Checking and explaining')
    .setHelpText('Still thinking about the most recent AI answer you received for this kind of work.');
  cb(form, 'C1. Did you check whether that answer was correct? Tick all that apply.',
    ['No', 'Glanced at it and it looked right', 'Compared it with an answer key or a friend', 'Worked through or re-derived it myself', 'Checked that the theorem / condition it used actually applies'], true, true);
  mc(form, 'C2. How confident are you that you could explain that answer to a classmate right now, without looking at it?',
    ['Not at all confident', 'Slightly', 'Moderately', 'Very', 'Completely'], true);
  mc(form, 'C3. In the last month, how many times has an AI answer for this kind of work turned out to be wrong or unjustified?',
    ['Never', 'Once', '2–3 times', '4 or more', "I wouldn't know"], true);
  form.addTextItem().setTitle('C4. If it happened: how did you find out?').setRequired(false);
  mc(form, 'C5. In the last month, how often have you handed in or presented work containing a step you could not fully explain?',
    ['Never', 'Once', 'A few times', 'Often', 'Prefer not to say'], true);
  mc(form, 'C6. When the AI names a theorem, rule or assumption, how often do you check that it actually applies to your problem?',
    ['Never', 'Rarely', 'Sometimes', 'Usually', 'Always'], true);

  // ---- Section 5: ownership (O)
  form.addPageBreakItem().setTitle('Deciding the approach');
  mc(form, 'O1. When you start a hard problem, which usually happens first?',
    ['I pick a method myself, then maybe check with the AI', 'I ask the AI which method to use', 'I ask the AI to solve it directly', 'It varies too much to say'], true);
  mc(form, 'O2. The last time the AI proposed an approach different from the one you would have chosen, what did you do?',
    ["Followed the AI's approach", 'Kept my own', 'Combined the two', 'Never happened', "Don't remember"], true);
  mc(form, 'O3. How often do you push back on or question an AI answer for this kind of work?',
    ['Never', 'Rarely', 'Sometimes', 'Usually', 'Always'], true);
  form.addScaleItem().setTitle('O4. Think of the last piece of work you submitted where AI helped. Whose solution was it?')
    .setBounds(1, 5).setLabels("Entirely the AI's", 'Entirely mine').setRequired(true);

  // ---- Section 6: own words (D)
  form.addPageBreakItem().setTitle('In your own words');
  form.addTextItem().setTitle('D1. Complete this sentence: "I can get an answer for this kind of problem with AI, but I still can\'t ________ on my own."').setRequired(true);
  const diffOpts = ['I turn to AI before really trying', "I can get the answer but can't explain or check it", 'I let the AI decide the approach and next steps', 'None of these'];
  mc(form, 'D2. Which of these costs you the most, in marks or in confidence?', diffOpts, true, true);
  mc(form, 'D3. If one tool could help with exactly one of those, which would you pick?', diffOpts, true, true);

  // ---- Section 7: group (G)
  form.addPageBreakItem().setTitle('Studying with others');
  cb(form, 'G1. Do you study for this module with other people? Tick all that apply.',
    ['A study group', 'A module Telegram / Discord / WhatsApp', 'Tutorial mates', 'A project group', 'No, alone'], true);
  mc(form, 'G2. In a module group chat, of the questions you actually have, roughly what share do you post?',
    ['None', 'A few (under a quarter)', 'Some (about a quarter to half)', 'Most', 'Nearly all', "I'm not in one"], true);
  cb(form, "G3. What stops you posting the ones you don't post? Tick all that apply.",
    ['It looks too basic', "It's probably been answered already", "I don't want to derail the chat", "I don't want to be wrong in front of others", 'Nobody replies anyway', "I'd rather ask an AI", 'Nothing stops me'], true, true);
  mc(form, 'G4. Do you ever DM one person instead of asking the whole group?', ['Often', 'Sometimes', 'Rarely', 'Never'], true);
  form.addTextItem().setTitle('G5. What kind of question goes to a DM rather than the group?').setRequired(false);
  mc(form, 'G6. Has there been a time when the group agreed on an answer you doubted, and you let it go?', ['Yes', 'No', 'Not sure'], true);

  // ---- Section 8: latency (L)
  form.addPageBreakItem().setTitle('AI response speed');
  mc(form, 'L1. When an AI replies instantly, versus after 10–20 seconds, does that change how you read the answer?',
    ['No difference', 'Instant feels more helpful', 'A pause makes it feel more considered', 'A pause just feels slow', 'Not sure'], true);
  mc(form, 'L2. While the AI is generating, what do you usually do?',
    ['Watch it type', 'Re-read the question', 'Start thinking about my own next step', 'Switch to something else'], true, true);
  mc(form, 'L3. In a study group chat, how long could a reply take before it feels broken?',
    ['Under 5 s', '5–15 s', '15–30 s', '30–60 s', 'Over a minute'], true);

  // ---- Section 9: concept (R)
  form.addPageBreakItem().setTitle('One idea')
    .setHelpText('Imagine a group chat for revising a lecture topic. You explain the concept in your own words to two or three AI study-mates with different personalities — one builds on what you say, one pushes back and asks the awkward question. They wait a moment before replying so you get room to continue. You can also send a private message to one of them that the others don\'t see.');
  mc(form, 'R1. How likely would you be to try this the week before a test?',
    ['Very unlikely', 'Unlikely', 'Not sure', 'Likely', 'Very likely'], true);
  form.addTextItem().setTitle('R2. What is the first thing that would annoy you about it?').setRequired(true);
  cb(form, 'R3. When, if ever, would you open it?',
    ['Before a tutorial', 'The night before a deadline', 'Revision week', "When a friend isn't free to help", 'Never'], true, true);
  form.addTextItem().setTitle('R4. The private message to one study-mate — what, if anything, would you use it for?').setRequired(false);

  // ---- Section 10: about you (A)
  form.addPageBreakItem().setTitle('About you')
    .setHelpText('Used only to describe respondents as a group (e.g. "Year 2 Statistics").');
  form.addTextItem().setTitle('A1. Your programme / major').setRequired(true);
  mc(form, 'A2. Year of study', ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5+', 'Graduate', 'Other'], true);
  mc(form, 'A3. Gender', ['Woman', 'Man', 'Non-binary', 'Prefer not to say'], true, true); // "Other" = self-describe
  mc(form, 'A4. Would you be willing to do a 35-minute follow-up chat (Zoom or campus, kopi on me)? DO NOT type your name here — if yes, just message me on Telegram.',
    ["Yes, I'll message you", 'No thanks'], true);

  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Share URL: ' + form.getPublishedUrl());
}

function mc(form, title, options, required, other) {
  const item = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(options).setRequired(!!required);
  if (other) item.showOtherOption(true);
  return item;
}

function cb(form, title, options, required, other) {
  const item = form.addCheckboxItem().setTitle(title).setChoiceValues(options).setRequired(!!required);
  if (other) item.showOtherOption(true);
  return item;
}
