CREATE TRIGGER script_revisions_no_update
BEFORE UPDATE ON script_revisions
BEGIN
  SELECT RAISE(ABORT, 'script revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER script_revisions_no_delete
BEFORE DELETE ON script_revisions
BEGIN
  SELECT RAISE(ABORT, 'script revisions are immutable');
END;
