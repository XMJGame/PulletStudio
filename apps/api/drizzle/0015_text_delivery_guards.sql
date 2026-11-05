CREATE TRIGGER edition_no_update BEFORE UPDATE ON shot_card_editions BEGIN SELECT RAISE(ABORT, 'shot card editions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER edition_no_delete BEFORE DELETE ON shot_card_editions BEGIN SELECT RAISE(ABORT, 'shot card editions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_profile_no_update BEFORE UPDATE ON prompt_profiles BEGIN SELECT RAISE(ABORT, 'prompt profiles are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_profile_no_delete BEFORE DELETE ON prompt_profiles BEGIN SELECT RAISE(ABORT, 'prompt profiles are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_artifact_no_update BEFORE UPDATE ON prompt_artifacts BEGIN SELECT RAISE(ABORT, 'prompt artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_artifact_no_delete BEFORE DELETE ON prompt_artifacts BEGIN SELECT RAISE(ABORT, 'prompt artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER edition_unique_version BEFORE INSERT ON shot_card_editions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM shot_card_revisions r WHERE r.shot_id=NEW.shot_id AND r.version=NEW.version) THEN RAISE(ABORT, 'duplicate card version') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shots s WHERE s.id=NEW.shot_id AND s.version=NEW.version) THEN RAISE(ABORT, 'card version must match shot') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.body_json, '$.sourceSpanIds') j WHERE NOT EXISTS(SELECT 1 FROM script_spans s WHERE s.id=j.value AND s.project_id=NEW.project_id AND s.workspace_id=NEW.workspace_id)) THEN RAISE(ABORT, 'card source scope mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER original_card_unique_version BEFORE INSERT ON shot_card_revisions WHEN EXISTS(SELECT 1 FROM shot_card_editions e WHERE e.shot_id=NEW.shot_id AND e.version=NEW.version) BEGIN SELECT RAISE(ABORT, 'duplicate card version'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_card_scope BEFORE INSERT ON prompt_artifacts WHEN NOT EXISTS(
  SELECT 1 FROM shot_card_editions e WHERE e.id=NEW.card_id AND e.shot_id=NEW.shot_id AND e.version=NEW.card_version AND e.project_id=NEW.project_id AND e.workspace_id=NEW.workspace_id
  UNION ALL
  SELECT 1 FROM shot_card_revisions r WHERE r.id=NEW.card_id AND r.shot_id=NEW.shot_id AND r.version=NEW.card_version AND r.project_id=NEW.project_id AND r.workspace_id=NEW.workspace_id
) BEGIN SELECT RAISE(ABORT, 'prompt card scope mismatch'); END;
