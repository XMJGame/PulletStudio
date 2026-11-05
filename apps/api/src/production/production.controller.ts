import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parse, StudioRequest } from '../common/http';
import { jsonSchema } from '../common/openapi';
import { ProductionService } from './production.service';
import { visualStylePresets, workFormats, narrativeModes } from '../db/schema';
import { shotInput } from './shot-input';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { MembersService } from './members.service';

const title = z.string().trim().min(1).max(200);
const uuid = z.uuid();
const projectSchema = z
  .object({
    title,
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '2.35:1']).optional(),
    language: z.string().min(2).max(20).optional(),
    description: z.string().max(20000).optional(),
    stylePreset: z.enum(visualStylePresets).optional(),
    styleDescription: z.string().trim().max(2000).optional(),
    workFormat: z.enum(workFormats).optional(),
    narrativeMode: z.enum(narrativeModes).optional(),
    targetDurationSeconds: z.number().int().positive().max(28800).nullable().optional(),
    directorNotes: z.string().trim().max(4000).optional(),
  })
  .strict();
const createProjectSchema = projectSchema.extend({ workspaceId: uuid });
const episodeSchema = z
  .object({ title, orderIndex: z.number().int().min(0).max(100000).optional() })
  .strict();
const shotSchema = shotInput;
const version = z.number().int().positive();
const projectPatch = projectSchema
  .partial()
  .extend({ expectedVersion: version, acknowledgeImpact: z.boolean().optional() });
const episodePatch = episodeSchema.partial().extend({ expectedVersion: version });
const shotPatch = shotSchema.partial().extend({ expectedVersion: version });
const workspaceSchema = z
  .object({
    name: title,
  })
  .strict();
const inviteSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    role: z.enum(['WORKSPACE_ADMIN', 'MEMBER']).default('MEMBER'),
  })
  .strict();
const projectRole = z.enum(['PROJECT_MANAGER', 'EDITOR', 'GENERATOR', 'REVIEWER', 'VIEWER']);
const workspaceRole = z.enum(['WORKSPACE_OWNER', 'WORKSPACE_ADMIN', 'MEMBER']);
const memberSchema = z
  .object({ userId: uuid, role: projectRole, expectedRole: projectRole.optional() })
  .strict();
const projectRemoval = z.object({ expectedRole: projectRole }).strict();
const workspaceRemoval = z.object({ expectedRole: workspaceRole }).strict();
const workspaceRoleUpdate = workspaceRemoval.extend({ role: z.enum(['WORKSPACE_ADMIN', 'MEMBER']) });
const lifecycleInput = z.object({ expectedVersion: version }).strict();

