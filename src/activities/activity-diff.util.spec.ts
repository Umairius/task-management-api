import { diffTask, toDiffable } from './activity-diff.util';

describe('diffTask', () => {
  it('treats every set field as changed-from-null on create', () => {
    const after = {
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: null, tagIds: [],
    };

    const changes = diffTask(null, after) as Record<string, { from: unknown; to: unknown }>;

    expect(changes.title).toEqual({ from: null, to: 'Task' });
    expect(changes.status).toEqual({ from: null, to: 'TODO' });
    expect(changes.projectId).toEqual({ from: null, to: 'p1' });
    // both sides null already — shouldn't appear as a "change"
    expect(changes.description).toBeUndefined();
    expect(changes.assigneeId).toBeUndefined();
  });

  it('reports only fields that actually changed on update', () => {
    const before = {
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: null, tagIds: [],
    };
    const after = { ...before, title: 'Task (renamed)', status: 'IN_PROGRESS' };

    const changes = diffTask(before, after) as Record<string, { from: unknown; to: unknown }>;

    expect(Object.keys(changes).sort()).toEqual(['status', 'title']);
    expect(changes.title).toEqual({ from: 'Task', to: 'Task (renamed)' });
  });

  it('returns an empty diff when nothing changed', () => {
    const task = {
      title: 'Task', description: 'desc', status: 'TODO', priority: 'MEDIUM',
      dueDate: '2026-01-01T00:00:00.000Z', projectId: 'p1', assigneeId: 'u1',
      tagIds: ['t1', 't2'],
    };

    expect(diffTask(task, { ...task })).toEqual({});
  });

  it('treats tagIds as a set — reordering alone is not a change', () => {
    const before = {
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: null, tagIds: ['a', 'b'],
    };
    const after = { ...before, tagIds: ['b', 'a'] };

    expect(diffTask(before, after)).toEqual({});
  });

  it('detects an actual tagIds change', () => {
    const before = {
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: null, tagIds: ['a'],
    };
    const after = { ...before, tagIds: ['a', 'b'] };

    const changes = diffTask(before, after) as Record<string, { from: unknown; to: unknown }>;

    expect(Object.keys(changes)).toEqual(['tagIds']);
    expect(changes.tagIds).toEqual({ from: ['a'], to: ['a', 'b'] });
  });

  it('treats every set field as changed-to-null on delete', () => {
    const before = {
      title: 'Task', description: 'desc', status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: 'u1', tagIds: ['a'],
    };

    const changes = diffTask(before, null) as Record<string, { from: unknown; to: unknown }>;

    expect(changes.title).toEqual({ from: 'Task', to: null });
    expect(changes.assigneeId).toEqual({ from: 'u1', to: null });
    expect(changes.tagIds).toEqual({ from: ['a'], to: null });
  });
});

describe('toDiffable', () => {
  it('flattens tags to ids and serializes dueDate to an ISO string', () => {
    const dueDate = new Date('2026-03-01T00:00:00.000Z');
    const result = toDiffable({
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate, projectId: 'p1', assigneeId: null, tags: [{ id: 'b' }, { id: 'a' }],
    });

    expect(result.dueDate).toBe(dueDate.toISOString());
    expect(result.tagIds).toEqual(['b', 'a']);
  });

  it('represents a missing dueDate as null, not undefined', () => {
    const result = toDiffable({
      title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
      dueDate: null, projectId: 'p1', assigneeId: null, tags: [],
    });

    expect(result.dueDate).toBeNull();
  });
});