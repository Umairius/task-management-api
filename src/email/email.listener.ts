import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from './email.service';

export interface TaskAssignedEvent {
  email: string;
  taskTitle: string;
}

@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(private readonly emailService: EmailService) {}

  @OnEvent('task.assigned')
  async handleTaskAssigned(event: TaskAssignedEvent) {
    try {
      await this.emailService.sendTaskAssignmentNotification(event.email, event.taskTitle);
    } catch (err) {
      this.logger.error(
        `Failed to send assignment email to ${event.email}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}