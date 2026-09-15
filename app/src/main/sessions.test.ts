/**
 * Session creation from a file and a page range, and the topic block that goes into the frozen
 * prompt prefix (issue #22 decisions 4 and 5).
 *
 * The thing worth testing here is not that a row is written — it is that the prefix stays
 * *stable*. `sharedBlock()` is rebuilt from the material row on every turn and must come out
 * byte-identical every time (architecture-mac.md §E.2 L1077), and `prefix_sha256` is asserted
 * against it (§E.3 L1119). A topic name and file list are exactly the kind of thing that is
 * stable in a test and volatile in a session, so the freezing is what gets asserted.
 */
import { describe, expect, it } from 'vitest';
import { rosterFor } from '../room/agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import { sharedBlock, topicContextBlock } from '../room/prompts.js';
import type { ConceptPack } from '../room/records.js';
import { openTestStore } from '../test-support/db.js';
import {
  CACHE_FLOOR_TOKENS,
  LEARNER_LABEL_MAX_CHARS,
  LEARNER_LABEL_MAX_WORDS,
  createSession,
  draftConcept,
  estimateTokens,
  isShortLabel,
  shortLabel,
} from './sessions.js';

const deps = () => ({
  store: openTestStore(),
  pairing: 'ellie_peer' as const,
  appVersion: '0.1.0-test',
  osVersion: 'darwin test',
  mode: 'scripted' as const,
  now: () => '2026-09-14T12:00:00.000Z',
});

const TOPIC = {
  name: 'MA3236',
  fileNames: ['week-10.pdf', 'week-2.pdf', 'notes.md'],
};

describe('topicContextBlock', () => {
  it('sorts the file names, so the block is byte-stable whatever order they arrived in', () => {
    const a = topicContextBlock(TOPIC);
    const b = topicContextBlock({ name: 'MA3236', fileNames: ['notes.md', 'week-2.pdf', 'week-10.pdf'] });
    expect(a).toBe(b);
    expect(a.indexOf('notes.md')).toBeLessThan(a.indexOf('week-10.pdf'));
  });

  it('caps the list and says how many it left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => `f${String(i).padStart(2, '0')}.pdf`);
    const block = topicContextBlock({ name: 'MA3236', fileNames: many }, 40);
    expect(block).toContain('(+20 more)');
    expect(block).not.toContain('f59.pdf');
  });

  it('tells the agents they have not read any of it', () => {
    // Otherwise a file list reads as a reading list they are expected to know.
    expect(topicContextBlock(TOPIC)).toContain('you have not read them');
  });

  it('is empty when the session did not come from a topic', () => {
    expect(topicContextBlock(null)).toBe('');
  });
});

