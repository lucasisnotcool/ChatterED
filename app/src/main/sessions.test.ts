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
import { CACHE_FLOOR_TOKENS, createSession, estimateTokens } from './sessions.js';

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
