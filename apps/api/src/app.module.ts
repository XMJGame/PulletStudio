import { Module } from '@nestjs/common';
import { PromptLibraryController } from './prompt-library/prompt-library.controller';
import { PromptLibraryService } from './prompt-library/prompt-library.service';
import { HealthController } from './health.controller';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from './config';
import { DatabaseService } from './db/database.service';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { AuthorizationService } from './production/authorization.service';
import { ProductionService } from './production/production.service';
import { ProductionController } from './production/production.controller';
import { ScriptsController } from './scripts/scripts.controller';
import { ScriptsService } from './scripts/scripts.service';
import { ProjectLifecycleService } from './production/project-lifecycle.service';
import { MembersService } from './production/members.service';
import { UnitsService } from './production/units.service';
import { UnitsController } from './production/units.controller';
import { TextController } from './providers/text.controller';
import { TextConnectionsService } from './providers/text-connections.service';
import { ProviderSecrets } from './providers/provider-secrets';
import { SafeTextHttp } from './providers/safe-text-http';
import { AnalysisController } from './analysis/analysis.controller';
import { AnalysisService } from './analysis/analysis.service';
import { TextAnalysisWorker } from './analysis/text-analysis-worker';
import { ProposalReviewService } from './analysis/proposal-review.service';
import { ProposalReviewController } from './analysis/proposal-review.controller';
import { CardAuthoringController } from './production/card-authoring.controller';
import { CardAuthoringService } from './production/card-authoring.service';
import { PromptController } from './prompt/prompt.controller';
import { PromptService } from './prompt/prompt.service';
import { StoryboardExportsService } from './exports/storyboard-exports.service';
import { StoryboardExportsController } from './exports/storyboard-exports.controller';
import { LocalStorage } from './storage/local-storage';
import { MediaProbe } from './assets/media-probe';
import { MediaService } from './assets/media.service';
import { ResourceAccessService } from './assets/resource-access.service';
import { WorkspaceLibraryService } from './assets/workspace-library.service';
import { WorkspaceLibraryController } from './assets/workspace-library.controller';
import { WorkspaceLibraryBrowserController } from './assets/workspace-library-browser.controller';
import { WorkspaceUploadController } from './assets/workspace-upload.controller';
import { WorkspaceUploadService } from './assets/workspace-upload.service';
import { WorkspaceEntitiesService } from './assets/workspace-entities.service';
import {
  WorkspaceEntitiesController,
  ProjectEntitiesLibraryController,
} from './assets/workspace-entities.controller';
import { MediaController } from './assets/media.controller';
import { EntitiesService } from './assets/entities.service';
import { EntitiesController } from './assets/entities.controller';
import { AssetApprovalService } from './assets/asset-approval.service';
import { ComfyProvider } from './generation/comfy-provider';
import { ModelScopeProvider } from './generation/modelscope-provider';
import { GenerationService } from './generation/generation.service';
import { GenerationOutputPackageService } from './generation/generation-output-package.service';
import { GenerationController } from './generation/generation.controller';
import { GenerationWorker } from './generation/generation-worker';
import { TakeReviewController } from './assets/take-review.controller';
import { TakeReviewService } from './assets/take-review.service';
import { MediaPackageService } from './exports/media-package.service';
import { MediaPackageController } from './exports/media-package.controller';
import { TimelineService } from './timeline/timeline.service';
import { TimelineController } from './timeline/timeline.controller';
import { AnimaticRenderer } from './timeline/animatic-renderer';
import { AnimaticWorker } from './timeline/animatic-worker';
import { BoardsService } from './boards/boards.service';
import { LibraryFoldersService } from './boards/library-folders.service';
import { LibraryFoldersController } from './boards/library-folders.controller';
import { BoardReferencesService } from './boards/board-references.service';
import { BoardsController } from './boards/boards.controller';
import { BoardGenerationController } from './boards/board-generation.controller';
import { BoardGenerationService } from './boards/board-generation.service';
import { WorkflowCatalogService } from './generation/workflow-catalog.service';
import { WorkflowCatalogController } from './generation/workflow-catalog.controller';
import { GenerationInstancesController } from './generation/generation-instances.controller';
import { GenerationInstancesService } from './generation/generation-instances.service';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 300 }])],
  controllers: [
    PromptLibraryController,
    HealthController,
    AuthController,
    ProductionController,
    ScriptsController,
    UnitsController,
    TextController,
    AnalysisController,
    ProposalReviewController,
    CardAuthoringController,
    PromptController,
    StoryboardExportsController,
    MediaController,
    WorkspaceLibraryController,
    WorkspaceLibraryBrowserController,
    WorkspaceUploadController,
    WorkspaceEntitiesController,
    ProjectEntitiesLibraryController,
    EntitiesController,
    GenerationController,
    TakeReviewController,
    MediaPackageController,
    TimelineController,
    BoardsController,
    LibraryFoldersController,
    BoardGenerationController,
    WorkflowCatalogController,
    GenerationInstancesController,
  ],
  providers: [
    PromptLibraryService,
    AppConfig,
    DatabaseService,
    AuthService,
    AuthorizationService,
    ProductionService,
    ScriptsService,
    ProjectLifecycleService,
    MembersService,
    UnitsService,
    TextConnectionsService,
    ProviderSecrets,
    SafeTextHttp,
    AnalysisService,
    TextAnalysisWorker,
    ProposalReviewService,
    CardAuthoringService,
    PromptService,
    StoryboardExportsService,
    LocalStorage,
    MediaProbe,
    MediaService,
    ResourceAccessService,
    WorkspaceLibraryService,
    WorkspaceUploadService,
    WorkspaceEntitiesService,
    EntitiesService,
    AssetApprovalService,
    ComfyProvider,
    ModelScopeProvider,
    GenerationService,
    GenerationOutputPackageService,
    GenerationWorker,
    TakeReviewService,
    MediaPackageService,
    TimelineService,
    AnimaticRenderer,
    AnimaticWorker,
    BoardsService,
    LibraryFoldersService,
    BoardGenerationService,
    BoardReferencesService,
    WorkflowCatalogService,
    GenerationInstancesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