describe('createSession from a file', () => {
  it('freezes the topic block on the material row and puts it in the prefix', () => {
    const d = deps();
    const created = createSession(d, {
      moduleCode: 'MA3236',
      title: 'Convexity and the Hessian',
      text: 'A twice-differentiable f is convex on S iff its Hessian is PSD everywhere on S.',
      sourceKind: 'pdf_pages',
      fileName: 'week-4.pdf',
      pageFrom: 30,
      pageTo: 31,
      topic: TOPIC,
    });

    const material = d.store.materials.get(created.materialId)!;
    expect(material.topic_context).toBe(topicContextBlock(TOPIC));
    expect(material.source_kind).toBe('pdf_pages');
    expect(material.extract_engine).toBe('pdfjs');
    expect(material.page_from).toBe(30);
    expect(material.page_to).toBe(31);

    const prefix = sharedBlock({
      material,
      pack: JSON.parse(material.concept_pack) as ConceptPack,
      topic: material.title,
      roster: rosterFor('ellie_peer'),
    });
    expect(prefix).toContain('THE FOLDER THIS CAME FROM');
    expect(prefix).toContain('MA3236');
    expect(prefix).toContain('week-10.pdf');
  });

  it('hashes that prefix, and rebuilding it reproduces the hash byte for byte', async () => {
    const { createHash } = await import('node:crypto');
    const d = deps();
    const created = createSession(d, {
      moduleCode: 'MA3236',
      title: 'Convexity',
      text: 'Some slide text.',
      topic: TOPIC,
    });
    const material = d.store.materials.get(created.materialId)!;
    const rebuilt = sharedBlock({
      material,
      pack: JSON.parse(material.concept_pack) as ConceptPack,
      topic: material.title,
      roster: rosterFor('ellie_peer'),
    });
    expect(createHash('sha256').update(rebuilt).digest('hex')).toBe(material.prefix_sha256);
  });

  it('leaves the prefix alone when the session did not come from a topic', () => {
    const d = deps();
    const created = createSession(d, { moduleCode: 'MA3236', title: 'Convexity', text: 'Slide.' });
    const material = d.store.materials.get(created.materialId)!;
    expect(material.topic_context).toBe('');
    const prefix = sharedBlock({
      material,
      pack: JSON.parse(material.concept_pack) as ConceptPack,
      topic: material.title,
      roster: rosterFor('ellie_peer'),
    });
    expect(prefix).not.toContain('THE FOLDER THIS CAME FROM');
  });

  it('keeps the 4,096 floor arithmetic honest — the topic block counts towards it', () => {
    const withTopic = deps();
    const a = createSession(withTopic, {
      moduleCode: 'MA3236',
      title: 'Convexity',
      text: 'Slide.',
      topic: TOPIC,
    });
    const without = deps();
    const b = createSession(without, { moduleCode: 'MA3236', title: 'Convexity', text: 'Slide.' });

    const mA = withTopic.store.materials.get(a.materialId)!;
    const mB = without.store.materials.get(b.materialId)!;
    // architecture-mac.md §E.2 L982: measure, do not estimate. The estimate is still an
    // estimate (M2 owes it a real count_tokens), but it must at least count what it sends.
    expect(mA.token_count).toBeGreaterThan(mB.token_count);
    expect(mA.token_count).toBe(
      estimateTokens(
        sharedBlock({
          material: mA,
          pack: JSON.parse(mA.concept_pack) as ConceptPack,
          topic: mA.title,
          roster: rosterFor('ellie_peer'),
        }),
      ),
    );
    // And `cache_eligible` still tracks the same threshold it always did, both ways.
    expect(mA.cache_eligible === 1).toBe(mA.token_count >= CACHE_FLOOR_TOKENS);
    expect(mB.cache_eligible === 1).toBe(mB.token_count >= CACHE_FLOOR_TOKENS);
  });

  it('opens a room with the pack confirmed and the ledger at level 0', () => {
    const d = deps();
    const created = createSession(d, {
      moduleCode: 'MA3236',
      title: 'Convexity',
      text: 'Slide.',
      topic: TOPIC,
    });
    const material = d.store.materials.get(created.materialId)!;
    expect(material.pack_confirmed_at).not.toBeNull();
    expect(d.store.ledger.forSession(created.sessionId).every((r) => r.level === 0)).toBe(true);
    expect(PSD_HESSIAN_CONVEXITY_V1.elements.length).toBe(d.store.ledger.forSession(created.sessionId).length);
  });
});

/**
 * The learner label — ui-review-ux.md blocker B5.
 *
 * `DRAFT_SCHEMA` constrained neither `label` nor `learner_label`, and `packFor` then copied the
 * learner's whole claim into `learner_label` whenever they had edited it. The ledger rail is
 * 260 px wide and is meant to be scanned in half a second (§D1); what it got was 40–60 words per
 * row, 1362 px of content in a 792 px column, and a recap that printed
 * `What about <60-word paragraph>.?` five times over.
 */
