import { Prisma } from '@prisma/client';

type DiffableTask = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  assigneeId: string | null;
  tagIds: string[];
};

type ScalarValue = string | number | boolean | string[] | null;
type Change = { from: ScalarValue; to: ScalarValue };

const FIELDS: (keyof DiffableTask)[] = [
  'title',
  'description',
  'status',
  'priority',
  'dueDate',
  'projectId',
  'assigneeId',
  'tagIds',
];

function normalize(value: ScalarValue): ScalarValue {
  if (Array.isArray(value)) return [...value].sort();
  return value ?? null;
}

/**
 * Generic diff used for CREATE (before=null), UPDATE (both set),
 * and DELETE (after=null). Only changed fields are returned.
 */
export function diffTask(
  before: DiffableTask | null,
  after: DiffableTask | null,
): Prisma.InputJsonValue {
  const changes: Record<string, Change> = {};

  for (const field of FIELDS) {
    const fromValue = before ? before[field] : null;
    const toValue = after ? after[field] : null;

    if (JSON.stringify(normalize(fromValue)) !== JSON.stringify(normalize(toValue))) {
      changes[field] = { from: fromValue ?? null, to: toValue ?? null };
    }
  }

  return changes as Prisma.InputJsonValue;
}

/** Flattens a Task (with included tags) into the shape diffTask compares. */
export function toDiffable(task: {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  projectId: string;
  assigneeId: string | null;
  tags: { id: string }[];
}): DiffableTask {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    tagIds: task.tags.map((tag) => tag.id),
  };
}