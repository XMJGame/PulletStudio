CREATE TRIGGER script_sources_no_update BEFORE UPDATE ON script_sources BEGIN SELECT RAISE(ABORT, 'script sources are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER script_sources_no_delete BEFORE DELETE ON script_sources BEGIN SELECT RAISE(ABORT, 'script sources are immutable'); END;
