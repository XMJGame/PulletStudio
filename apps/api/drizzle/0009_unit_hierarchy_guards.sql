CREATE TRIGGER units_parent_insert BEFORE INSERT ON episodes BEGIN SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM episodes p WHERE p.id=NEW.parent_id AND p.project_id=NEW.project_id AND p.workspace_id=NEW.workspace_id AND p.unit_type <> 'project_root') THEN RAISE(ABORT, 'invalid unit parent scope') END;
SELECT CASE WHEN NEW.parent_id IS NOT NULL AND EXISTS (WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM episodes WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM episodes p JOIN ancestors a ON p.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE(ABORT, 'unit hierarchy cycle') END;
SELECT CASE WHEN NEW.unit_type='project_root' AND NEW.parent_id IS NOT NULL THEN RAISE(ABORT, 'root has no parent') END; END;
--> statement-breakpoint
CREATE TRIGGER units_parent_update BEFORE UPDATE OF parent_id, project_id, workspace_id ON episodes BEGIN SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM episodes p WHERE p.id=NEW.parent_id AND p.project_id=NEW.project_id AND p.workspace_id=NEW.workspace_id AND p.unit_type <> 'project_root') THEN RAISE(ABORT, 'invalid unit parent scope') END;
SELECT CASE WHEN NEW.parent_id IS NOT NULL AND EXISTS (WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM episodes WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM episodes p JOIN ancestors a ON p.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE(ABORT, 'unit hierarchy cycle') END;
SELECT CASE WHEN NEW.unit_type='project_root' AND NEW.parent_id IS NOT NULL THEN RAISE(ABORT, 'root has no parent') END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM episodes c WHERE c.parent_id=NEW.id AND (c.project_id<>NEW.project_id OR c.workspace_id<>NEW.workspace_id)) THEN RAISE(ABORT, 'invalid child scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER units_type_immutable BEFORE UPDATE OF unit_type ON episodes WHEN OLD.unit_type <> NEW.unit_type BEGIN SELECT RAISE(ABORT, 'unit type is immutable'); END;