describe('shortLabel', () => {
  it('leaves a label that is already a handle alone', () => {
    expect(shortLabel('what PSD means')).toBe('what PSD means');
    expect(isShortLabel('what PSD means')).toBe(true);
  });

  it('cuts the measured 60-word claim down to something a rail can show', () => {
    const measured =
      'Peer agents and teachable agents are fundamentally explanation based, since the learner ' +
      'constructs knowledge by explaining to the agent, which is distinct from teaching and ' +
      'motivational agents that rely on direct knowledge transmission or affective support ' +
      'rather than learner generated explanation.';
    const out = shortLabel(measured);
    expect(isShortLabel(measured)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(LEARNER_LABEL_MAX_CHARS);
    expect(out.replace('…', '').trim().split(/\s+/).length).toBeLessThanOrEqual(LEARNER_LABEL_MAX_WORDS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never cuts a word in half', () => {
    const out = shortLabel('electroencephalography interpretation across paediatric populations worldwide today');
    for (const word of out.replace('…', '').split(' ')) {
      expect('electroencephalography interpretation across paediatric populations worldwide today').toContain(word);
    }
  });

  it('does not leave a dangling comma or conjunction at the cut', () => {
    const out = shortLabel('the Hessian is positive semidefinite everywhere on S, and therefore f is convex');
    expect(out).not.toMatch(/[,;:]…$/);
    expect(out).not.toMatch(/\b(and|or|the|of|to)…$/);
  });

  it('is eight words or sixty characters, whichever bites first', () => {
    // Eight short words is under sixty characters; eight long ones is not.
    expect(shortLabel('a b c d e f g h')).toBe('a b c d e f g h');
    const long = shortLabel('positive semidefinite interpretation requires convexity everywhere inside S');
    expect(long.length).toBeLessThanOrEqual(LEARNER_LABEL_MAX_CHARS);
  });

  it('gives back an empty string for an empty label rather than a bare ellipsis', () => {
    expect(shortLabel('   ')).toBe('');
  });
});

describe('the module code', () => {
  it('is empty when there is nothing to derive it from — never a literal MA3236', () => {
    const d = deps();
    const created = createSession(d, { moduleCode: '', title: 'Convexity', text: 'Slide.' });
    const material = d.store.materials.get(created.materialId)!;
    expect(material.module_code).toBe('');
    expect(d.store.rooms.get(created.roomId)!.module_code).toBe('');
  });

  it('leaves the MODULE line out of the frozen prefix when there is no module', () => {
    const d = deps();
    const created = createSession(d, { moduleCode: '  ', title: 'Convexity', text: 'Slide.' });
    const material = d.store.materials.get(created.materialId)!;
    const prefix = sharedBlock({
      material,
      pack: JSON.parse(material.concept_pack) as ConceptPack,
      topic: material.title,
      roster: rosterFor('ellie_peer'),
    });
    expect(prefix).not.toContain('MODULE');
    expect(prefix.split('\n')[0]).toBe('Convexity');
  });

  it('still emits the MODULE line — byte for byte — for a session that has one', () => {
    // The frozen-prefix invariant: a material written before this change must rebuild to the
    // same bytes, and every one of those has a non-empty module_code.
    const d = deps();
    const created = createSession(d, { moduleCode: 'MA3236', title: 'Convexity', text: 'Slide.' });
    const material = d.store.materials.get(created.materialId)!;
    const prefix = sharedBlock({
      material,
      pack: JSON.parse(material.concept_pack) as ConceptPack,
      topic: material.title,
      roster: rosterFor('ellie_peer'),
    });
    expect(prefix.split('\n')[0]).toBe('MODULE MA3236 — Convexity');
  });
});

describe('packFor', () => {
  const claim = (label: string, learnerLabel?: string) => ({
    id: 'R1',
    label,
    ...(learnerLabel === undefined ? {} : { learnerLabel }),
  });

  const packOf = (claims: { id: string; label: string; learnerLabel?: string }[]): ConceptPack => {
    const d = deps();
    const created = createSession(d, { moduleCode: '', title: 'A concept', text: 'Slide.', claims });
    return JSON.parse(d.store.materials.get(created.materialId)!.concept_pack) as ConceptPack;
  };

  it('never puts a paragraph in the rail, whatever the learner typed into the claim', () => {
    const paragraph =
      'Peer agents and teachable agents are fundamentally explanation based, since the learner ' +
      'constructs knowledge by explaining to the agent rather than receiving it.';
    const pack = packOf([claim(paragraph), claim('Second claim'), claim('Third claim')]);
    for (const element of pack.elements) {
      expect(isShortLabel(element.learner_label)).toBe(true);
    }
    expect(pack.elements[0]!.label).toBe(paragraph); // the claim itself is kept in full
  });

  it('prefers the short label the learner typed beside the claim', () => {
    const pack = packOf([
      claim('A long claim about positive semidefinite Hessians on open convex sets', 'what PSD means'),
      claim('Second claim'),
      claim('Third claim'),
    ]);
    expect(pack.elements[0]!.learner_label).toBe('what PSD means');
  });
});

describe('draftConcept', () => {
  const schemaDraft = (learnerLabels: string[]) =>
    JSON.stringify({
      title: 'A concept',
      claims: learnerLabels.map((learner_label, i) => ({
        id: `R${i + 1}`,
        label: `The full claim number ${i + 1}, stated at length for the record.`,
        learner_label,
        level_three_criterion: 'uses it on a case',
      })),
    });

  const fakeLlm = (replies: string[]) => {
    const asked: string[] = [];
    return {
      asked,
      client: {
        kind: 'anthropic' as const,
        complete: (request: { messages: { content: string }[] }) => {
          asked.push(request.messages[0]!.content);
          const text = replies[Math.min(asked.length - 1, replies.length - 1)]!;
          return Promise.resolve({
            text,
            model: 'test',
            usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            ttftMs: 0,
          });
        },
      },
    };
  };

  const LONG = 'Peer agents and teachable agents are fundamentally explanation based throughout';

  it('asks once when every learner_label is already short', async () => {
    const llm = fakeLlm([schemaDraft(['what PSD means', 'why S must be open', 'the second-order test'])]);
    const draft = await draftConcept(llm.client, { moduleCode: 'CS3249', title: '', text: 'Slide.' });
    expect(llm.asked).toHaveLength(1);
    expect(draft.claims.map((c) => c.learnerLabel)).toEqual([
      'what PSD means',
      'why S must be open',
      'the second-order test',
    ]);
  });

  it('re-prompts once when the model restates the claim instead of naming it', async () => {
    const llm = fakeLlm([schemaDraft([LONG, LONG, LONG]), schemaDraft(['what PSD means', 'openness of S', 'the test'])]);
    const draft = await draftConcept(llm.client, { moduleCode: 'CS3249', title: '', text: 'Slide.' });
    expect(llm.asked).toHaveLength(2);
    expect(llm.asked[1]).toContain('at most eight words');
    expect(draft.claims[0]!.learnerLabel).toBe('what PSD means');
  });

  it('truncates rather than giving up when the re-prompt comes back just as long', async () => {
    const llm = fakeLlm([schemaDraft([LONG, LONG, LONG])]);
    const draft = await draftConcept(llm.client, { moduleCode: 'CS3249', title: '', text: 'Slide.' });
    expect(llm.asked).toHaveLength(2);
    for (const c of draft.claims) expect(isShortLabel(c.learnerLabel)).toBe(true);
  });

  it('leaves the MODULE line out of the ingest prompt when there is no module', async () => {
    const llm = fakeLlm([schemaDraft(['a', 'b', 'c'])]);
    await draftConcept(llm.client, { moduleCode: '   ', title: '', text: 'Slide text.' });
    expect(llm.asked[0]).not.toContain('MODULE');
    expect(llm.asked[0]).toContain('MATERIAL');
  });

  it('falls back to the committed fixed pack when there is no backend at all', async () => {
    const draft = await draftConcept(null, { moduleCode: '', title: '', text: 'Slide.' });
    expect(draft.provenance).toBe('fixed');
    expect(draft.claims.every((c) => isShortLabel(c.learnerLabel))).toBe(true);
  });
});

describe('the material and its file', () => {
  it('remembers which vault file it came from, so the room can render the page', () => {
    const d = deps();
    const created = createSession(d, {
      moduleCode: '',
      title: 'Convexity',
      text: 'Slide.',
      sourceKind: 'pdf_pages',
      fileId: 'f_abc123',
      fileName: 'week-4.pdf',
      pageFrom: 30,
      pageTo: 31,
    });
    const material = d.store.materials.get(created.materialId)!;
    expect(material.file_id).toBe('f_abc123');
    expect(material.page_from).toBe(30);
  });

  it('is null for pasted text — the room falls back to the extracted text there', () => {
    const d = deps();
    const created = createSession(d, { moduleCode: '', title: 'Convexity', text: 'Slide.' });
    expect(d.store.materials.get(created.materialId)!.file_id).toBeNull();
  });

  it('does not reach the frozen prefix: two materials differing only in file_id hash the same', async () => {
    const { createHash } = await import('node:crypto');
    const hash = (fileId?: string): string => {
      const d = deps();
      const created = createSession(d, {
        moduleCode: 'MA3236',
        title: 'Convexity',
        text: 'Slide.',
        ...(fileId === undefined ? {} : { fileId }),
      });
      const material = d.store.materials.get(created.materialId)!;
      const prefix = sharedBlock({
        material,
        pack: JSON.parse(material.concept_pack) as ConceptPack,
        topic: material.title,
        roster: rosterFor('ellie_peer'),
      });
      return createHash('sha256').update(prefix).digest('hex');
    };
    expect(hash('f_abc123')).toBe(hash());
  });
});
