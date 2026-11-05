CREATE TRIGGER board_revision_no_update BEFORE UPDATE ON board_revisions BEGIN SELECT RAISE(ABORT,'board history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER board_revision_no_delete BEFORE DELETE ON board_revisions BEGIN SELECT RAISE(ABORT,'board history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER board_no_delete BEFORE DELETE ON boards BEGIN SELECT RAISE(ABORT,'boards retain history'); END;
--> statement-breakpoint
CREATE TRIGGER board_initial BEFORE INSERT ON boards WHEN NEW.version<>0 BEGIN SELECT RAISE(ABORT,'board must start before its first revision'); END;
--> statement-breakpoint
CREATE TRIGGER board_revision_append BEFORE INSERT ON board_revisions WHEN NOT EXISTS (SELECT 1 FROM boards b WHERE b.id=NEW.board_id AND b.project_id=NEW.project_id AND b.workspace_id=NEW.workspace_id AND NEW.version=b.version+1) OR NEW.version<>(SELECT COALESCE(MAX(version),0)+1 FROM board_revisions WHERE board_id=NEW.board_id) BEGIN SELECT RAISE(ABORT,'board revision scope or sequence invalid'); END;
--> statement-breakpoint
CREATE TRIGGER board_head BEFORE UPDATE ON boards WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.unit_id IS NOT OLD.unit_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.creation_key<>OLD.creation_key OR NEW.request_hash<>OLD.request_hash OR NEW.version<>OLD.version+1 OR NOT EXISTS (SELECT 1 FROM board_revisions r WHERE r.board_id=NEW.id AND r.version=NEW.version AND r.title=NEW.title) BEGIN SELECT RAISE(ABORT,'board head must follow immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER board_layout_shape BEFORE INSERT ON board_revisions WHEN json_extract(NEW.layout_json,'$.schemaVersion') IS NOT 'studio.board.v1' OR json_type(NEW.layout_json,'$.nodes') IS NOT 'array' OR json_type(NEW.layout_json,'$.edges') IS NOT 'array' OR json_array_length(NEW.layout_json,'$.nodes')>100 OR json_array_length(NEW.layout_json,'$.edges')>200 BEGIN SELECT RAISE(ABORT,'board layout invalid'); END;
