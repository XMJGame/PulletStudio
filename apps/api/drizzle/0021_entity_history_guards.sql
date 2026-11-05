CREATE TRIGGER entity_revision_no_update BEFORE UPDATE ON asset_entity_revisions BEGIN SELECT RAISE(ABORT,'entity revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_revision_no_delete BEFORE DELETE ON asset_entity_revisions BEGIN SELECT RAISE(ABORT,'entity revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_media_no_update BEFORE UPDATE ON entity_media_bindings BEGIN SELECT RAISE(ABORT,'entity media bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_media_no_delete BEFORE DELETE ON entity_media_bindings BEGIN SELECT RAISE(ABORT,'entity media bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_asset_no_update BEFORE UPDATE ON shot_asset_bindings BEGIN SELECT RAISE(ABORT,'shot asset bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_asset_no_delete BEFORE DELETE ON shot_asset_bindings BEGIN SELECT RAISE(ABORT,'shot asset bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_no_delete BEFORE DELETE ON asset_entities BEGIN SELECT RAISE(ABORT,'entity history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER entity_identity BEFORE UPDATE ON asset_entities WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.kind<>OLD.kind OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.creation_key<>OLD.creation_key OR NEW.request_hash<>OLD.request_hash OR NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'entity identity or version invalid'); END;
--> statement-breakpoint
CREATE TRIGGER entity_revision_head BEFORE INSERT ON asset_entity_revisions WHEN NOT EXISTS(SELECT 1 FROM asset_entities e WHERE e.id=NEW.entity_id AND e.version=NEW.version) BEGIN SELECT RAISE(ABORT,'entity revision must match head'); END;
--> statement-breakpoint
CREATE TRIGGER entity_media_compatible BEFORE INSERT ON entity_media_bindings WHEN NOT EXISTS(SELECT 1 FROM asset_entity_revisions r JOIN asset_entities e ON e.id=r.entity_id JOIN media_versions m ON m.id=NEW.media_version_id WHERE r.id=NEW.revision_id AND ((e.kind='voice' AND NEW.role='voice_sample' AND m.media_type='audio') OR (e.kind<>'voice' AND NEW.role IN ('front','side','back','closeup','overview','floorplan','detail','reference') AND m.media_type='image'))) BEGIN SELECT RAISE(ABORT,'entity media kind invalid'); END;
--> statement-breakpoint
CREATE TRIGGER shot_asset_card_scope BEFORE INSERT ON shot_asset_bindings WHEN NOT (EXISTS(SELECT 1 FROM shot_card_editions c WHERE c.shot_id=NEW.shot_id AND c.version=NEW.card_version AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id) OR EXISTS(SELECT 1 FROM shot_card_revisions c WHERE c.shot_id=NEW.shot_id AND c.version=NEW.card_version AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'asset binding card missing'); END;