@ApiTags('工作区与创作')
@ApiCookieAuth()
@Controller('api/v1')
export class ProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly lifecycle: ProjectLifecycleService,
    private readonly memberships: MembersService,
  ) {}
  @Post('projects/:projectId/settings-impact')
  @ApiBody({ schema: jsonSchema(projectPatch) })
  settingsImpact(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.production.settingsImpact(req.user, parse(uuid, id), parse(projectPatch, body));
  }
  @Get('workspaces') workspaces(@Req() req: StudioRequest) {
    return this.production.workspaces(req.user);
  }
  @Post('workspaces')
  @ApiBody({ schema: jsonSchema(workspaceSchema) })
  createWorkspace(@Req() req: StudioRequest, @Body() body: unknown) {
    return this.production.createWorkspace(req.user, parse(workspaceSchema, body));
  }
  @Get('workspaces/:workspaceId/members')
  members(@Req() req: StudioRequest, @Param('workspaceId') id: string) {
    return this.production.members(req.user, parse(uuid, id));
  }
  @Patch('workspaces/:workspaceId/members/:userId')
  @ApiBody({ schema: jsonSchema(workspaceRoleUpdate) })
  workspaceRole(
    @Req() req: StudioRequest,
    @Param('workspaceId') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const input = parse(workspaceRoleUpdate, body);
    return this.memberships.updateWorkspace(
      req.user,
      parse(uuid, id),
      parse(uuid, userId),
      input.expectedRole,
      input.role,
    );
  }
  @Delete('workspaces/:workspaceId/members/:userId')
  @ApiBody({ schema: jsonSchema(workspaceRemoval) })
  removeWorkspaceMember(
    @Req() req: StudioRequest,
    @Param('workspaceId') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.memberships.removeWorkspace(
      req.user,
      parse(uuid, id),
      parse(uuid, userId),
      parse(workspaceRemoval, body).expectedRole,
    );
  }
  @Get('workspaces/:workspaceId/trash/projects')
  trashed(@Req() req: StudioRequest, @Param('workspaceId') id: string, @Query('cursor') cursor?: string) {
    return this.lifecycle.list(
      req.user,
      parse(uuid, id),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('workspaces/:workspaceId/invitations')
  @ApiBody({ schema: jsonSchema(inviteSchema) })
  invite(@Req() req: StudioRequest, @Param('workspaceId') id: string, @Body() body: unknown) {
    return this.production.invite(req.user, parse(uuid, id), parse(inviteSchema, body));
  }
  @Get('projects')
  projects(
    @Req() req: StudioRequest,
    @Query('workspaceId') workspaceId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.production.listProjects(
      req.user,
      parse(uuid, workspaceId),
      cursor === undefined ? undefined : parse(uuid, cursor),
    );
  }
  @Post('projects')
  @ApiBody({ schema: jsonSchema(createProjectSchema) })
  createProject(@Req() req: StudioRequest, @Body() body: unknown) {
    return this.production.createProject(req.user, parse(createProjectSchema, body));
  }
  @Get('projects/:projectId')
  project(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.production.project(req.user, parse(uuid, id));
  }
  @Patch('projects/:projectId')
  @ApiBody({ schema: jsonSchema(projectPatch) })
  updateProject(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.production.updateProject(req.user, parse(uuid, id), parse(projectPatch, body));
  }
  @Post('projects/:projectId/trash')
  @ApiBody({ schema: jsonSchema(lifecycleInput) })
  trash(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.lifecycle.transition(
      req.user,
      parse(uuid, id),
      parse(lifecycleInput, body).expectedVersion,
      false,
    );
  }
  @Post('projects/:projectId/restore')
  @ApiBody({ schema: jsonSchema(lifecycleInput) })
  restore(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.lifecycle.transition(
      req.user,
      parse(uuid, id),
      parse(lifecycleInput, body).expectedVersion,
      true,
    );
  }
  @Get('projects/:projectId/member-candidates')
  candidates(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.memberships.candidates(req.user, parse(uuid, id));
  }
  @Get('projects/:projectId/members')
  projectMembers(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.memberships.listProject(req.user, parse(uuid, id));
  }
  @Get('projects/:projectId/access')
  access(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.production.access(req.user, parse(uuid, id));
  }
  @Post('projects/:projectId/members')
  @ApiBody({ schema: jsonSchema(memberSchema) })
  assign(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.memberships.assign(req.user, parse(uuid, id), parse(memberSchema, body));
  }
  @Delete('projects/:projectId/members/:userId')
  @ApiBody({ schema: jsonSchema(projectRemoval) })
  removeProjectMember(
    @Req() req: StudioRequest,
    @Param('projectId') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.memberships.removeProject(
      req.user,
      parse(uuid, id),
      parse(uuid, userId),
      parse(projectRemoval, body).expectedRole,
    );
  }
  @Get('projects/:projectId/episodes')
  episodes(@Req() req: StudioRequest, @Param('projectId') id: string) {
    return this.production.listEpisodes(req.user, parse(uuid, id));
  }
  @Post('projects/:projectId/episodes')
  @ApiBody({ schema: jsonSchema(episodeSchema) })
  createEpisode(@Req() req: StudioRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.production.createEpisode(req.user, parse(uuid, id), parse(episodeSchema, body));
  }
  @Get('episodes/:episodeId')
  episode(@Req() req: StudioRequest, @Param('episodeId') id: string) {
    return this.production.episode(req.user, parse(uuid, id));
  }
  @Patch('episodes/:episodeId')
  @ApiBody({ schema: jsonSchema(episodePatch) })
  updateEpisode(@Req() req: StudioRequest, @Param('episodeId') id: string, @Body() body: unknown) {
    return this.production.updateEpisode(req.user, parse(uuid, id), parse(episodePatch, body));
  }
  @Get('episodes/:episodeId/shots')
  shots(@Req() req: StudioRequest, @Param('episodeId') id: string) {
    return this.production.listShots(req.user, parse(uuid, id));
  }
  @Post('episodes/:episodeId/shots')
  @ApiBody({ schema: jsonSchema(shotSchema) })
  createShot(@Req() req: StudioRequest, @Param('episodeId') id: string, @Body() body: unknown) {
    return this.production.createShot(req.user, parse(uuid, id), parse(shotSchema, body));
  }
  @Get('shots/:shotId')
  shot(@Req() req: StudioRequest, @Param('shotId') id: string) {
    return this.production.shot(req.user, parse(uuid, id));
  }
  @Patch('shots/:shotId')
  @ApiBody({ schema: jsonSchema(shotPatch) })
  updateShot(@Req() req: StudioRequest, @Param('shotId') id: string, @Body() body: unknown) {
    return this.production.updateShot(req.user, parse(uuid, id), parse(shotPatch, body));
  }
}
