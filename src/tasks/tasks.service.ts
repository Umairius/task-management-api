import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { Prisma } from '@prisma/client';

const TASK_INCLUDE = {
  assignee: true,
  project: true,
  tags: true,
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  private buildWhere(filterDto: TaskFilterDto): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {};

    if (filterDto.status) where.status = filterDto.status;
    if (filterDto.priority) where.priority = filterDto.priority;
    if (filterDto.assigneeId) where.assigneeId = filterDto.assigneeId;
    if (filterDto.projectId) where.projectId = filterDto.projectId;

    if (filterDto.dueDateFrom || filterDto.dueDateTo) {
      where.dueDate = {
        ...(filterDto.dueDateFrom && { gte: new Date(filterDto.dueDateFrom) }),
        ...(filterDto.dueDateTo && { lte: new Date(filterDto.dueDateTo) }),
      };
    }

    return where;
  }

  async findAll(filterDto: TaskFilterDto) {
    const page = filterDto.page ?? 1;
    const perPage = filterDto.perPage ?? 20;
    const where = this.buildWhere(filterDto);

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: TASK_INCLUDE,
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async create(createTaskDto: CreateTaskDto) {
    const task = await this.prisma.task.create({
      data: {
        title: createTaskDto.title,
        description: createTaskDto.description,
        status: createTaskDto.status,
        priority: createTaskDto.priority,
        dueDate: createTaskDto.dueDate,
        project: { connect: { id: createTaskDto.projectId } },
        assignee: createTaskDto.assigneeId
          ? { connect: { id: createTaskDto.assigneeId } }
          : undefined,
        tags: createTaskDto.tagIds
          ? { connect: createTaskDto.tagIds.map(id => ({ id })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    if (task.assignee) {
      this.eventEmitter.emit('task.assigned', {
        email: task.assignee.email,
        taskTitle: task.title,
      });
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto) {
    const existingTask = await this.findOne(id);

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: updateTaskDto.title,
        description: updateTaskDto.description,
        status: updateTaskDto.status,
        priority: updateTaskDto.priority,
        dueDate: updateTaskDto.dueDate,
        assignee: updateTaskDto.assigneeId !== undefined
          ? updateTaskDto.assigneeId
            ? { connect: { id: updateTaskDto.assigneeId } }
            : { disconnect: true }
          : undefined,
        tags: updateTaskDto.tagIds
          ? { set: updateTaskDto.tagIds.map(id => ({ id })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    if (updateTaskDto.assigneeId && updateTaskDto.assigneeId !== existingTask.assigneeId) {
      this.eventEmitter.emit('task.assigned', {
        email: task.assignee!.email,
        taskTitle: task.title,
      });
    }

    return task;
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.task.delete({
      where: { id },
    });

    return { message: 'Task deleted successfully' };
  }
}