import { Controller, Get, Param, Query } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivityFilterDto } from './dto/activity-filter.dto';

@Controller()
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get('activities')
  findAll(@Query() filterDto: ActivityFilterDto) {
    return this.activitiesService.findAll(filterDto);
  }

  @Get('tasks/:id/activities')
  findForTask(@Param('id') id: string, @Query() filterDto: ActivityFilterDto) {
    return this.activitiesService.findAll(filterDto, id);
  }
}