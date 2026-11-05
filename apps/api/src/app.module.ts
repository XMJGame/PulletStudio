import { Module } from '@nestjs/common';
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

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 300 }])],
  controllers: [
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
  ],
  providers: [
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
