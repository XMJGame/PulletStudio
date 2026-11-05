CREATE TRIGGER storyboard_exports_no_update BEFORE UPDATE ON storyboard_exports BEGIN SELECT RAISE(ABORT, 'storyboard exports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER storyboard_exports_no_delete BEFORE DELETE ON storyboard_exports BEGIN SELECT RAISE(ABORT, 'storyboard exports are immutable'); END;
