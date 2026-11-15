import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_MINUTES, studyEvent } from './studylog.js';

describe('studyEvent', () => {
  it('turns each study event into its snake_case log line', () => {
    expect(studyEvent({ event: 'tutorial.link_open', fileId: 'file_1', partId: 'p2a', target: 'notes' })).toEqual({
      event: 'tutorial.link_open',
      fields: { file_id: 'file_1', part_id: 'p2a', target: 'notes' },
    });
    expect(studyEvent({ event: 'tutorial.main_view', view: 'tutorial' })).toEqual({
      event: 'tutorial.main_view',
      fields: { view: 'tutorial' },
    });
    expect(studyEvent({ event: 'tutorial.source_pdf', fileId: 'file_1', open: false })).toEqual({
      event: 'tutorial.source_pdf',
      fields: { file_id: 'file_1', open: false },
    });
    expect(studyEvent({ event: 'app.active', minutes: 5 })).toEqual({ event: 'app.active', fields: { minutes: 5 } });
  });

  it('drops fields it does not know, so nothing extra can ride along', () => {
    const line = studyEvent({ event: 'tutorial.main_view', view: 'notes', text: 'my answer', name: 'Jane' });
    expect(line?.fields).toEqual({ view: 'notes' });
  });

  it('refuses unknown events, wrong enums and anything that is not an id', () => {
    expect(studyEvent(null)).toBeNull();
    expect(studyEvent('app.active')).toBeNull();
    expect(studyEvent({ event: 'tutorial.answer', text: 'x' })).toBeNull();
    expect(studyEvent({ event: 'tutorial.link_open', fileId: 'file_1', partId: 'p1', target: 'web' })).toBeNull();
    expect(studyEvent({ event: 'tutorial.link_open', fileId: 'my answer is 42', partId: 'p1', target: 'notes' })).toBeNull();
    expect(studyEvent({ event: 'tutorial.link_open', fileId: 'x'.repeat(201), partId: 'p1', target: 'notes' })).toBeNull();
    expect(studyEvent({ event: 'tutorial.main_view', view: 'pdf' })).toBeNull();
    expect(studyEvent({ event: 'tutorial.source_pdf', fileId: 'file_1', open: 'yes' })).toBeNull();
  });

  it('takes only whole minutes between 1 and the cap', () => {
    expect(studyEvent({ event: 'app.active', minutes: 0 })).toBeNull();
    expect(studyEvent({ event: 'app.active', minutes: 1.5 })).toBeNull();
    expect(studyEvent({ event: 'app.active', minutes: MAX_ACTIVE_MINUTES + 1 })).toBeNull();
    expect(studyEvent({ event: 'app.active', minutes: MAX_ACTIVE_MINUTES })).not.toBeNull();
  });
});
